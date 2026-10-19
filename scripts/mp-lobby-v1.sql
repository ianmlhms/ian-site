-- mp-lobby-v1.sql (Oct 2026)
-- Shared multiplayer lobby (lobby.html / mp-lobby.js): one invite path for every online game.
--
-- What it does
--   1. mp_games            one row per online game (id, page, min/max players). Adding a game = one INSERT,
--                          no more CHECK-list edits and no per-game allowlist inside the functions.
--   2. game_invites        hardened. The old policy let a SENDER rewrite to_user/room/game of a row after the
--                          friend check (UPDATE had no column limit), so the table now only accepts status
--                          changes from the recipient. Inserts happen through the functions below only.
--   3. mp_invite()         invite up to 8 people into a lobby code in ONE request (picker "Leit derbäisetzen").
--                          Friends and non-friends alike (same openness as adding someone to a group chat),
--                          with the view restriction honoured in both directions and a rate limit.
--   4. invite_game_room()  Kart Lëtzebuerg's call, now valid for every game in mp_games. Same signature,
--                          still friends-only, so Kart behaves exactly as before.
--   5. my_game_invites()   unchanged signature; only the last 12 hours, max 20 rows (a lobby code is dead
--                          after that, and an old pile of invites should not be re-downloaded every visit).
--
-- Untouched on purpose: invite_game() (friends.html chooser keeps working for games without a lobby),
-- friendships, the game_invites realtime publication (toasts + push webhook keep firing on INSERT).
--
-- Run:  supabase db query --linked -f scripts/mp-lobby-v1.sql        (idempotent, safe to re-run)
-- Needs: profiles, friendships, game_invites (social-games-setup.sql), is_view_restricted() and
--        visible_user_ids() (profile-v2.sql).
-- Until it has run the lobby still works (create / join by code / link / quick match); only the
-- "Leit derbäisetzen" invite button reports that inviting is not available yet.

-- ---------------------------------------------------------------------------------------------------
-- 1. Game registry
-- ---------------------------------------------------------------------------------------------------
create table if not exists public.mp_games (
  id          text primary key,
  name        text not null,
  page        text not null,
  min_players integer not null default 2,
  max_players integer not null default 2,
  lobby       boolean not null default false,   -- true = starts through lobby.html, false = old ?room=&role= link
  enabled     boolean not null default true,
  constraint mp_games_id_ck check (id ~ '^[a-z0-9-]{2,24}$'),
  constraint mp_games_page_ck check (page ~ '^[a-z0-9/_-]{1,40}[.]html$'),
  constraint mp_games_name_ck check (char_length(name) between 1 and 40),
  constraint mp_games_players_ck check (min_players between 1 and 16 and max_players between min_players and 16)
);
alter table public.mp_games enable row level security;
drop policy if exists mp_games_read on public.mp_games;
create policy mp_games_read on public.mp_games for select using (true);
revoke all on table public.mp_games from anon, authenticated;
grant select on table public.mp_games to anon, authenticated;

-- ids are the page slugs the invite system already uses (game_invites.game), NOT the arcade ids (o-connect4 ...)
insert into public.mp_games (id, name, page, min_players, max_players, lobby) values
  ('connect4',        'Connect 4',         'connect4.html',          2, 2, true),
  ('slf',             'Stadt-Land-Fluss',  'slf.html',               2, 8, true),
  ('tictactoe',       'Tic-Tac-Toe',       'tictactoe.html',         2, 2, false),
  ('battleship',      'Battleship',        'battleship.html',        2, 2, false),
  ('reversi',         'Reversi',           'reversi.html',           2, 2, false),
  ('dots',            'Dots & Boxes',      'dots.html',              2, 2, false),
  ('checkers',        'Checkers',          'checkers.html',          2, 2, false),
  ('maumau',          'Mau-Mau Cards',     'maumau.html',            2, 2, false),
  ('dice-duel',       'Kniffel',           'dice-duel.html',         2, 2, false),
  ('color',           'Colour Guess',      'color.html',             2, 8, false),
  ('draw',            'Draw & Guess',      'draw.html',              2, 8, false),
  ('meme',            'Meme Caption Party','meme.html',              2, 8, false),
  ('intro',           'Guess the Song',    'intro.html',             2, 8, false),
  ('kart-letzebuerg', 'Kart Lëtzebuerg',   'pb/kart-letzebuerg.html',2, 8, false)
on conflict (id) do update
  set name = excluded.name, page = excluded.page,
      min_players = excluded.min_players, max_players = excluded.max_players;
-- (lobby / enabled are deliberately NOT overwritten on re-run: flipping a game over is a manual UPDATE)

-- ---------------------------------------------------------------------------------------------------
-- 2. game_invites: free-form ids allowed (the functions validate against mp_games), writes locked down
-- ---------------------------------------------------------------------------------------------------
alter table public.game_invites drop constraint if exists game_invites_game_ck;
alter table public.game_invites
  add constraint game_invites_game_ck check (game ~ '^[a-z0-9-]{2,24}$') not valid;
alter table public.game_invites drop constraint if exists game_invites_status_ck;
alter table public.game_invites
  add constraint game_invites_status_ck check (status in ('pending', 'accepted', 'declined')) not valid;

create index if not exists game_invites_to_pending_idx
  on public.game_invites (to_user, created_at desc) where status = 'pending';
create index if not exists game_invites_from_idx
  on public.game_invites (from_user, created_at desc);

-- No client writes except "I accepted / declined my own invite" (friends.js, lobby.html).
revoke insert, update, delete on table public.game_invites from anon, authenticated;
grant update (status) on table public.game_invites to authenticated;
drop policy if exists ginv_upd on public.game_invites;
create policy ginv_upd on public.game_invites for update to authenticated
  using (to_user = auth.uid())
  with check (to_user = auth.uid() and status in ('accepted', 'declined'));

-- ---------------------------------------------------------------------------------------------------
-- 3. Internal helpers (not callable from the browser)
-- ---------------------------------------------------------------------------------------------------
-- Same account as is_view_restricted() (profile-v2.sql), but for any user id. Keep the e-mail in sync.
create or replace function public.mp_is_restricted(p_user uuid)
  returns boolean
  language sql
  security definer
  stable
  set search_path = public
  as '
    select lower(coalesce((select email from auth.users where id = p_user), ''''))
         = ''maureen@wiwinius.lu''';
revoke all on function public.mp_is_restricted(uuid) from public, anon, authenticated;

create or replace function public.mp_are_friends(p_a uuid, p_b uuid)
  returns boolean
  language sql
  security definer
  stable
  set search_path = public
  as '
    select exists (
      select 1 from public.friendships f
       where f.status = ''accepted''
         and ((f.requester = p_a and f.addressee = p_b)
           or (f.requester = p_b and f.addressee = p_a)))';
revoke all on function public.mp_are_friends(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 4. mp_invite: invite up to 8 people into a lobby code, one request
--    returns [{"user_id": "...", "status": "sent" | "already_invited" | "self" | "unknown_user"
--                                        | "not_allowed" | "rate_limited"}, ...] in input order
-- ---------------------------------------------------------------------------------------------------
create or replace function public.mp_invite(p_game text, p_room text, p_to uuid[])
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
  as '
declare
  me uuid := auth.uid();
  my_name text;
  g public.mp_games;
  target uuid;
  seen uuid[] := ''{}'';
  results jsonb := ''[]''::jsonb;
  st text;
  sent_recently integer;
  sender_restricted boolean;
  max_per_window constant integer := 20;
begin
  if me is null then
    raise exception ''not signed in'';
  end if;
  select * into g from public.mp_games where id = p_game and enabled;
  if g.id is null then
    raise exception ''unknown game'';
  end if;
  if p_room is null or p_room !~ ''^[a-z0-9]{4,10}$'' then
    raise exception ''bad room'';
  end if;
  if p_to is null or coalesce(array_length(p_to, 1), 0) not between 1 and 8 then
    raise exception ''bad recipients'';
  end if;
  select username into my_name from public.profiles where id = me;
  if my_name is null then
    raise exception ''no profile'';
  end if;
  sender_restricted := public.is_view_restricted();
  select count(*) into sent_recently from public.game_invites
   where from_user = me and created_at > now() - interval ''10 minutes'';

  foreach target in array p_to loop
    if target is null then
      continue;
    end if;
    if target = any(seen) then
      continue;                                   -- same person twice in one call: report once
    end if;
    seen := seen || target;
    if target = me then
      st := ''self'';
    elsif not exists (select 1 from public.profiles where id = target) then
      st := ''unknown_user'';
    elsif sender_restricted
          and target not in (select v.user_id from public.visible_user_ids() v) then
      st := ''not_allowed'';
    elsif public.mp_is_restricted(target) and not public.mp_are_friends(me, target) then
      st := ''not_allowed'';                        -- a restricted account is only reachable by its friends
    elsif exists (select 1 from public.game_invites
                   where from_user = me and to_user = target and game = g.id and room = p_room) then
      st := ''already_invited'';
    elsif sent_recently >= max_per_window then
      st := ''rate_limited'';
    else
      insert into public.game_invites (from_user, from_name, to_user, game, room)
        values (me, my_name, target, g.id, p_room);
      sent_recently := sent_recently + 1;
      st := ''sent'';
    end if;
    results := results || jsonb_build_array(jsonb_build_object(''user_id'', target, ''status'', st));
  end loop;
  return results;
end';
revoke all on function public.mp_invite(text, text, uuid[]) from public, anon;
grant execute on function public.mp_invite(text, text, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 5. invite_game_room: Kart Lëtzebuerg's existing call, now for every game in mp_games (friends only)
-- ---------------------------------------------------------------------------------------------------
create or replace function public.invite_game_room(p_to uuid, p_game text, p_room text)
  returns public.game_invites
  language plpgsql
  security definer
  set search_path = public
  as '
declare
  gi public.game_invites;
  res jsonb;
begin
  if auth.uid() is null then
    raise exception ''not signed in'';
  end if;
  if not public.mp_are_friends(auth.uid(), p_to) then
    raise exception ''not friends'';
  end if;
  res := public.mp_invite(p_game, p_room, array[p_to]);
  if res -> 0 ->> ''status'' not in (''sent'', ''already_invited'') then
    raise exception ''invite refused: %'', res -> 0 ->> ''status'';
  end if;
  select * into gi from public.game_invites
   where from_user = auth.uid() and to_user = p_to and game = p_game and room = p_room
   order by id desc limit 1;
  return gi;
end';
revoke all on function public.invite_game_room(uuid, text, text) from public, anon;
grant execute on function public.invite_game_room(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 6. my_game_invites: recent ones only
-- ---------------------------------------------------------------------------------------------------
create or replace function public.my_game_invites()
  returns setof public.game_invites
  language sql
  security definer
  stable
  set search_path = public
  as '
    select * from public.game_invites
     where to_user = auth.uid()
       and status = ''pending''
       and created_at > now() - interval ''12 hours''
     order by created_at desc
     limit 20';
revoke all on function public.my_game_invites() from public, anon;
grant execute on function public.my_game_invites() to authenticated;

-- security-hardening-v2.sql (7 Sep 2026)
-- Server-side half of the 6-7 Sep review fixes. The
-- browser pickers were never enforcement: every one
-- of these values is reachable through the anon key.
--
-- Run:  supabase db query --linked \
--         -f scripts/security-hardening-v2.sql
--
-- The two CHECKs are added NOT VALID on purpose: they
-- enforce on every new write (the attack path) without
-- failing the migration on legacy rows. Validate later
-- once the existing rows are known to be clean.

-- 1. game_invites.game was free text, and it steers
--    which page the recipient is sent to.
alter table public.game_invites
  drop constraint if exists game_invites_game_ck;
alter table public.game_invites
  add constraint game_invites_game_ck check (
    game in ('connect4', 'slf', 'battleship',
      'color', 'draw', 'reversi', 'dots',
      'tictactoe', 'checkers', 'maumau',
      'dice-duel')) not valid;

-- 2. message_reactions.emoji was free text and is
--    rendered into every other group member's page.
alter table public.message_reactions
  drop constraint if exists message_reactions_emoji_ck;
alter table public.message_reactions
  add constraint message_reactions_emoji_ck check (
    emoji in ('👍', '❤️', '😂', '😮', '😢', '🔥'))
  not valid;

-- 3. invite_game accepted any game id and any target.
--    Now: known game, and an accepted friendship.
create or replace function public.invite_game(
    p_to uuid, p_game text)
  returns public.game_invites
  language plpgsql
  security definer
  set search_path = public
  as '
declare
  gi public.game_invites;
  me text;
  is_friend boolean;
begin
  if p_game is null or p_game not in (
      ''connect4'', ''slf'', ''battleship'',
      ''color'', ''draw'', ''reversi'', ''dots'',
      ''tictactoe'', ''checkers'', ''maumau'',
      ''dice-duel'') then
    raise exception ''unknown game'';
  end if;
  select true into is_friend
    from public.friendships f
   where f.status = ''accepted''
     and ((f.requester = auth.uid()
            and f.addressee = p_to)
       or (f.addressee = auth.uid()
            and f.requester = p_to))
   limit 1;
  if is_friend is not true then
    raise exception ''not friends'';
  end if;
  select username into me from public.profiles
   where id = auth.uid();
  insert into public.game_invites (
      from_user, from_name, to_user, game, room)
    values (auth.uid(), coalesce(me, ''?''), p_to,
      p_game,
      lower(substr(md5(random()::text), 1, 6)))
    returning * into gi;
  return gi;
end';

-- 4. add_notification stored any URL, and alerts.html
--    renders it as a link. Escaping does not reject
--    javascript:, so restrict to a site page. Both
--    real callers pass a bare "page.html".
create or replace function public.add_notification(
    p_to_username text,
    p_kind text default null,
    p_title text default null,
    p_body text default null,
    p_url text default null)
  returns void
  language sql
  security definer
  set search_path = public
  as '
    insert into public.notifications(
      user_id, kind, title, body, url)
    select p.id,
           left(p_kind, 24),
           left(p_title, 120),
           left(p_body, 240),
           case when p_url ~ (
                  ''^[A-Za-z0-9._-]+[.]html''
               || ''([?][A-Za-z0-9._=&%-]*)?$'')
             then left(p_url, 200) else null end
    from public.profiles p
    where lower(p.username)
        = lower(btrim(p_to_username))
      and p.id <> auth.uid()';

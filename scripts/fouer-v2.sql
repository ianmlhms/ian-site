-- ===========================================================================
-- fouer-v2.sql (23 Oct 2026) -- Schueberfouer Tycoon, the database part of the launch.
-- Run BEFORE the site is deployed:  supabase db query --linked -f scripts/fouer-v2.sql
-- Idempotent: safe to run twice. Written, NOT yet run (Ian / the reviewer runs it).
--
-- The game keeps its id 'park' (scores, plays, ?g=park links, the gallery and its likes
-- carry over), so the old rows stay and only three things change:
--
--  1. Live gifts for 'park'. game_gifts.game_id may be 'park', and the three functions that
--     check a game allow-list (admin_gift_live, claim_game_gifts and the closed-game gift
--     admin_gift_idle) accept it. The bodies are exact copies of the live definitions (read
--     with pg_get_functiondef on 23 Oct 2026) plus 'park'. admin_gift_idle also learns the
--     v2 save: cash is 'c', lifetime is 'tb', and 'rb' (pioneer rating bonus) is NOT bumped.
--  2. scores.game_name 'Theme Park Tycoon' -> 'Schueberfouer Tycoon' (33 rows on 23 Oct).
--  3. Pioneer stubs: every player with a park score but no game_saves row for 'park'
--     (33 of 33 on 23 Oct, there are no park saves in the cloud at all because the v1 grid
--     was 19 KB as jsonb, over the 8192-byte check) gets {"v":2,"stub":1,"pv":<best score>}.
--     The new game reads that as a pioneer without a readable local park (DESIGN 7.2):
--     cash, rating bonus and starting value from pv, golden carousel and kiosk, no vouchers.
--     The stub has no numeric 'tb', so the game_saves_keep_progress trigger never blocks the
--     first real v2 save over it, and on conflict do nothing never touches an existing save.
--     Why before the deploy: once a pioneer has opened the new game a row exists and the stub
--     could no longer be inserted for them.
--
-- Gallery (park_showcase, publish_park, park_gallery, park_layout, like_park) needs NO change:
-- v2 layouts are text starting 'F2|', v1 layouts start '{' and show up as Museum cards.
-- ===========================================================================

-- 1a. the check constraint on game_gifts.game_id
alter table public.game_gifts
  drop constraint if exists game_gifts_game_id_check;
alter table public.game_gifts
  add constraint game_gifts_game_id_check
  check (game_id in ('idle-empire', 'cookie-clicker',
    'bus-tycoon', 'park'));

-- 1b. the three allow-lists (create or replace keeps owner and grants)
create or replace function
  public.admin_gift_live(
    p_user uuid, p_game text, p_amount float8)
returns jsonb
language plpgsql security definer
set search_path = public as 'declare
  c_command_minutes constant integer := 60;
  gift_id bigint;
begin
  if not coalesce(public.is_admin(), false) then
    raise exception ''not authorized''
      using errcode = ''42501'';
  end if;
  if p_user is null then
    raise exception ''no user'';
  end if;
  if p_game is null or p_game not in
     (''idle-empire'', ''cookie-clicker'',
      ''bus-tycoon'', ''park'') then
    raise exception ''game not allowed'';
  end if;
  if p_amount is null or p_amount <> p_amount
     or p_amount <= 0 or p_amount > 1e30 then
    raise exception ''bad amount'';
  end if;

  insert into public.game_gifts
    (user_id, game_id, amount, created_by)
  values
    (p_user, p_game, p_amount::numeric, auth.uid())
  returning id into gift_id;

  insert into public.client_commands
    (created_by, target_user, action, game_id,
     reason, expires_at)
  values
    (auth.uid(), p_user, ''gift'', p_game, null,
     now() + make_interval(mins => c_command_minutes));

  return jsonb_build_object(
    ''id'', gift_id, ''game'', p_game,
    ''amount'', p_amount);
end';

create or replace function
  public.claim_game_gifts(p_game text)
returns jsonb
language plpgsql security definer
set search_path = public as 'declare
  c_claim_ttl constant interval :=
    interval ''2 minutes'';
  uid uuid := auth.uid();
  rows jsonb;
begin
  if uid is null then
    raise exception ''not signed in''
      using errcode = ''42501'';
  end if;
  if p_game is null or p_game not in
     (''idle-empire'', ''cookie-clicker'',
      ''bus-tycoon'', ''park'') then
    raise exception ''game not allowed'';
  end if;

  update public.game_gifts
    set status = ''pending'', claimed_at = null
    where user_id = uid and status = ''claimed''
      and claimed_at < now() - c_claim_ttl;
  update public.game_gifts
    set status = ''expired''
    where user_id = uid and status = ''pending''
      and expires_at <= now();

  with picked as (
    select g.id from public.game_gifts g
      where g.user_id = uid
        and g.game_id = p_game
        and g.status = ''pending''
      order by g.id
      for update skip locked),
  taken as (
    update public.game_gifts g
      set status = ''claimed'', claimed_at = now()
      from picked
      where g.id = picked.id
      returning g.id, g.amount)
  select coalesce(jsonb_agg(
           jsonb_build_object(
             ''id'', t.id, ''amount'', t.amount)
           order by t.id), ''[]''::jsonb)
    into rows from taken t;
  return rows;
end';

create or replace function
  public.admin_gift_idle(
    p_user uuid, p_game text, p_amount float8)
returns jsonb
language plpgsql security definer
set search_path = public as 'declare
  c_idle constant interval := interval ''90 seconds'';
  c_page constant interval := interval ''3 minutes'';
  c_cap constant numeric := 1e300;
  cur public.game_saves;
  pres public.site_presence;
  d jsonb;
  amt numeric;
  main_key text;
  base numeric;
  bump numeric;
  now_ms numeric;
  hist bigint;
  n integer;
  k text;
begin
  if not coalesce(public.is_admin(), false) then
    raise exception ''not authorized''
      using errcode = ''42501'';
  end if;
  if p_user is null then
    raise exception ''no user'';
  end if;
  if p_game is null or p_game not in
     (''idle-empire'', ''cookie-clicker'',
      ''bus-tycoon'', ''park'') then
    raise exception ''game not allowed'';
  end if;
  if p_amount is null or p_amount <> p_amount
     or p_amount <= 0 or p_amount > 1e30 then
    raise exception ''bad amount'';
  end if;
  amt := p_amount::numeric;

  select * into cur from public.game_saves
    where user_id = p_user and game_id = p_game
    for update;
  if not found then
    raise exception ''no save'';
  end if;
  if cur.updated_at > now() - c_idle then
    raise exception ''save not idle: game open?'';
  end if;
  select * into pres from public.site_presence
    where user_id = p_user;
  if found
     and pres.last_seen > now() - c_page
     and pres.page like
       ''%pixelbreak.html?g='' || p_game || ''%'' then
    raise exception ''player is on the game page'';
  end if;

  d := cur.data;
  main_key := case p_game
    when ''idle-empire'' then ''cash''
    when ''cookie-clicker'' then ''c''
    when ''park'' then ''c''
    else ''p'' end;
  k := case p_game
    when ''idle-empire'' then ''lifetime''
    else ''tb'' end;
  if jsonb_typeof(d -> main_key) is distinct from
       ''number''
     or jsonb_typeof(d -> k) is distinct from
       ''number'' then
    raise exception ''unexpected save format'';
  end if;
  base := (d ->> k)::numeric;
  bump := greatest(1e4, base * 0.001);
  if (d ->> main_key)::numeric + amt > c_cap
     or base + bump > c_cap then
    raise exception ''result too large'';
  end if;
  now_ms := floor(
    extract(epoch from clock_timestamp()) * 1000);

  d := jsonb_set(d, array[main_key],
    to_jsonb((d ->> main_key)::numeric + amt));
  -- park: rb is the pioneer rating bonus (not progress): only tb goes up
  foreach k in array
      array[''lifetime'', ''tb'', ''rb''] loop
    if p_game = ''park'' and k = ''rb'' then
      continue;
    end if;
    if jsonb_typeof(d -> k) = ''number'' then
      d := jsonb_set(d, array[k],
        to_jsonb((d ->> k)::numeric + bump));
    end if;
  end loop;
  if p_game <> ''park'' then
    d := jsonb_set(d, ''{savedAt}'', to_jsonb(now_ms));
  end if;
  if jsonb_typeof(d -> ''ts'') = ''number'' then
    d := jsonb_set(d, ''{ts}'', to_jsonb(now_ms));
  end if;

  perform public.game_save_history_add(
    cur.user_id, cur.game_id, cur.data,
    cur.updated_at, ''before-gift'');
  select h.id into hist
    from public.game_save_history h
    where h.user_id = p_user
      and h.game_id = p_game
    order by h.id desc limit 1;

  update public.game_saves
    set data = d, updated_at = now()
    where user_id = p_user and game_id = p_game;
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception ''update rejected by the guard'';
  end if;

  return jsonb_build_object(
    ''game'', p_game, ''field'', main_key,
    ''amount'', amt, ''bump'', bump,
    ''history_id'', hist,
    ''before'', cur.data -> main_key,
    ''after'', d -> main_key);
end';

-- 2. the leaderboard shows the new name
update public.scores
  set game_name = 'Schueberfouer Tycoon'
  where game_id = 'park'
    and game_name is distinct from 'Schueberfouer Tycoon';

-- 3. pioneer stubs (see the header); pv = the best park value of that player
insert into public.game_saves (user_id, game_id, data)
select s.user_id, 'park',
       jsonb_build_object('v', 2, 'stub', 1,
         'pv', least(100000000, greatest(0, floor(s.score)))::int)
  from public.scores s
  where s.game_id = 'park'
    and s.score is not null
on conflict (user_id, game_id) do nothing;

-- 4. verification (read-only): expect gift_games = 4 ids incl. park, renamed = 0 left to rename,
--    stubs >= the players who had a score, scores_without_row = 0, functions_with_park = 3
select
  (select pg_get_constraintdef(oid) from pg_constraint
     where conname = 'game_gifts_game_id_check') as gift_games,
  (select count(*) from public.scores
     where game_id = 'park'
       and game_name is distinct from 'Schueberfouer Tycoon') as not_renamed,
  (select count(*) from public.game_saves
     where game_id = 'park' and data -> 'stub' = '1') as stubs,
  (select count(*) from public.scores s
     where s.game_id = 'park' and not exists (
       select 1 from public.game_saves g
         where g.user_id = s.user_id and g.game_id = 'park')) as scores_without_row,
  (select count(*) from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('admin_gift_live', 'claim_game_gifts', 'admin_gift_idle')
       and pg_get_functiondef(p.oid) like '%''park''%') as functions_with_park;

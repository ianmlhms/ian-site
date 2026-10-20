-- admin-saves-kart-v1.sql (20 Oct 2026)
-- Backend for the two new admin.html tabs
-- "Kart" (online races, uses the existing
-- admin_kart_races, nothing new needed) and
-- "Saves" (save history, restore, gift).
--
--  * game_save_history.reason also accepts
--    'before-gift' (the save as it was just
--    before an admin gift).
--  * admin_find_users(p_query): username search
--    (profiles only: no e-mail), max 20 rows,
--    with the number of games the user has
--    saves for.
--  * admin_user_saves(p_user, p_game): ONE small
--    jsonb document: server time, user, current
--    presence, the games with a live save and/or
--    history (updated_at, history count) and, if
--    p_game is given, the live save (data) of
--    that game. The tab calls it on demand and
--    while it waits for a player to leave a game
--    (never on a timer by itself).
--  * admin_gift_idle(p_user, p_game, p_amount):
--    puts cash / cookies / passengers into the
--    live save of an idle game. Same recipe as a
--    by-hand gift: the save must be idle for
--    90 s and the player must not be on the game
--    page (checked HERE too, not only in the
--    browser). The main amount goes up by
--    p_amount; lifetime / tb / rb go up by
--    max(1e4, 0.001 x lifetime) and savedAt is
--    set to now, so the cloud copy wins when the
--    player opens the game again. The old save
--    goes to game_save_history first (reason
--    'before-gift'). Games: idle-empire (cash),
--    cookie-clicker (c), bus-tycoon (p). Amount
--    > 0 and <= 1e30. Plain UPDATE (not delete +
--    insert), so the keep-progress guard stays
--    in force; if it rejects the update the
--    whole call fails and nothing is written.
--
-- Needs: game-save-history-v1.sql,
-- messenger-setup-v2.sql (is_admin), the
-- site_presence table. No dollar quoting, short
-- lines: safe to paste into the Supabase SQL
-- editor. Idempotent. Run:
--   supabase db query --linked \
--     -f scripts/admin-saves-kart-v1.sql

alter table public.game_save_history
  drop constraint if exists
  game_save_history_reason_check;
alter table public.game_save_history
  add constraint game_save_history_reason_check
  check (reason in ('rolling', 'drop',
    'before-restore', 'before-gift'));

-- Admin: find users by (part of) the username.
create or replace function
  public.admin_find_users(p_query text)
returns table(
  user_id uuid, username text, class text,
  avatar text, account_kind text,
  save_games integer)
language plpgsql stable security definer
set search_path = public as '
declare
  q text := left(btrim(coalesce(p_query, '''')), 40);
begin
  if not coalesce(public.is_admin(), false) then
    raise exception ''not authorized''
      using errcode = ''42501'';
  end if;
  if q = '''' then
    return;
  end if;
  return query
    select p.id, p.username,
      nullif(btrim(p.class), ''''), p.avatar,
      p.account_kind,
      (select count(distinct x.game_id)::integer
         from (
           select g.game_id
             from public.game_saves g
            where g.user_id = p.id
           union all
           select h.game_id
             from public.game_save_history h
            where h.user_id = p.id) x)
    from public.profiles p
    where strpos(lower(p.username), lower(q)) > 0
    order by (lower(p.username) = lower(q)) desc,
      (strpos(lower(p.username), lower(q)) = 1)
        desc,
      lower(p.username)
    limit 20;
end';

-- Admin: saves + presence of one user (see header).
create or replace function
  public.admin_user_saves(
    p_user uuid, p_game text default null)
returns jsonb
language plpgsql stable security definer
set search_path = public as '
begin
  if not coalesce(public.is_admin(), false) then
    raise exception ''not authorized''
      using errcode = ''42501'';
  end if;
  return jsonb_build_object(
    ''now'', now(),
    ''user'', (
      select jsonb_build_object(
        ''id'', p.id, ''username'', p.username,
        ''class'', nullif(btrim(p.class), ''''),
        ''avatar'', p.avatar)
      from public.profiles p
      where p.id = p_user),
    ''presence'', (
      select jsonb_build_object(
        ''page'', s.page,
        ''last_seen'', s.last_seen,
        ''started_at'', s.started_at)
      from public.site_presence s
      where s.user_id = p_user),
    ''games'', coalesce((
      select jsonb_agg(jsonb_build_object(
        ''game_id'', k.game_id,
        ''updated_at'', l.updated_at,
        ''history_count'', k.n)
        order by k.game_id)
      from (
        select a.game_id, count(h.id)::integer n
        from (
          select g.game_id
            from public.game_saves g
           where g.user_id = p_user
          union
          select h2.game_id
            from public.game_save_history h2
           where h2.user_id = p_user) a
        left join public.game_save_history h
          on h.user_id = p_user
         and h.game_id = a.game_id
        group by a.game_id) k
      left join public.game_saves l
        on l.user_id = p_user
       and l.game_id = k.game_id
    ), ''[]''::jsonb),
    ''live'', case when p_game is null then null
      else (
        select jsonb_build_object(
          ''game_id'', g.game_id,
          ''updated_at'', g.updated_at,
          ''data'', g.data)
        from public.game_saves g
        where g.user_id = p_user
          and g.game_id = p_game) end
  );
end';

-- Admin: gift cash / cookies / passengers.
create or replace function
  public.admin_gift_idle(
    p_user uuid, p_game text, p_amount float8)
returns jsonb
language plpgsql security definer
set search_path = public as '
declare
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
      ''bus-tycoon'') then
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
  foreach k in array
      array[''lifetime'', ''tb'', ''rb''] loop
    if jsonb_typeof(d -> k) = ''number'' then
      d := jsonb_set(d, array[k],
        to_jsonb((d ->> k)::numeric + bump));
    end if;
  end loop;
  d := jsonb_set(d, ''{savedAt}'', to_jsonb(now_ms));
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

revoke execute on function
  public.admin_find_users(text),
  public.admin_user_saves(uuid, text),
  public.admin_gift_idle(uuid, text, float8)
  from public, anon, authenticated;

grant execute on function
  public.admin_find_users(text),
  public.admin_user_saves(uuid, text),
  public.admin_gift_idle(uuid, text, float8)
  to authenticated;

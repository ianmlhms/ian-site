-- game-gifts-v1.sql (22 Oct 2026)
-- Live gifts for the idle games: an admin gifts cash / cookies / passengers while the
-- player keeps playing. Run with: supabase db query --linked -f scripts/game-gifts-v1.sql
-- (idempotent: safe to run twice).
--
-- The old admin_gift_idle (admin-saves-kart-v1.sql) writes into the cloud save and only
-- works while the game is closed. This is the other way round: the gift is a row in
-- game_gifts, the open game is told through a `gift` client command (presence ping, <= 1
-- min), the arcade page claims the pending rows and hands them to the game iframe, the
-- game adds the amount to its own state and saves, the page acknowledges.
--
--  * game_gifts: one row per gift. status: pending -> claimed (the page took it) ->
--    applied (the game confirmed). cancelled (admin) / expired (older than 7 days).
--    No direct table access (RLS on, no grants): everything goes through the functions.
--  * client_commands.action also accepts 'gift'.
--  * admin_gift_live(p_user, p_game, p_amount): admin only. Same validation as
--    admin_gift_idle (3 games, amount > 0 and <= 1e30). Inserts the pending gift and
--    issues the `gift` command for that user + game (valid 60 min). A player who is not
--    in the game right now gets the gift the next time the game opens.
--  * claim_game_gifts(p_game): the signed-in player. Gifts claimed more than 2 minutes
--    ago and never acknowledged (tab closed, ack lost) go back to pending; pending
--    gifts past expires_at become expired; then this game's pending gifts are claimed
--    (FOR UPDATE SKIP LOCKED: two tabs never get the same gift) and returned as
--    [{id, amount}].
--  * ack_game_gift(p_id): the player's own gift -> applied. Idempotent. A gift that had
--    gone back to pending is accepted too (the game DID apply it: don't deliver again).
--  * admin_game_gifts(p_user): {now, gifts: last 20 rows} for the Saves tab.
--  * admin_cancel_gift(p_id): pending -> cancelled (a gift already in flight is refused).

create table if not exists public.game_gifts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  game_id text not null check (game_id in ('idle-empire', 'cookie-clicker', 'bus-tycoon')),
  amount numeric not null check (amount > 0 and amount <= 1e30),
  created_by uuid,
  created_at timestamptz not null default now(),
  status text not null default 'pending'
    check (status in ('pending', 'claimed', 'applied', 'cancelled', 'expired')),
  claimed_at timestamptz,
  applied_at timestamptz,
  expires_at timestamptz not null default now() + interval '7 days'
);
alter table public.game_gifts enable row level security;
revoke all on table public.game_gifts from anon, authenticated;
create index if not exists game_gifts_user_game_status_idx
  on public.game_gifts (user_id, game_id, status);

-- the remote command table learns the new action (keeps the old values). Any check
-- constraint that mentions `action` is dropped first, whatever it is called.
do $$
declare
  c record;
begin
  for c in
    select conname from pg_constraint
      where conrelid = 'public.client_commands'::regclass
        and contype = 'c'
        and pg_get_constraintdef(oid) like '%action%'
  loop
    execute format(
      'alter table public.client_commands drop constraint %I',
      c.conname);
  end loop;
end $$;
alter table public.client_commands
  add constraint client_commands_action_check
  check (action in ('reload', 'close_game', 'gift'));

-- Admin: queue a live gift and tell the player's open game.
create or replace function
  public.admin_gift_live(
    p_user uuid, p_game text, p_amount float8)
returns jsonb
language plpgsql security definer
set search_path = public as '
declare
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
      ''bus-tycoon'') then
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

-- Player: take this game's pending gifts (each exactly once per claim).
create or replace function
  public.claim_game_gifts(p_game text)
returns jsonb
language plpgsql security definer
set search_path = public as '
declare
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
      ''bus-tycoon'') then
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

-- Player: the game confirmed the gift.
create or replace function
  public.ack_game_gift(p_id bigint)
returns boolean
language plpgsql security definer
set search_path = public as '
declare
  uid uuid := auth.uid();
  n integer;
begin
  if uid is null then
    raise exception ''not signed in''
      using errcode = ''42501'';
  end if;
  update public.game_gifts
    set status = ''applied'', applied_at = now()
    where id = p_id and user_id = uid
      and status in (''claimed'', ''pending'');
  get diagnostics n = row_count;
  if n = 1 then
    return true;
  end if;
  return exists (
    select 1 from public.game_gifts g
      where g.id = p_id and g.user_id = uid
        and g.status = ''applied'');
end';

-- Admin: the last 20 gifts of a player.
create or replace function
  public.admin_game_gifts(p_user uuid)
returns jsonb
language plpgsql security definer
set search_path = public as '
declare
  c_limit constant integer := 20;
begin
  if not coalesce(public.is_admin(), false) then
    raise exception ''not authorized''
      using errcode = ''42501'';
  end if;
  return jsonb_build_object(
    ''now'', now(),
    ''gifts'', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.id desc)
      from (
        select g.id, g.user_id, g.game_id,
               g.amount, g.created_by,
               g.created_at, g.status,
               g.claimed_at, g.applied_at,
               g.expires_at
        from public.game_gifts g
        where g.user_id = p_user
        order by g.id desc
        limit c_limit) r), ''[]''::jsonb));
end';

-- Admin: take back a gift nobody has picked up yet.
create or replace function
  public.admin_cancel_gift(p_id bigint)
returns jsonb
language plpgsql security definer
set search_path = public as '
declare
  n integer;
begin
  if not coalesce(public.is_admin(), false) then
    raise exception ''not authorized''
      using errcode = ''42501'';
  end if;
  update public.game_gifts
    set status = ''cancelled''
    where id = p_id and status = ''pending'';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception ''gift not pending'';
  end if;
  return jsonb_build_object(
    ''id'', p_id, ''status'', ''cancelled'');
end';

revoke execute on function
  public.admin_gift_live(uuid, text, float8),
  public.claim_game_gifts(text),
  public.ack_game_gift(bigint),
  public.admin_game_gifts(uuid),
  public.admin_cancel_gift(bigint)
  from public, anon, authenticated;

grant execute on function
  public.admin_gift_live(uuid, text, float8),
  public.claim_game_gifts(text),
  public.ack_game_gift(bigint),
  public.admin_game_gifts(uuid),
  public.admin_cancel_gift(bigint)
  to authenticated;

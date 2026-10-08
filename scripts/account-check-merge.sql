-- Account check + account merge (8 Oct 2026).
--
-- 1. profiles.account_checked_at + mark_account_checked(): the one-time
--    "is your username and class still right?" popup (account-check.js).
-- 2. Merging two accounts of the same person (someone registered twice):
--    - the OTHER account proves ownership by signing in (PIN/password) in a
--      throwaway client and calling issue_merge_ticket() -> one-time token,
--      valid 5 minutes;
--    - the signed-in account calls merge_accounts(token, 'mine'|'other'):
--      everything of the other account moves here, the chosen username is
--      kept, and the other account is deleted. The account you're signed in
--      with survives, so its login (e-mail + PIN) stays.
--    A snapshot of every merge is kept in account_merges (no client access).

alter table public.profiles add column if not exists account_checked_at timestamptz;

create or replace function public.mark_account_checked()
returns void language sql security definer set search_path = public as $$
  select public.assert_not_kart();
  update public.profiles set account_checked_at = now() where id = auth.uid();
$$;
revoke all on function public.mark_account_checked() from public, anon;
grant execute on function public.mark_account_checked() to authenticated;

create table if not exists public.account_merge_tickets (
  token uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.account_merge_tickets enable row level security;
revoke all on table public.account_merge_tickets from anon, authenticated;

create table if not exists public.account_merges (
  id bigint generated always as identity primary key,
  kept_user uuid not null,
  merged_user uuid not null,
  kept_username text,
  merged_username text,
  merged_email text,
  merged_profile jsonb,
  moved jsonb,
  created_at timestamptz not null default now()
);
alter table public.account_merges enable row level security;
revoke all on table public.account_merges from anon, authenticated;

create or replace function public.issue_merge_ticket()
returns uuid language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  ticket uuid;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  perform public.assert_not_kart();
  delete from public.account_merge_tickets
   where user_id = uid or created_at < now() - interval '10 minutes';
  insert into public.account_merge_tickets (user_id) values (uid) returning token into ticket;
  return ticket;
end $$;
revoke all on function public.issue_merge_ticket() from public, anon;
grant execute on function public.issue_merge_ticket() to authenticated;

-- Games where a lower score is better (pixelbreak.html lowerIsBetter).
create or replace function public.merge_score_is_better(p_game text, p_new bigint, p_old bigint)
returns boolean language sql immutable as $$
  select case when p_game in ('memory', 'maze', 'reaction') then p_new < p_old else p_new > p_old end
$$;
revoke all on function public.merge_score_is_better(text, bigint, bigint) from public, anon, authenticated;

create or replace function public.merge_accounts(p_ticket uuid, p_username_from text default 'mine')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  a uuid := auth.uid();
  b uuid;
  a_name text;
  b_name text;
  keep_name text;
  merge_id bigint;
  moved_rows jsonb := '{}'::jsonb;
  n int;
  r record;
  row_id tid;
  extra_cols constant text[] := array[
    'notifications.user_id', 'poll_votes.user_id', 'polls.created_by', 'timetables.user_id'];
begin
  if a is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  perform public.assert_not_kart();
  if p_username_from not in ('mine', 'other') then
    raise exception 'p_username_from must be mine or other' using errcode = '22023';
  end if;

  delete from public.account_merge_tickets
   where token = p_ticket and created_at > now() - interval '5 minutes'
  returning user_id into b;
  if b is null then
    raise exception 'merge ticket invalid or expired' using errcode = '22023';
  end if;
  if b = a then
    raise exception 'that is the account you are signed in with' using errcode = '22023';
  end if;
  if b = public.owner_user_id() or b in (select user_id from public.admin_user_ids()) then
    raise exception 'this account cannot be merged' using errcode = '42501';
  end if;
  if exists (select 1 from public.profiles where id in (a, b) and account_kind = 'kart') then
    raise exception 'kart accounts cannot be merged' using errcode = '42501';
  end if;

  select username into a_name from public.profiles where id = a for update;
  select username into b_name from public.profiles where id = b for update;
  keep_name := case when p_username_from = 'other' and b_name is not null then b_name else a_name end;

  insert into public.account_merges (kept_user, merged_user, kept_username, merged_username, merged_email, merged_profile)
  values (a, b, keep_name, b_name,
          (select email from auth.users where id = b),
          (select to_jsonb(p) from public.profiles p where p.id = b))
  returning id into merge_id;

  -- Same game saved on both accounts: keep the one with more progress.
  for r in
    select bs.game_id, bs.data as bdata, bs.updated_at as bup, s.data as adata, s.updated_at as aup
      from public.game_saves bs
      join public.game_saves s on s.user_id = a and s.game_id = bs.game_id
     where bs.user_id = b
  loop
    if (jsonb_typeof(r.bdata -> 'tb') = 'number' and jsonb_typeof(r.adata -> 'tb') = 'number'
          and (r.bdata ->> 'tb')::numeric > (r.adata ->> 'tb')::numeric)
       or (not (jsonb_typeof(r.bdata -> 'tb') = 'number' and jsonb_typeof(r.adata -> 'tb') = 'number')
          and r.bup > r.aup) then
      update public.game_saves set data = r.bdata, updated_at = now() where user_id = a and game_id = r.game_id;
    end if;
    delete from public.game_saves where user_id = b and game_id = r.game_id;
  end loop;

  -- Same game scored on both accounts: keep the better score.
  for r in
    select bs.game_id, bs.score as bscore, bs.updated_at as bup, s.score as ascore
      from public.scores bs
      join public.scores s on s.user_id = a and s.game_id = bs.game_id
     where bs.user_id = b
  loop
    if public.merge_score_is_better(r.game_id, r.bscore, r.ascore) then
      update public.scores set score = r.bscore, updated_at = r.bup where user_id = a and game_id = r.game_id;
    end if;
    delete from public.scores where user_id = b and game_id = r.game_id;
  end loop;

  -- Move every other row that points at the old account. A row that would
  -- duplicate one the kept account already has (same group, same day…) is dropped.
  for r in
    select cl.relname::text as tbl, att.attname::text as col
      from pg_constraint con
      join pg_class cl on cl.oid = con.conrelid
      join pg_namespace ns on ns.oid = cl.relnamespace
      join pg_attribute att on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
     where con.contype = 'f' and ns.nspname = 'public'
       and con.confrelid = 'auth.users'::regclass
       and cl.relname not in ('profiles', 'site_presence', 'account_merge_tickets')
    union
    select split_part(e, '.', 1), split_part(e, '.', 2)
      from unnest(extra_cols) e
     where exists (select 1 from information_schema.columns c
                    where c.table_schema = 'public'
                      and c.table_name = split_part(e, '.', 1)
                      and c.column_name = split_part(e, '.', 2))
  loop
    n := 0;
    for row_id in execute format('select ctid from public.%I where %I = $1', r.tbl, r.col) using b loop
      begin
        execute format('update public.%I set %I = $1 where ctid = $2', r.tbl, r.col) using a, row_id;
        n := n + 1;
      exception when unique_violation or check_violation then
        execute format('delete from public.%I where ctid = $1', r.tbl) using row_id;
      end;
    end loop;
    if n > 0 then
      moved_rows := moved_rows || jsonb_build_object(r.tbl || '.' || r.col, n);
    end if;
  end loop;

  -- Friendships with yourself, and the same friendship in both directions.
  delete from public.friendships where requester = a and addressee = a;
  delete from public.friendships f1
   using public.friendships f2
   where f1.id <> f2.id
     and f1.requester = f2.addressee and f1.addressee = f2.requester
     and a in (f1.requester, f1.addressee)
     and ((f2.status = 'accepted' and f1.status <> 'accepted')
          or (f1.status = f2.status and f1.id > f2.id));

  -- Profile: fill gaps from the old account.
  update public.profiles pa
     set class = coalesce(pa.class, pb.class),
         avatar = coalesce(pa.avatar, pb.avatar)
    from public.profiles pb
   where pa.id = a and pb.id = b;

  delete from public.user_pins where user_id = b;
  delete from auth.users where id = b;   -- cascades the old profile, sessions and leftovers

  update public.profiles set username = keep_name where id = a;
  update auth.users
     set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('username', keep_name)
   where id = a;
  for r in
    select c1.table_name as tbl
      from information_schema.columns c1
      join information_schema.columns c2
        on c2.table_schema = c1.table_schema and c2.table_name = c1.table_name and c2.column_name = 'user_id'
      join information_schema.tables t
        on t.table_schema = c1.table_schema and t.table_name = c1.table_name and t.table_type = 'BASE TABLE'
     where c1.table_schema = 'public' and c1.column_name = 'username'
  loop
    execute format('update public.%I set username = $1 where user_id = $2 and username is distinct from $1', r.tbl)
      using keep_name, a;
  end loop;

  update public.account_merges set moved = moved_rows where id = merge_id;
  return jsonb_build_object('username', keep_name, 'moved', moved_rows);
end $$;
revoke all on function public.merge_accounts(uuid, text) from public, anon;
grant execute on function public.merge_accounts(uuid, text) to authenticated;

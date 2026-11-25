-- Traffic log v3 (25 Nov 2026, Ian): which signed-in account played which game on
-- which day, and which companies opened the home page.

-- 1. game_players_log. The data already existed (game_saves / scores keep the last
--    change per account); this keeps one row per account, game and day for 180 days.
create table if not exists public.game_players_log (
  day date not null,
  game_id text not null check (length(game_id) between 1 and 80),
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (day, game_id, user_id)
);
create index if not exists game_players_log_user on public.game_players_log (user_id, day);
alter table public.game_players_log enable row level security;
revoke all on public.game_players_log from anon, authenticated;

create or replace function public.log_game_players_who(p_from date)
returns void
language sql
security definer
set search_path = public
as $$
  insert into game_players_log (day, game_id, user_id)
  select distinct (a.t at time zone 'Europe/Luxembourg')::date, a.game_id, a.user_id
    from (
      select user_id, game_id, updated_at as t from game_saves
      union all
      select user_id, game_id, saved_at from game_save_history
      union all
      select user_id, case when game_id like 'ski-%' then 'ski' else game_id end, updated_at from scores
    ) a
    join auth.users u on u.id = a.user_id
   where (a.t at time zone 'Europe/Luxembourg')::date >= p_from
     and length(a.game_id) between 1 and 80
  on conflict do nothing;
$$;
revoke all on function public.log_game_players_who(date) from public, anon, authenticated;

-- What traffic.html shows: the last p_days, newest first, with user names.
create or replace function public.game_activity(p_days integer default 14)
returns table (day date, username text, games text[])
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.assert_not_kart();
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return query
    select l.day, coalesce(p.username, '?'), array_agg(l.game_id order by l.game_id)
      from game_players_log l left join profiles p on p.id = l.user_id
     where l.day > (now() at time zone 'Europe/Luxembourg')::date - least(greatest(coalesce(p_days, 14), 1), 180)
     group by l.day, l.user_id, p.username
     order by l.day desc, count(*) desc, 2;
end $$;
revoke all on function public.game_activity(integer) from public, anon;
grant execute on function public.game_activity(integer) to authenticated;

select cron.schedule('log-game-players-who', '7,22,37,52 * * * *', $job$
  select public.log_game_players_who((now() at time zone 'Europe/Luxembourg')::date - 1);
$job$);
select cron.schedule('log-game-players-purge', '41 3 * * *', $job$
  delete from public.game_players_log where day < (now() at time zone 'Europe/Luxembourg')::date - 180;
$job$);
select public.log_game_players_who((now() at time zone 'Europe/Luxembourg')::date - 150);

-- 2. org_visits: written only by the edge function visit-org (service role).
--    The organisation is the name a network is registered under; no IP is stored.
create table if not exists public.org_visits (
  day date not null,
  org text not null check (length(org) between 1 and 80),
  kind text not null check (kind in ('company', 'provider')),
  country text not null default '' check (length(country) <= 2),
  visits integer not null default 0 check (visits >= 0),
  pages jsonb not null default '{}'::jsonb,
  refs jsonb not null default '{}'::jsonb,
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  primary key (day, org, kind)
);
alter table public.org_visits enable row level security;
revoke all on public.org_visits from anon, authenticated;
grant select on public.org_visits to authenticated;
drop policy if exists org_visits_admin_read on public.org_visits;
create policy org_visits_admin_read on public.org_visits
  for select to authenticated using (public.is_admin());

create or replace function public.log_org_visit(p_org text, p_kind text, p_country text, p_page text, p_ref text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date := (now() at time zone 'Europe/Luxembourg')::date;
  v_page text := left(coalesce(p_page, '/'), 80);
  v_ref text := left(coalesce(p_ref, ''), 80);
begin
  -- a flood must not fill the table: at most 300 organisations a day
  if (select count(*) from org_visits where day = v_day) >= 300
     and not exists (select 1 from org_visits where day = v_day and org = left(p_org, 80) and kind = p_kind) then
    return;
  end if;
  insert into org_visits as t (day, org, kind, country, visits, pages, refs)
  values (v_day, left(p_org, 80), p_kind, left(coalesce(p_country, ''), 2), 1,
          jsonb_build_object(v_page, 1), case when v_ref = '' then '{}'::jsonb else jsonb_build_object(v_ref, 1) end)
  on conflict (day, org, kind) do update
     set visits = t.visits + 1,
         last_at = now(),
         pages = t.pages || jsonb_build_object(v_page, coalesce((t.pages ->> v_page)::int, 0) + 1),
         refs = case when v_ref = '' then t.refs
                     else t.refs || jsonb_build_object(v_ref, coalesce((t.refs ->> v_ref)::int, 0) + 1) end;
end $$;
revoke all on function public.log_org_visit(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.log_org_visit(text, text, text, text, text) to service_role;

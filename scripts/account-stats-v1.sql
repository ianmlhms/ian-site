-- Account statistics for the admin-only traffic page (traffic.html).
-- Paste into Supabase > SQL Editor > New query > Run (or: supabase db query --linked -f).
-- Needs is_admin() (messenger-setup-v2.sql).
--
-- public.account_stats(p_days) returns ONE jsonb object with aggregates only
-- (no emails, ids or usernames):
--   total       accounts in auth.users that are not deleted, not currently banned
--               and not anonymous
--   new_7d      of those, created in the last 7 calendar days (today included)
--   new_30d     ... last 30 calendar days
--   active_7d   of those, with last_sign_in_at in the last 7 calendar days
--   active_30d  ... last 30 calendar days
--   daily       [{"day": "YYYY-MM-DD", "count": n}, ...] oldest first, zero-filled,
--               one entry per calendar day for the last p_days days (1..730)
--   as_of       the Europe/Luxembourg date the windows end on
-- Calendar days are Europe/Luxembourg days. last_sign_in_at only moves on a real
-- sign-in (not on silent token refresh), so "active" under-counts people who stay
-- signed in. Admin only: non-admins get "not authorized"; anon cannot execute.

create or replace function public.account_stats(p_days int default 90)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_days  int  := least(greatest(coalesce(p_days, 90), 1), 730);
  v_today date := (now() at time zone 'Europe/Luxembourg')::date;
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  with accts as (
    select (u.created_at at time zone 'Europe/Luxembourg')::date as created_day,
           (u.last_sign_in_at at time zone 'Europe/Luxembourg')::date as seen_day
    from auth.users u
    where u.deleted_at is null
      and (u.banned_until is null or u.banned_until <= now())
      and not coalesce(u.is_anonymous, false)
  ),
  series as (
    select d::date as day
    from generate_series(v_today - (v_days - 1), v_today, interval '1 day') d
  ),
  daily as (
    select s.day, count(a.created_day) as n
    from series s
    left join accts a on a.created_day = s.day
    group by s.day
  )
  select jsonb_build_object(
    'total',      (select count(*) from accts),
    'new_7d',     (select count(*) from accts where created_day >= v_today - 6),
    'new_30d',    (select count(*) from accts where created_day >= v_today - 29),
    'active_7d',  (select count(*) from accts where seen_day >= v_today - 6),
    'active_30d', (select count(*) from accts where seen_day >= v_today - 29),
    'daily',      (select jsonb_agg(jsonb_build_object('day', day, 'count', n) order by day) from daily),
    'as_of',      v_today
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.account_stats(int) from public, anon;
grant execute on function public.account_stats(int) to authenticated;

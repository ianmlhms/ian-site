-- =============================================================
-- security-fix-kart-flood-v1.sql  (audit 15 Nov 2026)  -- NOT APPLIED YET
-- Run:  supabase db query --linked -f scripts/security-fix-kart-flood-v1.sql
-- Idempotent. No client / watch-app change needed.
--
-- What it closes
-- MEDIUM  kart_sessions can be written without an account in three ways
--   (direct INSERT through policy kart_insert "with check (true)",
--   kart_insert(), kart_share()), each row up to 600 KB, with no limit
--   on how many. The database is at 95 MB of the plan's 500 MB:
--     for i in 1..700: POST /rest/v1/rpc/kart_insert {p_id:<uuid>, p_payload:{id:<uuid>, x:"<590 KB>"}}
--   fills it in a few minutes with the public anon key. A full database
--   goes read-only: no scores, saves or messages for anybody.
--     -> one row at most 200 KB (biggest real session: 54 KB),
--     -> at most 150 new sessions per hour and 600 per day in total
--        (busiest real day so far: 26).
--
-- How it could break something
-- * While somebody floods, real karting uploads are refused too until
--   the hour / day window moves on ("kart: too many uploads, try again
--   later"); the watch keeps the session and can send it again.
-- * A real session over 200 KB would be refused (none above 54 KB yet).
-- * Editing an existing shared session (kart_share on conflict, rename)
--   is an UPDATE and is not counted.
-- =============================================================

create or replace function public.kart_sessions_flood_guard()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  c_max_bytes constant integer := 200000;
  c_max_hour constant integer := 150;
  c_max_day constant integer := 600;
  last_hour integer;
  last_day integer;
begin
  if length(new.payload::text) > c_max_bytes then
    raise exception 'kart: session too large' using errcode = '22023';
  end if;
  -- kart_share() re-saving an existing session ends as an UPDATE: not a new row
  if exists (select 1 from public.kart_sessions s where s.id = new.id) then
    return new;
  end if;
  select count(*) filter (where s.created_at > now() - interval '1 hour'),
         count(*)
    into last_hour, last_day
    from public.kart_sessions s
   where s.created_at > now() - interval '24 hours';
  if last_hour >= c_max_hour or last_day >= c_max_day then
    raise exception 'kart: too many uploads, try again later'
      using errcode = '53400';
  end if;
  return new;
end $function$;

create index if not exists kart_sessions_created_idx
  on public.kart_sessions(created_at);

drop trigger if exists kart_sessions_flood_guard on public.kart_sessions;
create trigger kart_sessions_flood_guard
  before insert on public.kart_sessions
  for each row execute function public.kart_sessions_flood_guard();

-- ---------- check ----------
select count(*) filter (where created_at > now() - interval '1 hour') as last_hour,
       count(*) filter (where created_at > now() - interval '24 hours') as last_day,
       max(length(payload::text)) as biggest_bytes
  from public.kart_sessions;

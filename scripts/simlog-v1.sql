-- simlog-v1.sql — Flight-Sim Logbook (simlog.html)
-- Private, own-only flight log. Idempotent: safe to re-run.
-- Run: supabase db query --linked -f scripts/simlog-v1.sql

create table if not exists public.sim_flights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid()
    references auth.users on delete cascade,
  flown_on date not null,
  dep text not null,
  arr text not null,
  aircraft text,
  registration text,
  duration_min int,
  network text not null default 'offline',
  notes text,
  created_at timestamptz not null default now()
);

alter table public.sim_flights enable row level security;

drop policy if exists sim_flights_own on public.sim_flights;
create policy sim_flights_own on public.sim_flights
  for all to authenticated using (user_id = auth.uid());

create index if not exists sim_flights_user_date
  on public.sim_flights (user_id, flown_on desc);

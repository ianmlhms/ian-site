-- ops-v1.sql — Mini Control Room (ops.html)
-- Health, alerts and a restart queue for the
-- services running on Ian's Mac mini.
-- Idempotent: safe to re-run.
-- Run:
--   supabase db query --linked -f scripts/ops-v1.sql
--
-- No dollar-quoting and lines <= 56 chars, so the
-- Supabase SQL editor cannot mangle the paste.

-- -------------------------------------------------
-- 1. service_heartbeats
--    Already created by scripts/decks-v1.sql
--    (service pk, beat_at, note) and DeckWorker
--    writes to it today. EXTEND it, never recreate.
--    RLS on with NO policies, on purpose: the
--    service role writes, and every read goes
--    through the owner-gated `ops` edge function.
-- -------------------------------------------------
create table if not exists public.service_heartbeats (
  service text primary key,
  beat_at timestamptz not null default now(),
  note text
);

alter table public.service_heartbeats
  enable row level security;

-- 'daemon'    = runs continuously, must heartbeat
-- 'scheduled' = runs then exits; absence is normal
alter table public.service_heartbeats
  add column if not exists kind text
  not null default 'daemon';

alter table public.service_heartbeats
  add column if not exists status text
  not null default 'ok';

-- Per-service facts the page shows verbatim.
alter table public.service_heartbeats
  add column if not exists detail jsonb;

alter table public.service_heartbeats
  add column if not exists last_error text;

alter table public.service_heartbeats
  add column if not exists last_error_at timestamptz;

-- daemons: heartbeat interval.
-- scheduled: longest acceptable gap between runs.
alter table public.service_heartbeats
  add column if not exists
  expected_every_seconds integer;

-- Last successful piece of WORK, not last report.
-- A daemon can be up while its feed is dead.
alter table public.service_heartbeats
  add column if not exists last_ok_at timestamptz;

alter table public.service_heartbeats
  add column if not exists updated_at timestamptz
  not null default now();

alter table public.service_heartbeats
  drop constraint if exists heartbeat_kind_valid;

alter table public.service_heartbeats
  add constraint heartbeat_kind_valid
  check (kind in ('daemon', 'scheduled'));

alter table public.service_heartbeats
  drop constraint if exists heartbeat_status_valid;

alter table public.service_heartbeats
  add constraint heartbeat_status_valid
  check (status in ('ok', 'warn', 'error'));

-- -------------------------------------------------
-- 2. service_commands — the restart queue.
--    The page enqueues, OpsAgent on the mini claims
--    and runs, then writes the result back.
-- -------------------------------------------------
create table if not exists public.service_commands (
  id uuid primary key default gen_random_uuid(),
  service text not null,
  action text not null,
  status text not null default 'queued',
  requested_by uuid
    references auth.users on delete set null,
  result text,
  error text,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint command_action_valid
    check (action in ('restart', 'start', 'stop')),
  constraint command_status_valid
    check (status in
      ('queued', 'running', 'done', 'error'))
);

alter table public.service_commands
  enable row level security;

create index if not exists service_commands_pending
  on public.service_commands (status, created_at)
  where status in ('queued', 'running');

-- -------------------------------------------------
-- 3. service_alerts — one row per health TRANSITION.
--    Drives the push and doubles as history.
--    Only transitions, never one row per check, or
--    a dead service pushes every five minutes.
-- -------------------------------------------------
create table if not exists public.service_alerts (
  id uuid primary key default gen_random_uuid(),
  service text not null,
  from_health text,
  to_health text not null,
  message text not null,
  created_at timestamptz not null default now()
);

alter table public.service_alerts
  enable row level security;

create index if not exists service_alerts_recent
  on public.service_alerts (service, created_at desc);

-- -------------------------------------------------
-- 4. owner_user_id()
--    notify's Plan.recipients holds USER IDS, and
--    deliver() looks up push_subscriptions by
--    user_id — but nothing in the functions maps an
--    email to an id. This is that map, following
--    the my_class() precedent in
--    scripts/class-features-v1.sql.
--    Avoids paginating auth.admin.listUsers() on
--    every alert, and needs no new secret.
-- -------------------------------------------------
drop function if exists public.owner_user_id()
  cascade;

create function public.owner_user_id()
  returns uuid
  language sql
  security definer
  stable
  set search_path = public
  as 'select id from auth.users
      where lower(email) = ''konto@ian.lu''
      limit 1';

grant execute
  on function public.owner_user_id()
  to service_role;

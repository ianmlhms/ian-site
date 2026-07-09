-- ===========================================================================
-- Personal tools v1 — countdowns, health + workouts, finance + subscriptions,
-- and a server-side integrations table for Strava / bank sync.
-- Every table is OWN-ONLY: a user sees and writes only their own rows.
-- Paste into Supabase ▸ SQL Editor ▸ New query ▸ Run. Idempotent.
-- ===========================================================================

-- Small helper: standard own-only RLS on (user_id = auth.uid()).
-- (Written out per-table below so this file is copy-paste safe.)

-- ---- 1) Countdowns (countdowns.html) --------------------------------------
create table if not exists public.countdowns (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title      text not null check (char_length(title) between 1 and 80),
  emoji      text check (emoji is null or char_length(emoji) <= 8),
  at         timestamptz not null,
  note       text check (note is null or char_length(note) <= 200),
  created_at timestamptz not null default now()
);
alter table public.countdowns enable row level security;
drop policy if exists countdowns_own on public.countdowns;
create policy countdowns_own on public.countdowns
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---- 2) Health: one row per day + workout log (health.html) ----------------
create table if not exists public.health_days (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  log_date   date not null,                          -- "day" is a reserved keyword in some PG contexts
  water_ml   int  not null default 0 check (water_ml between 0 and 20000),
  sleep_h    numeric(4,1) check (sleep_h is null or sleep_h between 0 and 24),
  weight_kg  numeric(5,1) check (weight_kg is null or weight_kg between 0 and 400),
  updated_at timestamptz not null default now(),
  primary key (user_id, log_date)
);
alter table public.health_days enable row level security;
drop policy if exists health_days_own on public.health_days;
create policy health_days_own on public.health_days
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.workouts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  at           timestamptz not null default now(),
  type         text not null check (char_length(type) <= 20),
  duration_min int  check (duration_min is null or duration_min between 0 and 100000),
  distance_km  numeric(7,2) check (distance_km is null or distance_km >= 0),
  calories     int  check (calories is null or calories >= 0),
  source       text not null default 'manual' check (source in ('manual','strava','watch')),
  ext_id       text,                                   -- provider id, for dedupe
  note         text check (note is null or char_length(note) <= 200)
);
alter table public.workouts enable row level security;
drop policy if exists workouts_own on public.workouts;
create policy workouts_own on public.workouts
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
-- dedupe synced activities per user+source+ext_id
create unique index if not exists workouts_ext_uq
  on public.workouts (user_id, source, ext_id) where ext_id is not null;

-- ---- 3) Finance: transactions, subscriptions (money.html) ------------------
create table if not exists public.finance_tx (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  at         timestamptz not null default now(),
  amount     numeric(12,2) not null check (amount >= 0),
  kind       text not null check (kind in ('in','out')),
  category   text check (category is null or char_length(category) <= 40),
  currency   text not null default 'EUR' check (char_length(currency) <= 3),
  note       text check (note is null or char_length(note) <= 200),
  source     text not null default 'manual' check (source in ('manual','bank')),
  ext_id     text
);
alter table public.finance_tx enable row level security;
drop policy if exists finance_tx_own on public.finance_tx;
create policy finance_tx_own on public.finance_tx
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create unique index if not exists finance_tx_ext_uq
  on public.finance_tx (user_id, ext_id) where ext_id is not null;

create table if not exists public.subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 60),
  amount     numeric(12,2) not null check (amount >= 0),
  currency   text not null default 'EUR' check (char_length(currency) <= 3),
  cycle      text not null default 'monthly' check (cycle in ('weekly','monthly','yearly')),
  next_at    date not null,
  note       text check (note is null or char_length(note) <= 200),
  created_at timestamptz not null default now()
);
alter table public.subscriptions enable row level security;
drop policy if exists subscriptions_own on public.subscriptions;
create policy subscriptions_own on public.subscriptions
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---- 4) Integrations: tokens live here, readable ONLY by the service role ---
-- Strava / bank access + refresh tokens. NO select/insert/update/delete policy
-- for normal users → RLS denies all client access. The edge functions
-- (strava-sync, bank-sync) use the service-role key and bypass RLS.
create table if not exists public.user_integrations (
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  provider     text not null check (provider in ('strava','bank')),
  access_token text,
  refresh_token text,
  expires_at   timestamptz,
  meta         jsonb not null default '{}'::jsonb,   -- e.g. requisition id, athlete id
  updated_at   timestamptz not null default now(),
  primary key (user_id, provider)
);
alter table public.user_integrations enable row level security;
-- (deliberately NO policies → only service_role can touch it)

-- Client asks "am I connected to X?" without ever seeing the token.
create or replace function public.integration_status(p_provider text)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.user_integrations
    where user_id = auth.uid() and provider = p_provider and access_token is not null
  );
$$;
grant execute on function public.integration_status(text) to authenticated;

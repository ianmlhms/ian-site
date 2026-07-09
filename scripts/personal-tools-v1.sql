-- Personal tools v1 — countdowns, health + workouts, finance + subscriptions.
-- Own-only (each user sees only their own rows). Apple-Watch health sync uses a
-- per-user ingest token (get_health_token) + the health-ingest edge function.
-- Safe to re-run: drops & recreates these (new, empty) tables for a clean schema.

drop table if exists public.countdowns cascade;
drop table if exists public.health_days cascade;
drop table if exists public.workouts cascade;
drop table if exists public.finance_tx cascade;
drop table if exists public.subscriptions cascade;
drop table if exists public.user_integrations cascade;

create table public.countdowns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  emoji text check (emoji is null or char_length(emoji) <= 8),
  at timestamptz not null,
  note text check (note is null or char_length(note) <= 200),
  created_at timestamptz not null default now()
);
alter table public.countdowns enable row level security;
create policy countdowns_own on public.countdowns
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create table public.health_days (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  log_date date not null,
  water_ml int not null default 0 check (water_ml between 0 and 20000),
  sleep_h numeric(4,1) check (sleep_h is null or sleep_h between 0 and 24),
  weight_kg numeric(5,1) check (weight_kg is null or weight_kg between 0 and 400),
  steps int check (steps is null or steps >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, log_date)
);
alter table public.health_days enable row level security;
create policy health_days_own on public.health_days
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create table public.workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  at timestamptz not null default now(),
  type text not null check (char_length(type) <= 20),
  duration_min int check (duration_min is null or duration_min between 0 and 100000),
  distance_km numeric(7,2) check (distance_km is null or distance_km >= 0),
  calories int check (calories is null or calories >= 0),
  source text not null default 'manual' check (source in ('manual','watch')),
  ext_id text,
  note text check (note is null or char_length(note) <= 200)
);
alter table public.workouts enable row level security;
create policy workouts_own on public.workouts
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create unique index workouts_ext_uq on public.workouts (user_id, source, ext_id)
  where ext_id is not null;

create table public.finance_tx (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  at timestamptz not null default now(),
  amount numeric(12,2) not null check (amount >= 0),
  kind text not null check (kind in ('in','out')),
  category text check (category is null or char_length(category) <= 40),
  currency text not null default 'EUR' check (char_length(currency) <= 3),
  note text check (note is null or char_length(note) <= 200)
);
alter table public.finance_tx enable row level security;
create policy finance_tx_own on public.finance_tx
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  amount numeric(12,2) not null check (amount >= 0),
  currency text not null default 'EUR' check (char_length(currency) <= 3),
  cycle text not null default 'monthly' check (cycle in ('weekly','monthly','yearly')),
  next_at date not null,
  note text check (note is null or char_length(note) <= 200),
  created_at timestamptz not null default now()
);
alter table public.subscriptions enable row level security;
create policy subscriptions_own on public.subscriptions
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create table public.user_integrations (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  provider text not null check (provider in ('watch')),
  access_token text,
  meta jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, provider)
);
alter table public.user_integrations enable row level security;

create or replace function public.get_health_token()
returns text language plpgsql security definer set search_path = public as $$
declare tok text;
begin
  select access_token into tok from public.user_integrations
    where user_id = auth.uid() and provider = 'watch';
  if tok is null then
    tok := encode(gen_random_bytes(24), 'hex');
    insert into public.user_integrations (user_id, provider, access_token)
      values (auth.uid(), 'watch', tok);
  end if;
  return tok;
end; $$;
grant execute on function public.get_health_token() to authenticated;

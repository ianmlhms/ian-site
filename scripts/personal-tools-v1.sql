-- Personal tools v1 — countdowns, health+workouts, finance+subscriptions.
-- Own-only. One statement per line on purpose (copy-paste safe). Safe to re-run.
drop table if exists public.countdowns cascade;
drop table if exists public.health_days cascade;
drop table if exists public.workouts cascade;
drop table if exists public.finance_tx cascade;
drop table if exists public.subscriptions cascade;
drop table if exists public.user_integrations cascade;
create table public.countdowns (id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users on delete cascade, title text not null, emoji text, at timestamptz not null, note text, created_at timestamptz not null default now());
alter table public.countdowns enable row level security;
create policy countdowns_own on public.countdowns for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create table public.health_days (user_id uuid not null default auth.uid() references auth.users on delete cascade, log_date date not null, water_ml int not null default 0, sleep_h numeric(4,1), weight_kg numeric(5,1), steps int, updated_at timestamptz not null default now(), primary key (user_id, log_date));
alter table public.health_days enable row level security;
create policy health_days_own on public.health_days for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create table public.workouts (id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users on delete cascade, at timestamptz not null default now(), type text not null, duration_min int, distance_km numeric(7,2), calories int, source text not null default 'manual', ext_id text, note text);
alter table public.workouts enable row level security;
create policy workouts_own on public.workouts for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create unique index workouts_ext_uq on public.workouts (user_id, source, ext_id) where ext_id is not null;
create table public.finance_tx (id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users on delete cascade, at timestamptz not null default now(), amount numeric(12,2) not null, kind text not null, category text, currency text not null default 'EUR', note text);
alter table public.finance_tx enable row level security;
create policy finance_tx_own on public.finance_tx for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create table public.subscriptions (id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users on delete cascade, name text not null, amount numeric(12,2) not null, currency text not null default 'EUR', cycle text not null default 'monthly', next_at date not null, note text, created_at timestamptz not null default now());
alter table public.subscriptions enable row level security;
create policy subscriptions_own on public.subscriptions for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create table public.user_integrations (user_id uuid not null default auth.uid() references auth.users on delete cascade, provider text not null, access_token text, meta jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now(), primary key (user_id, provider));
alter table public.user_integrations enable row level security;
create or replace function public.get_health_token() returns text language plpgsql security definer set search_path = public as $$ declare tok text; begin select access_token into tok from public.user_integrations where user_id = auth.uid() and provider = 'watch'; if tok is null then tok := encode(gen_random_bytes(24), 'hex'); insert into public.user_integrations (user_id, provider, access_token) values (auth.uid(), 'watch', tok); end if; return tok; end; $$;
grant execute on function public.get_health_token() to authenticated;

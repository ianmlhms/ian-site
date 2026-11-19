-- geld-v1.sql — Trade Republic money tracker (geld.html)
-- Tables for the `geld` edge function and the owner page.
-- Idempotent: safe to re-run.
-- Run:
--   supabase db query --linked -f scripts/geld-v1.sql
--
-- Owner only: every table is readable AND writable
-- by konto@ian.lu alone (pinned auth.uid). The edge function
-- writes with the service role, which bypasses RLS.
-- No dollar-quoting, short lines (editor paste-safe).

-- ---------------------------------------------
-- 1. geld_tx — one row per money movement
-- ---------------------------------------------
create table if not exists public.geld_tx (
  id text primary key,
  at timestamptz not null,
  amount numeric not null,
  kind text not null
    check (kind in ('in', 'out')),
  account text not null,
  source text not null
    check (source in ('tr', 'legacy', 'manual')),
  type text,
  merchant text,
  isin text,
  shares numeric,
  cat text,
  cat_locked boolean not null default false,
  is_transfer boolean not null default false,
  status text,
  event_type text,
  updated_at timestamptz not null default now()
);

create index if not exists geld_tx_at_idx
  on public.geld_tx (at desc);
create index if not exists geld_tx_merchant_idx
  on public.geld_tx (lower(btrim(merchant)));

-- ---------------------------------------------
-- 2. geld_positions — whole set replaced per sync
-- ---------------------------------------------
create table if not exists public.geld_positions (
  isin text primary key,
  name text,
  qty numeric,
  avg_cost numeric,
  buy_cost numeric,
  value numeric,
  price numeric,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------
-- 3. geld_daily — depot value history
-- ---------------------------------------------
create table if not exists public.geld_daily (
  day date primary key,
  depot_value numeric,
  invested numeric,
  cash numeric
);

-- ---------------------------------------------
-- 4. geld_rules — merchant -> category
-- ---------------------------------------------
create table if not exists public.geld_rules (
  merchant_key text primary key,
  cat text not null
);

-- ---------------------------------------------
-- 5. geld_budgets — '_total' = whole month
-- ---------------------------------------------
create table if not exists public.geld_budgets (
  cat text primary key,
  monthly_limit numeric not null
    check (monthly_limit >= 0)
);

-- ---------------------------------------------
-- 6. geld_alerts_sent — each threshold fires once
-- ---------------------------------------------
create table if not exists public.geld_alerts_sent (
  month text not null,
  cat text not null,
  level int not null check (level in (80, 100)),
  sent_at timestamptz not null default now(),
  primary key (month, cat, level)
);

-- ---------------------------------------------
-- 7. geld_sync — the single status row
-- ---------------------------------------------
create table if not exists public.geld_sync (
  id int primary key default 1
    check (id = 1),
  last_ok_at timestamptz,
  last_attempt_at timestamptz,
  last_error text,
  needs_login boolean not null default false,
  events_total int
);

insert into public.geld_sync (id)
  values (1)
  on conflict (id) do nothing;

-- ---------------------------------------------
-- 8. RLS: owner only, all four verbs
-- ---------------------------------------------
alter table public.geld_tx
  enable row level security;
alter table public.geld_positions
  enable row level security;
alter table public.geld_daily
  enable row level security;
alter table public.geld_rules
  enable row level security;
alter table public.geld_budgets
  enable row level security;
alter table public.geld_alerts_sent
  enable row level security;
alter table public.geld_sync
  enable row level security;

drop policy if exists geld_tx_owner
  on public.geld_tx;
create policy geld_tx_owner
  on public.geld_tx for all
  using (auth.uid() = 'a40ba59a-3460-4ef2-a8e8-3db0c91eac66'::uuid)
  with check (auth.uid() = 'a40ba59a-3460-4ef2-a8e8-3db0c91eac66'::uuid);

drop policy if exists geld_positions_owner
  on public.geld_positions;
create policy geld_positions_owner
  on public.geld_positions for all
  using (auth.uid() = 'a40ba59a-3460-4ef2-a8e8-3db0c91eac66'::uuid)
  with check (auth.uid() = 'a40ba59a-3460-4ef2-a8e8-3db0c91eac66'::uuid);

drop policy if exists geld_daily_owner
  on public.geld_daily;
create policy geld_daily_owner
  on public.geld_daily for all
  using (auth.uid() = 'a40ba59a-3460-4ef2-a8e8-3db0c91eac66'::uuid)
  with check (auth.uid() = 'a40ba59a-3460-4ef2-a8e8-3db0c91eac66'::uuid);

drop policy if exists geld_rules_owner
  on public.geld_rules;
create policy geld_rules_owner
  on public.geld_rules for all
  using (auth.uid() = 'a40ba59a-3460-4ef2-a8e8-3db0c91eac66'::uuid)
  with check (auth.uid() = 'a40ba59a-3460-4ef2-a8e8-3db0c91eac66'::uuid);

drop policy if exists geld_budgets_owner
  on public.geld_budgets;
create policy geld_budgets_owner
  on public.geld_budgets for all
  using (auth.uid() = 'a40ba59a-3460-4ef2-a8e8-3db0c91eac66'::uuid)
  with check (auth.uid() = 'a40ba59a-3460-4ef2-a8e8-3db0c91eac66'::uuid);

drop policy if exists geld_alerts_sent_owner
  on public.geld_alerts_sent;
create policy geld_alerts_sent_owner
  on public.geld_alerts_sent for all
  using (auth.uid() = 'a40ba59a-3460-4ef2-a8e8-3db0c91eac66'::uuid)
  with check (auth.uid() = 'a40ba59a-3460-4ef2-a8e8-3db0c91eac66'::uuid);

drop policy if exists geld_sync_owner
  on public.geld_sync;
create policy geld_sync_owner
  on public.geld_sync for all
  using (auth.uid() = 'a40ba59a-3460-4ef2-a8e8-3db0c91eac66'::uuid)
  with check (auth.uid() = 'a40ba59a-3460-4ef2-a8e8-3db0c91eac66'::uuid);

-- Signed-in role only; anon gets nothing at all.
revoke all on public.geld_tx from anon;
revoke all on public.geld_positions from anon;
revoke all on public.geld_daily from anon;
revoke all on public.geld_rules from anon;
revoke all on public.geld_budgets from anon;
revoke all on public.geld_alerts_sent from anon;
revoke all on public.geld_sync from anon;

grant select, insert, update, delete
  on public.geld_tx to authenticated;
grant select, insert, update, delete
  on public.geld_positions to authenticated;
grant select, insert, update, delete
  on public.geld_daily to authenticated;
grant select, insert, update, delete
  on public.geld_rules to authenticated;
grant select, insert, update, delete
  on public.geld_budgets to authenticated;
grant select, insert, update, delete
  on public.geld_alerts_sent to authenticated;
grant select, insert, update, delete
  on public.geld_sync to authenticated;

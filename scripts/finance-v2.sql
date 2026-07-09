-- finance v2 — accounts, AI category, internal-transfer flags.
-- Additive + idempotent. Own-only RLS on finance_tx is unchanged.
-- No $$; short lines (Supabase editor paste-safe).
alter table public.finance_tx
  add column if not exists account text;
alter table public.finance_tx
  add column if not exists cat text;
alter table public.finance_tx
  add column if not exists is_transfer boolean
  not null default false;
alter table public.finance_tx
  add column if not exists pair_id text;
create index if not exists finance_tx_user_at_idx
  on public.finance_tx (user_id, at desc);

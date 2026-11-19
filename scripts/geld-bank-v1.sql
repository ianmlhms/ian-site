-- geld-bank-v1.sql — automatic bank sync for geld.html (BCEE/Spuerkeess + BDL)
-- via Enable Banking (PSD2 account information). Tables for the `geld` edge
-- function's bank_* actions. Run AFTER geld-v1.sql. Idempotent.
-- Run:
--   supabase db query --linked -f scripts/geld-bank-v1.sql
--
-- Privacy: this repo is PUBLIC. No IBANs, tokens or ids in this file.
--  * geld_bank_auth, geld_bank_sessions: RLS on, NO policy, no grant. Only
--    the edge function (service role) can touch them. The page can never
--    read a session id (it lives only in geld_bank_sessions).
--  * geld_accounts: the owner page may only SELECT. It holds the label,
--    last 4 IBAN digits, a SHA-256 of the IBAN (to spot own-account
--    transfers) and the balance; never a session id.

-- ---------------------------------------------
-- 1. geld_tx.source may now also be 'bank'
-- ---------------------------------------------
alter table public.geld_tx
  drop constraint if exists geld_tx_source_check;
alter table public.geld_tx
  add constraint geld_tx_source_check
  check (source in ('tr', 'legacy', 'manual', 'bank'));

-- ---------------------------------------------
-- 2. geld_bank_auth — one row per started login
--    (state -> bank; single use, valid 30 minutes)
-- ---------------------------------------------
create table if not exists public.geld_bank_auth (
  state text primary key,
  bank text not null
    check (bank in ('bcee', 'bdl')),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------
-- 3. geld_bank_sessions — consent sessions
-- ---------------------------------------------
create table if not exists public.geld_bank_sessions (
  session_id text primary key,
  bank text not null
    check (bank in ('bcee', 'bdl')),
  valid_until timestamptz not null,
  uids text[] not null default '{}',
  created_at timestamptz not null default now(),
  revoked boolean not null default false
);

-- ---------------------------------------------
-- 4. geld_accounts — what the page shows
-- ---------------------------------------------
create table if not exists public.geld_accounts (
  uid text primary key,
  bank text not null
    check (bank in ('bcee', 'bdl')),
  label text not null,
  iban_last4 text,
  iban_hash text,
  name text,
  currency text,
  balance numeric,
  balance_at timestamptz,
  valid_until timestamptz,
  last_sync_at timestamptz,
  last_error text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists geld_accounts_bank_idx
  on public.geld_accounts (bank);

-- ---------------------------------------------
-- 5. RLS
-- ---------------------------------------------
alter table public.geld_bank_auth
  enable row level security;
alter table public.geld_bank_sessions
  enable row level security;
alter table public.geld_accounts
  enable row level security;

-- no policies on geld_bank_auth / geld_bank_sessions: deny all
drop policy if exists geld_accounts_owner
  on public.geld_accounts;
drop policy if exists geld_accounts_owner_read
  on public.geld_accounts;
create policy geld_accounts_owner_read
  on public.geld_accounts for select
  using (auth.uid() = 'a40ba59a-3460-4ef2-a8e8-3db0c91eac66'::uuid);

revoke all on public.geld_bank_auth from anon, authenticated;
revoke all on public.geld_bank_sessions from anon, authenticated;
revoke all on public.geld_accounts from anon, authenticated;
grant select on public.geld_accounts to authenticated;

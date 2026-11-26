-- geld-bank-tr-v1.sql — Trade Republic as a third Enable Banking bank for
-- geld.html, plus de-duplication against the pytr rows (source 'tr').
-- Run AFTER geld-bank-v1.sql and geld-bank-topups.sql, BEFORE deploying the
-- function. Idempotent.
--   supabase db query --linked -f scripts/geld-bank-tr-v1.sql
-- PUBLIC repo: no ids, IBANs or personal data here.

-- 1. allow bank 'tr'
alter table public.geld_bank_auth drop constraint if exists geld_bank_auth_bank_check;
alter table public.geld_bank_auth
  add constraint geld_bank_auth_bank_check check (bank in ('bcee', 'bdl', 'tr'));
alter table public.geld_bank_sessions drop constraint if exists geld_bank_sessions_bank_check;
alter table public.geld_bank_sessions
  add constraint geld_bank_sessions_bank_check check (bank in ('bcee', 'bdl', 'tr'));
alter table public.geld_accounts drop constraint if exists geld_accounts_bank_check;
alter table public.geld_accounts
  add constraint geld_accounts_bank_check check (bank in ('bcee', 'bdl', 'tr'));

-- 2. bank copies that a pytr row replaced; bank_sync never re-inserts these
create table if not exists public.geld_tx_suppressed (
  id text primary key,
  reason text,
  created_at timestamptz default now()
);
alter table public.geld_tx_suppressed enable row level security;
revoke all on public.geld_tx_suppressed from anon, authenticated;

-- 3. pair bank rows of the TR account with pytr rows: same kind, same amount
--    to the cent, bank date 1 day before … 3 days after the pytr time (bank
--    booking dates lag). Closest first, strictly 1:1. A hand-set category on
--    the bank row moves to the pytr row (and locks it), then the bank row is
--    suppressed and deleted. Returns the number of pairs.
create or replace function public.geld_dedupe_tr_bank()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  used_bank text[] := '{}';
  used_tr text[] := '{}';
  n int := 0;
begin
  for r in
    select b.id as bank_id, t.id as tr_id,
           b.cat as bcat, b.is_transfer as btransfer, b.cat_locked as block,
           t.cat_locked as tlock
    from public.geld_tx b
    join public.geld_tx t
      on t.source = 'tr' and t.account = 'Trade Republic'
     and t.kind = b.kind and t.amount = b.amount
     and b.at - t.at between interval '-1 day' and interval '3 days'
    where b.source = 'bank' and b.account = 'Trade Republic'
    order by abs(extract(epoch from b.at - t.at)), b.id, t.id
  loop
    if r.bank_id = any(used_bank) or r.tr_id = any(used_tr) then
      continue;
    end if;
    used_bank := used_bank || r.bank_id;
    used_tr := used_tr || r.tr_id;
    if r.block and not r.tlock then
      update public.geld_tx
         set cat = r.bcat, is_transfer = r.btransfer, cat_locked = true,
             updated_at = now()
       where id = r.tr_id;
    end if;
    insert into public.geld_tx_suppressed (id, reason)
      values (r.bank_id, 'pytr row ' || r.tr_id)
      on conflict (id) do nothing;
    delete from public.geld_tx where id = r.bank_id;
    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke all on function public.geld_dedupe_tr_bank() from public, anon, authenticated;

-- geld-legacy-import.sql — copy konto@ian.lu's old
-- finance_tx rows (money.html) into geld_tx.
-- Idempotent (on conflict do nothing). finance_tx
-- itself is NEVER changed or deleted.
-- Needs scripts/geld-v1.sql first.
-- Run:
--   supabase db query --linked -f scripts/geld-legacy-import.sql

-- Old rows keep their category: cat if set, else the
-- slug mapped from the emoji label in `category`
-- (same mapping as money.html's seedCat). Rows with a
-- category are locked so no later sync overwrites them.
insert into public.geld_tx
  (id, at, amount, kind, account, source,
   merchant, cat, cat_locked, is_transfer)
select
  'legacy:' || f.id::text,
  f.at,
  abs(f.amount),
  f.kind,
  coalesce(nullif(btrim(f.account), ''), 'Manuell'),
  'legacy',
  f.note,
  m.cat,
  m.cat is not null,
  coalesce(f.is_transfer, false)
from public.finance_tx f
cross join lateral (
  select coalesce(
    nullif(btrim(f.cat), ''),
    case
      when f.category ilike '%Investéieren%'
        then 'investment'
      when f.category ilike '%Dividend%'
        or f.category ilike '%Zënsen%'
        then 'dividend'
      when f.category ilike '%Gebür%'
        then 'fees'
      when f.category ilike '%Spuergeld%'
        then 'income'
      when f.category like '🍔%' then 'food'
      when f.category like '🛒%' then 'groceries'
      when f.category like '🚌%' then 'transport'
      when f.category like '👕%'
        or f.category like '🛍%' then 'shopping'
      when f.category like '📱%'
        then 'subscription'
      when f.category like '🎮%'
        or f.category like '🎬%' then 'leisure'
      when f.category like '💊%' then 'health'
      when f.category like '📚%' then 'education'
      when f.category like '💼%' then 'income'
      when f.category like '📈%' then 'investment'
      when f.category like '💰%' then 'dividend'
      when f.category like '💳%' then 'fees'
      when f.category like '🏧%' then 'cash'
      when f.category like '🔁%' then 'transfer'
      when f.category like '🎁%'
        or f.category like '⭐%' then 'other'
    end
  ) as cat
) m
where f.user_id = (
    select id from auth.users
    where lower(email) = 'konto@ian.lu'
    limit 1
  )
  and f.kind in ('in', 'out')
on conflict (id) do nothing;

-- How many came over:
select count(*) as legacy_rows
from public.geld_tx
where source = 'legacy';

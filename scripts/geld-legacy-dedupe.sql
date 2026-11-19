-- geld-legacy-dedupe.sql — run AFTER the first full
-- Trade Republic backfill. For every legacy row on the
-- 'Trade Republic' account that has a TR row on the
-- same Luxembourg day with the same amount and kind:
-- copy the legacy category onto the TR row (unless the
-- TR row is already cat_locked) and delete the legacy
-- row. Unmatched legacy rows stay. Rows that share a
-- day/amount/kind are paired one-to-one in time order.
-- Idempotent: a second run finds nothing to pair.
-- Run:
--   supabase db query --linked -f scripts/geld-legacy-dedupe.sql

with leg as (
  select id, cat, cat_locked, amount, kind,
    ("at" at time zone 'Europe/Luxembourg')::date
      as day,
    row_number() over (
      partition by
        ("at" at time zone 'Europe/Luxembourg')::date,
        amount, kind
      order by "at", id
    ) as rn
  from public.geld_tx
  where source = 'legacy'
    and account = 'Trade Republic'
),
tr as (
  select id, amount, kind,
    ("at" at time zone 'Europe/Luxembourg')::date
      as day,
    row_number() over (
      partition by
        ("at" at time zone 'Europe/Luxembourg')::date,
        amount, kind
      order by "at", id
    ) as rn
  from public.geld_tx
  where source = 'tr'
    and account = 'Trade Republic'
),
pairs as (
  select l.id as legacy_id, t.id as tr_id,
    l.cat, l.cat_locked
  from leg l
  join tr t
    on t.day = l.day
   and t.amount = l.amount
   and t.kind = l.kind
   and t.rn = l.rn
),
copied as (
  update public.geld_tx g
  set cat = p.cat,
      cat_locked = p.cat_locked,
      updated_at = now()
  from pairs p
  where g.id = p.tr_id
    and p.cat is not null
    and not g.cat_locked
  returning g.id
),
gone as (
  delete from public.geld_tx
  where id in (select legacy_id from pairs)
  returning id
)
select
  (select count(*) from copied) as cats_copied,
  (select count(*) from gone) as legacy_deleted;

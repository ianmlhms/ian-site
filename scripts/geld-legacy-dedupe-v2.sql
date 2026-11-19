-- geld-legacy-dedupe-v2.sql — second pass after geld-legacy-dedupe.sql.
-- Trade Republic's CSV export (the legacy rows) carries the BOOKING date,
-- 0–4 days after the card payment the live sync stores. Pair each legacy
-- TR row with one synced TR row of the same amount + kind whose
-- Luxembourg day is 0..4 days earlier, closest day first, strictly 1:1.
-- The legacy category moves onto the synced row (unless that row is
-- hand-locked), then the legacy row is deleted. Idempotent.
do $$
declare
  k int;
begin
  create temp table if not exists geld_pair (
    legacy_id text primary key,
    tr_id text unique
  ) on commit drop;

  for k in 0..4 loop
    insert into geld_pair (legacy_id, tr_id)
    select l.id, t.id
    from (
      select id, amount, kind,
        (at at time zone 'Europe/Luxembourg')::date - k as d,
        row_number() over (
          partition by amount, kind,
            (at at time zone 'Europe/Luxembourg')::date
          order by id) as rn
      from public.geld_tx
      where source = 'legacy'
        and account = 'Trade Republic'
        and id not in (select legacy_id from geld_pair)
    ) l
    join (
      select id, amount, kind,
        (at at time zone 'Europe/Luxembourg')::date as d,
        row_number() over (
          partition by amount, kind,
            (at at time zone 'Europe/Luxembourg')::date
          order by at, id) as rn
      from public.geld_tx
      where source = 'tr'
        and id not in (
          select tr_id from geld_pair where tr_id is not null)
    ) t
      on t.amount = l.amount
     and t.kind = l.kind
     and t.d = l.d
     and t.rn = l.rn
    on conflict do nothing;
  end loop;

  update public.geld_tx t
  set cat = l.cat, updated_at = now()
  from geld_pair p
  join public.geld_tx l on l.id = p.legacy_id
  where t.id = p.tr_id
    and not t.cat_locked
    and l.cat is not null
    and l.cat_locked;

  delete from public.geld_tx
  where id in (select legacy_id from geld_pair);

  raise notice 'paired and removed % legacy rows',
    (select count(*) from geld_pair);
end
$$;

select count(*) as legacy_tr_left
from public.geld_tx
where source = 'legacy' and account = 'Trade Republic';

-- The live sync holds the full TR history (from 30 Dec 2024), so the
-- leftover legacy TR rows are the same trades in CSV form (gross before
-- the €1 fee, split sells, saveback rewards). Drop them; finance_tx
-- still keeps the originals.
delete from public.geld_tx
where source = 'legacy' and account = 'Trade Republic';

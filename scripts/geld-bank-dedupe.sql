-- geld-bank-dedupe.sql — run ONCE after the first bank sync (bank_session).
-- The legacy rows (CSV statements, source 'legacy', accounts 'Spuerkeess'
-- and 'BDL') and the new bank rows (source 'bank') describe the same
-- movements. Pair each legacy row with ONE bank row of the same account,
-- amount and kind whose Luxembourg day differs by at most 3 days, closest
-- day first, strictly 1:1. The legacy category moves onto the bank row
-- when the legacy row was hand-locked and the bank row is not; then the
-- paired legacy rows are deleted. Legacy rows older than what the bank
-- still delivers have no partner and stay. Idempotent.
-- Run:
--   supabase db query --linked -f scripts/geld-bank-dedupe.sql
do $$
declare
  off int;
  paired int;
  moved int;
begin
  create temp table if not exists geld_bank_pair (
    legacy_id text primary key,
    bank_id text unique
  ) on commit drop;

  foreach off in array array[0, -1, 1, -2, 2, -3, 3] loop
    insert into geld_bank_pair (legacy_id, bank_id)
    select l.id, b.id
    from (
      select id, account, amount, kind,
        (at at time zone 'Europe/Luxembourg')::date as d,
        row_number() over (
          partition by account, amount, kind,
            (at at time zone 'Europe/Luxembourg')::date
          order by id) as rn
      from public.geld_tx
      where source = 'legacy'
        and account in ('Spuerkeess', 'BDL')
        and id not in (select legacy_id from geld_bank_pair)
    ) l
    join (
      select id, account, amount, kind,
        (at at time zone 'Europe/Luxembourg')::date as d,
        row_number() over (
          partition by account, amount, kind,
            (at at time zone 'Europe/Luxembourg')::date
          order by at, id) as rn
      from public.geld_tx
      where source = 'bank'
        and account in ('Spuerkeess', 'BDL')
        and id not in (
          select bank_id from geld_bank_pair where bank_id is not null)
    ) b
      on b.account = l.account
     and b.amount = l.amount
     and b.kind = l.kind
     and b.d = l.d + off
     and b.rn = l.rn
    on conflict do nothing;
  end loop;

  select count(*) into paired from geld_bank_pair;

  update public.geld_tx b
  set cat = l.cat, updated_at = now()
  from geld_bank_pair p
  join public.geld_tx l on l.id = p.legacy_id
  where b.id = p.bank_id
    and not b.cat_locked
    and l.cat is not null
    and l.cat_locked;
  get diagnostics moved = row_count;

  delete from public.geld_tx
  where id in (select legacy_id from geld_bank_pair);

  raise notice 'paired and removed % legacy rows, copied % hand-set categories',
    paired, moved;
end
$$;

select account,
       count(*) filter (where source = 'legacy') as legacy_left,
       count(*) filter (where source = 'bank') as bank_rows
from public.geld_tx
where account in ('Spuerkeess', 'BDL')
group by account
order by account;

-- From the first bank-delivered day on, the bank feed is complete; legacy
-- rows left in that period are CSV duplicates (short "VIR"/"DEB" lines next
-- to the detailed ones). Drop them per account.
delete from public.geld_tx l
where l.source = 'legacy'
  and l.account in ('Spuerkeess', 'BDL')
  and l.at >= (
    select min(b.at)::date from public.geld_tx b
    where b.source = 'bank' and b.account = l.account
  );

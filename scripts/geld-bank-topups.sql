-- geld-bank-topups.sql — Ian can't send money straight to Trade Republic, so he
-- sends it to Raoul, who forwards it to the TR account (in Raoul's name, but
-- 100 % Ian's money). A payment from Ian's bank (Spuerkeess/BDL) to Raoul and a
-- TR transfer_in of the same amount within 4 days are therefore one own
-- transfer: both sides get is_transfer + cat 'transfer' (TR side locked so the
-- hourly TR sync keeps it). Unpaired payments to Raoul stay spending; unpaired
-- money from Raoul into TR stays income / a repayment. Called after every bank
-- sync. Idempotent; service role only. v2 (20 Nov 2026): also marks TR side.
create or replace function public.geld_pair_tr_topups()
returns int
language sql
security definer
set search_path = public
as $$
  with pairs as (
    select distinct on (b.id) b.id as bank_id, t.id as tr_id
    from public.geld_tx b
    join public.geld_tx t
      on t.account = 'Trade Republic'
     and t.kind = 'in'
     and t.type = 'transfer_in'
     and t.amount = b.amount
     and t.at between b.at - interval '1 day' and b.at + interval '4 days'
    where b.account in ('Spuerkeess', 'BDL')
      and b.kind = 'out'
      and b.merchant ~* 'raoul'
      and not (b.is_transfer and t.is_transfer and t.cat = 'transfer')
      and not (b.cat_locked and b.cat <> 'transfer')
    order by b.id, abs(extract(epoch from t.at - b.at))
  ), ub as (
    update public.geld_tx g
    set is_transfer = true, cat = 'transfer',
        type = 'transfer_out', updated_at = now()
    from pairs p where g.id = p.bank_id
    returning 1
  ), ut as (
    update public.geld_tx g
    set is_transfer = true, cat = 'transfer', cat_locked = true,
        updated_at = now()
    from pairs p where g.id = p.tr_id
    returning 1
  )
  select (select count(*) from ub)::int;
$$;

revoke all on function public.geld_pair_tr_topups()
  from public, anon, authenticated;

-- geld-bank-topups.sql — a payment from Ian's bank (Spuerkeess/BDL) to Raoul
-- is only an own transfer when the same amount lands on Trade Republic
-- (Raoul's account, Ian's app) within 4 days: a TR top-up. Anything else to
-- Raoul (e.g. paying back an iPhone) is real spending. Called by the geld
-- edge function after every bank sync. Idempotent; service role only.
create or replace function public.geld_pair_tr_topups()
returns int
language sql
security definer
set search_path = public
as $$
  with c as (
    select b.id
    from public.geld_tx b
    where b.account in ('Spuerkeess', 'BDL')
      and b.kind = 'out'
      and not b.is_transfer
      and not b.cat_locked
      and b.merchant ~* 'raoul'
      and exists (
        select 1 from public.geld_tx t
        where t.account = 'Trade Republic'
          and t.kind = 'in'
          and t.type = 'transfer_in'
          and t.amount = b.amount
          and t.at between b.at - interval '1 day'
                       and b.at + interval '4 days'
      )
  ), u as (
    update public.geld_tx g
    set is_transfer = true, cat = 'transfer',
        type = 'transfer_out', updated_at = now()
    from c
    where g.id = c.id
    returning 1
  )
  select count(*)::int from u;
$$;

revoke all on function public.geld_pair_tr_topups()
  from public, anon, authenticated;

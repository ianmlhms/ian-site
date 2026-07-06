-- FakeStake casino: save the play-money balance to the user's account
-- so it follows them across devices (instead of per-browser localStorage).
--
-- Run once in the Supabase SQL editor.

alter table public.profiles add column if not exists casino_balance numeric(14,2);

create or replace function public.set_casino_balance(p_bal numeric)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_bal is null or p_bal < 0 or p_bal > 1000000000 then
    raise exception 'invalid balance';
  end if;
  update public.profiles set casino_balance = round(p_bal, 2) where id = auth.uid();
end; $$;

grant execute on function public.set_casino_balance(numeric) to authenticated;

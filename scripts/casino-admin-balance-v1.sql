-- Admin: set any user's FakeStake (play-money) balance from the admin panel.
-- Requires the casino_balance column from casino-balance-v1.sql.
--
-- Run once in the Supabase SQL editor.

create or replace function public.admin_set_casino_balance(p_user_id uuid, p_bal numeric)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  if p_bal is null or p_bal < 0 or p_bal > 1000000000 then
    raise exception 'invalid balance';
  end if;
  update public.profiles set casino_balance = round(p_bal, 2) where id = p_user_id;
end; $$;

grant execute on function public.admin_set_casino_balance(uuid, numeric) to authenticated;

-- "Do I have an account?" — the sign-in dialog asks whether a username or an
-- e-mail address belongs to an account. Answers only yes/no (never which
-- account or any other detail). Callable while signed out (anon).
-- Run with: supabase db query --linked -f scripts/account-exists-v1.sql

create or replace function public.account_exists(p_identifier text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select case
    when char_length(trim(coalesce(p_identifier, ''))) not between 3 and 254 then false
    when position('@' in p_identifier) > 0 then exists (
      select 1 from auth.users u where lower(u.email) = lower(trim(p_identifier)))
    else exists (
      select 1 from public.profiles p where lower(p.username) = lower(trim(p_identifier)))
  end
$function$;

revoke all on function public.account_exists(text) from public;
grant execute on function public.account_exists(text) to anon, authenticated;

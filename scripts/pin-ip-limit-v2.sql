-- Login throttle per address, v2 (27 Nov 2026).
-- At school every iPad leaves through ONE public address (Restena). v1 allowed 10 attempts and
-- 4 different accounts per address in 15 minutes, counting successful logins too: the fifth
-- classmate to sign in got "wrong username or PIN" for 15 minutes. Now 40 attempts / 25 accounts.
-- Guessing stays slow: every account locks itself after wrong PINs (fail_pin: 1 min, 5 min, 30 min).
create or replace function public.use_pin_ip(p_key text, p_target text)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
  declare
    v_attempts int;
    v_targets int;
  begin
    update public.pin_ip_throttle
      set window_start = now(),
          attempts = 0,
          target_keys = array[]::text[]
      where ip_key = p_key
        and window_start < now() - interval '15 minutes';
    insert into public.pin_ip_throttle(ip_key, window_start, attempts, target_keys, updated_at)
    values (p_key, now(), 1, array[p_target], now())
    on conflict (ip_key) do update
      set attempts = pin_ip_throttle.attempts + 1,
          target_keys = case
            when p_target = any(pin_ip_throttle.target_keys) then pin_ip_throttle.target_keys
            else array_append(pin_ip_throttle.target_keys, p_target)
          end,
          updated_at = now()
    returning attempts, cardinality(target_keys) into v_attempts, v_targets;
    return v_attempts <= 40 and v_targets <= 25;
  end
$function$;
revoke all on function public.use_pin_ip(text, text) from public, anon, authenticated;
grant execute on function public.use_pin_ip(text, text) to service_role;

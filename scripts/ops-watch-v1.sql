-- =============================================
-- External watchdog read access (15 Nov 2026).
-- The Oracle VM "watch" (Always Free micro, Frankfurt) checks
-- ian.lu, mc.ian.lu and the home machines from OUTSIDE the home
-- network. The home machines are behind NAT, so it reads their
-- heartbeats (service_heartbeats, written by the ops edge
-- function) through this function.
-- The key lives in Vault as 'ops_watch_key' and on the VM in
-- /etc/ian-watch/env. Returns only service names + times.
-- Idempotent.
-- =============================================

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'ops_watch_key') then
    perform vault.create_secret(encode(gen_random_bytes(24), 'hex'),
      'ops_watch_key', 'Key for the Oracle watch VM (ops_watch_status)');
  end if;
end $$;

create or replace function public.ops_watch_status(p_key text)
returns jsonb language plpgsql stable security definer
set search_path = public as $$
declare v_key text;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets
   where name = 'ops_watch_key';
  if v_key is null or p_key is distinct from v_key then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return jsonb_build_object('now', now(), 'beats', coalesce((
    select jsonb_object_agg(h.service, h.beat_at)
      from service_heartbeats h
     where h.service in ('brix', 'mini')), '{}'::jsonb));
end $$;
revoke all on function public.ops_watch_status(text) from public;
grant execute on function public.ops_watch_status(text) to anon;

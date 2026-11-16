-- =============================================================
-- security-fix-face-v2.sql  (face login hardening, 16 Nov 2026)  -- NOT APPLIED YET
-- Idempotent: safe to run more than once.
--
-- ORDER (each step only after the previous one worked):
--   1. SQL (this file):
--        supabase db query --linked -f scripts/security-fix-face-v2.sql
--   2. Edge function (verify_jwt stays ON, as today):
--        supabase functions deploy auth-face --project-ref lvksqmgfwkfbblfsozfk
--      (do NOT pass --no-verify-jwt; auth-pin is unchanged and needs no deploy)
--   3. Site: push the branch (auth.js ?v=47, quick-login.js ?v=2, auth-ui.js ?v=12,
--      face-scan.js ?v=2, assets/face/1.7.15/ self-hosted face-api).
--
-- What changes
-- 1. Re-auth before enrolling: auth-face only creates a face device after it
--    checked the account's PIN (or the old password) again. Devices made by the
--    v1 function (no re-auth) are deleted here; those players see "scan your
--    face again" and sign in with their PIN meanwhile.  reauth_at is set only by
--    the new function, so a row the OLD function inserts between step 1 and
--    step 2 is refused by the new function too.
-- 2. Rotating device secret: every successful face login swaps the stored hash
--    for a new one (compare-and-swap on the old hash). The last 10 retired hashes
--    are kept; a replayed old secret revokes (deletes) that device.
--    Unused for 60 days -> the device expires (refused and deleted).
-- 3. Device list for the profile: face_devices_mine() / face_device_delete()
--    only ever see or touch auth.uid()'s own rows. face_devices_forget_all()
--    (security-fix-face-devices-v1.sql, live) stays as it is.
-- 4. No face login for admin accounts (app_admins): refused at enrol and at
--    login (the device is deleted), and existing admin devices are deleted here.
--
-- How it could break something
-- * Nobody is locked out: PIN / password / passkey logins never read this
--   table. A refused face login only drops back to the PIN dialog.
-- * Every face device enrolled with v1 is deleted (the feature is 1 day old).
-- * A face login whose answer never reaches the iPad (Wi-Fi drop after the
--   server rotated) leaves an old secret on the device; the next try counts as
--   a replay and revokes that device -> PIN login + scan again. Acceptable.
-- =============================================================

-- ---------- 1. columns ----------
alter table public.face_devices add column if not exists name text not null default '';
alter table public.face_devices add column if not exists reauth_at timestamptz;
alter table public.face_devices add column if not exists rotated_at timestamptz;
alter table public.face_devices add column if not exists retired_hashes text[] not null default '{}';

-- v1 devices were enrolled with a session only (no PIN check): re-enrol.
delete from public.face_devices where reauth_at is null;

-- ---------- 2. helpers (service role only) ----------
create or replace function public.face_user_is_admin(p_user uuid)
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1
      from auth.users u
      join public.app_admins a on lower(a.email) = lower(u.email)
     where u.id = p_user
  );
$function$;

-- Admins never keep a face device.
delete from public.face_devices d where public.face_user_is_admin(d.user_id);

create or replace function public.face_device_expired(p_created timestamptz, p_used timestamptz)
 returns boolean
 language sql
 stable
as $function$
  select coalesce(p_used, p_created) < now() - interval '60 days';
$function$;

/* New device after auth-face checked the PIN/password. Drops expired devices,
 * keeps at most 8 per account (oldest go first). Returns the new id. */
create or replace function public.face_device_enroll(p_user uuid, p_hash text, p_name text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_id uuid;
  v_max constant integer := 8;
begin
  if p_user is null or p_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'bad input' using errcode = '22023';
  end if;
  if public.face_user_is_admin(p_user) then
    raise exception 'admin accounts cannot use face login' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('face_devices:' || p_user::text));
  delete from public.face_devices
   where public.face_device_expired(created_at, last_used_at);
  delete from public.face_devices
   where id in (
     select id from public.face_devices
      where user_id = p_user
      order by coalesce(last_used_at, created_at) desc
      offset v_max - 1
   );
  insert into public.face_devices(user_id, secret_hash, name, reauth_at)
  values (p_user, p_hash, left(coalesce(p_name, ''), 40), now())
  returning id into v_id;
  return v_id;
end $function$;

/* Step 1 of a face login: is this the device's CURRENT secret?
 *   ok        -> account = the user id; nothing changed yet (auth-face mints the session, then rotates)
 *   unknown   -> no such device / wrong secret
 *   replayed  -> an old (rotated-away) secret: the device is deleted
 *   expired   -> unused for 60 days: deleted
 *   reenroll  -> enrolled without re-auth (v1): deleted
 *   admin     -> admin account: deleted */
create or replace function public.face_device_check(p_device uuid, p_hash text)
 returns table(result text, account uuid)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  d public.face_devices%rowtype;
begin
  select * into d from public.face_devices where id = p_device for update;
  if not found then
    return query select 'unknown'::text, null::uuid;
    return;
  end if;
  if d.secret_hash <> p_hash then
    if p_hash = any(d.retired_hashes) then
      delete from public.face_devices where id = d.id;
      return query select 'replayed'::text, d.user_id;
      return;
    end if;
    return query select 'unknown'::text, null::uuid;
    return;
  end if;
  if d.reauth_at is null then
    delete from public.face_devices where id = d.id;
    return query select 'reenroll'::text, d.user_id;
    return;
  end if;
  if public.face_device_expired(d.created_at, d.last_used_at) then
    delete from public.face_devices where id = d.id;
    return query select 'expired'::text, d.user_id;
    return;
  end if;
  if public.face_user_is_admin(d.user_id) then
    delete from public.face_devices where id = d.id;
    return query select 'admin'::text, d.user_id;
    return;
  end if;
  return query select 'ok'::text, d.user_id;
end $function$;

/* Step 2: compare-and-swap the secret. False when someone else used (and
 * rotated) the same secret in between; the caller then refuses the login. */
create or replace function public.face_device_rotate(p_device uuid, p_old_hash text, p_new_hash text)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if p_new_hash !~ '^[0-9a-f]{64}$' or p_new_hash = p_old_hash then
    raise exception 'bad input' using errcode = '22023';
  end if;
  update public.face_devices
     set secret_hash = p_new_hash,
         retired_hashes = (array_prepend(p_old_hash, retired_hashes))[1:10],
         rotated_at = now(),
         last_used_at = now()
   where id = p_device
     and secret_hash = p_old_hash
     and reauth_at is not null;
  return found;
end $function$;

revoke all on function public.face_user_is_admin(uuid) from public, anon, authenticated;
revoke all on function public.face_device_expired(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.face_device_enroll(uuid, text, text) from public, anon, authenticated;
revoke all on function public.face_device_check(uuid, text) from public, anon, authenticated;
revoke all on function public.face_device_rotate(uuid, text, text) from public, anon, authenticated;
grant execute on function public.face_user_is_admin(uuid) to service_role;
grant execute on function public.face_device_expired(timestamptz, timestamptz) to service_role;
grant execute on function public.face_device_enroll(uuid, text, text) to service_role;
grant execute on function public.face_device_check(uuid, text) to service_role;
grant execute on function public.face_device_rotate(uuid, text, text) to service_role;

-- ---------- 3. the player's own device list (profile) ----------
create or replace function public.face_devices_mine()
 returns table(id uuid, name text, created_at timestamptz, last_used_at timestamptz)
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select d.id, d.name, d.created_at, d.last_used_at
    from public.face_devices d
   where d.user_id = auth.uid()
     and d.reauth_at is not null
     and not public.face_device_expired(d.created_at, d.last_used_at)
   order by coalesce(d.last_used_at, d.created_at) desc;
$function$;

create or replace function public.face_device_delete(p_id uuid)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  delete from public.face_devices where id = p_id and user_id = auth.uid();
  return found;
end $function$;

revoke all on function public.face_devices_mine() from public, anon;
revoke all on function public.face_device_delete(uuid) from public, anon;
grant execute on function public.face_devices_mine() to authenticated;
grant execute on function public.face_device_delete(uuid) to authenticated;

-- ---------- check ----------
select
  (select count(*) from public.face_devices) as devices_left,
  (select count(*) from public.face_devices where reauth_at is null) as v1_devices_left,
  (select string_agg(proname, ', ' order by proname) from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in ('face_user_is_admin', 'face_device_expired', 'face_device_enroll',
                      'face_device_check', 'face_device_rotate', 'face_devices_mine',
                      'face_device_delete', 'face_devices_forget_all')) as functions;

-- =============================================================
-- security-fix-face-devices-v1.sql  (audit 15 Nov 2026)  -- NOT APPLIED YET
-- Run:  supabase db query --linked -f scripts/security-fix-face-devices-v1.sql
-- Idempotent. No client change needed (a "sign out all faces" button
-- can use face_devices_forget_all() later).
--
-- Face login as built today (auth-face + face-scan.js) is sound on the
-- server: a session is only minted for a 256-bit device key whose
-- SHA-256 is stored, enrolling needs a signed-in session, karting
-- accounts are refused, nothing is guessable. What is missing:
--
-- LOW/MEDIUM  A device key never expires and nothing ever revokes it.
--   The face match itself runs in the browser, so the key in
--   localStorage IS the login: whoever once had a player's session
--   (borrowed iPad, stolen token) can call  auth-face {action:"enroll"}
--   and keeps a way back in for good - changing the password, the PIN
--   or "sign out everywhere" does not remove it, and the player has no
--   list of enrolled devices (max 8).
--     -> a password change (own, recovery link, admin_set_password)
--        deletes that account's face devices,
--     -> face_devices_forget_all(): the player removes all of them.
--
-- How it could break something
-- * After a password change the player logs in once with password / PIN
--   / passkey and scans the face again on each device (quick-login.js
--   already drops a refused device key and shows the normal login).
--   Nobody is locked out: face login is only ever an extra way in.
-- * The trigger sits on auth.users. It swallows its own errors (same
--   pattern as signup_soft_ban), so it can never block a password change.
-- * PIN logins do not change the password (they use a magic-link token),
--   so they do not trigger this.
-- =============================================================

create or replace function public.face_devices_drop_on_password_change()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if new.encrypted_password is distinct from old.encrypted_password then
    delete from public.face_devices where user_id = new.id;
  end if;
  return null;
exception when others then
  raise warning 'face device cleanup failed: %', sqlerrm;
  return null;   -- never break a password change
end $function$;

drop trigger if exists face_devices_drop_on_password_change on auth.users;
create trigger face_devices_drop_on_password_change
  after update of encrypted_password on auth.users
  for each row execute function public.face_devices_drop_on_password_change();

create or replace function public.face_devices_forget_all()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare n integer;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  delete from public.face_devices where user_id = auth.uid();
  get diagnostics n = row_count;
  return n;
end $function$;

revoke all on function public.face_devices_forget_all() from public, anon;
grant execute on function public.face_devices_forget_all() to authenticated;

-- ---------- check ----------
select tgname, tgenabled from pg_trigger
 where tgname = 'face_devices_drop_on_password_change';

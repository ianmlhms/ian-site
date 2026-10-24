-- ===========================================================================
-- Karting accounts for the KartTracker iPhone app (same model as the Garmin
-- watch: a random 32-hex device token, linked once on kart-link.html).
--
-- 1. kart_share gains an optional p_device_token. With a token, a new share
--    is saved to the account the token is linked to (and adopted later by
--    kart_link_device if it isn't linked yet), exactly like kart_insert does
--    for the watch. An existing share without an owner is adopted on update.
--    Returns saved_to_account. The 3-argument call keeps working.
-- 2. kart_unlink_token: the device itself (holder of the token) unlinks.
-- 3. kart_delete_my_account: a karting account deletes itself with all its
--    sessions and devices (App Store rule 5.1.1(v): accounts that can be
--    created must be deletable). Full ian.lu accounts are refused here.
-- Idempotent.
-- ===========================================================================

drop function if exists public.kart_share(uuid, jsonb, text);

create or replace function public.kart_share(p_id uuid, p_payload jsonb, p_edit_key text,
                                             p_device_token text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text;
  v_device text;
  v_user uuid;
  v_owner uuid;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'kart_share: payload must be a JSON object' using errcode = '22023';
  end if;
  if lower(p_payload->>'id') is distinct from p_id::text then
    raise exception 'kart_share: payload id must match p_id' using errcode = '22023';
  end if;
  if p_edit_key is null or length(p_edit_key) < 32 or length(p_edit_key) > 128 then
    raise exception 'kart_share: edit key must be 32-128 characters' using errcode = '22023';
  end if;
  v_hash := encode(sha256(convert_to(p_edit_key, 'UTF8')), 'hex');

  if p_device_token is not null then
    v_device := public.kart_token_hash(p_device_token);
    update public.kart_devices set last_seen_at = now()
     where token_hash = v_device
    returning user_id into v_user;
  end if;

  insert into public.kart_sessions as s (id, payload, edit_key_hash, user_id, device_hash)
  values (p_id, p_payload, v_hash, v_user, v_device)
  on conflict (id) do update
     set payload = excluded.payload,
         user_id = coalesce(s.user_id, excluded.user_id),
         device_hash = coalesce(s.device_hash, excluded.device_hash)
   where s.edit_key_hash = excluded.edit_key_hash
  returning s.user_id into v_owner;

  if not found then
    raise exception 'kart_share: this link belongs to another device' using errcode = '42501';
  end if;
  return jsonb_build_object('id', p_id, 'saved_to_account', v_owner is not null);
end $$;

revoke all on function public.kart_share(uuid, jsonb, text, text) from public;
grant execute on function public.kart_share(uuid, jsonb, text, text) to anon, authenticated;

-- "Unlink this iPhone" in the app. Sessions already saved stay in the account.
create or replace function public.kart_unlink_token(p_token text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.kart_devices where token_hash = public.kart_token_hash(p_token);
  return found;
end $$;

revoke all on function public.kart_unlink_token(text) from public;
grant execute on function public.kart_unlink_token(text) to anon, authenticated;

-- "Delete my karting account" on My karting. kart_sessions.user_id and
-- kart_devices.user_id cascade from auth.users, as do profiles.
create or replace function public.kart_delete_my_account()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'kart_delete_my_account: sign in first' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles p where p.id = v_uid and p.account_kind = 'kart') then
    raise exception 'kart_delete_my_account: only karting accounts can be deleted here' using errcode = '42501';
  end if;
  delete from public.kart_sessions where user_id = v_uid;
  delete from public.kart_devices where user_id = v_uid;
  delete from auth.users where id = v_uid;
  return found;
end $$;

revoke all on function public.kart_delete_my_account() from public;
grant execute on function public.kart_delete_my_account() to authenticated;

notify pgrst, 'reload schema';

-- ===========================================================================
-- KartTracker iPhone app share RPC (KartTracker, formerly KartTracker 2).
--
-- Why: the iPhone app shared with a REST upsert (on_conflict=id,
-- merge-duplicates). Since security-hardening-v1 (1 Jul 2026) kart_sessions
-- has no SELECT policy, and ON CONFLICT DO UPDATE needs one, so every
-- "Share Web Link" has failed with 42501 / HTTP 401 since then (verified
-- 2026-10-24).
--
-- kart_share inserts a session or, when it already exists, overwrites it —
-- but only for the device that created it: the app sends a random edit key
-- per share (>= 32 chars), only its SHA-256 is stored, and an update needs
-- the same key. Rows without a key (Garmin uploads, pre-July iPhone shares)
-- can never be overwritten through this function; the app then re-shares
-- under a new id. The 600 KB payload cap still applies.
--
-- Also drops kart_update: an anon UPDATE policy that could not match any row
-- without a SELECT policy, so it was dead and misleading. Idempotent.
-- ===========================================================================

alter table public.kart_sessions add column if not exists edit_key_hash text;

create or replace function public.kart_share(p_id uuid, p_payload jsonb, p_edit_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text;
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

  insert into public.kart_sessions as s (id, payload, edit_key_hash)
  values (p_id, p_payload, v_hash)
  on conflict (id) do update
     set payload = excluded.payload
   where s.edit_key_hash = excluded.edit_key_hash;

  if not found then
    raise exception 'kart_share: this link belongs to another device' using errcode = '42501';
  end if;
  return jsonb_build_object('id', p_id);
end $$;

revoke all on function public.kart_share(uuid, jsonb, text) from public;
grant execute on function public.kart_share(uuid, jsonb, text) to anon, authenticated;

drop policy if exists kart_update on public.kart_sessions;

-- "Stop Sharing" in the app: deletes the shared copy, again only with the
-- edit key of the device that shared it. Returns false if nothing matched.
create or replace function public.kart_unshare(p_id uuid, p_edit_key text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_edit_key is null or length(p_edit_key) < 32 or length(p_edit_key) > 128 then
    raise exception 'kart_unshare: edit key must be 32-128 characters' using errcode = '22023';
  end if;
  delete from public.kart_sessions
   where id = p_id
     and edit_key_hash = encode(sha256(convert_to(p_edit_key, 'UTF8')), 'hex');
  return found;
end $$;

revoke all on function public.kart_unshare(uuid, text) from public;
grant execute on function public.kart_unshare(uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';

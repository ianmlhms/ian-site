-- ===========================================================================
-- KartTracker watch upload RPC (Garmin Connect IQ app, KartTrackerGarmin).
--
-- STATUS: applied to production 2026-09-26 (verified: reject / insert / 409 / read-back).
-- The Garmin app v1.1 posts to /rest/v1/rpc/kart_insert, so this had to exist
-- in production before that version is published to the Connect IQ Store.
--
-- Why: the watch used a REST upsert with `Prefer: return=representation`,
-- because Connect IQ rejects an empty response body (error -400). Since
-- security-hardening-v1 (1 Jul 2026) there is no SELECT policy on
-- kart_sessions, and returning the inserted row needs one, so every watch
-- upload has failed with 42501 / HTTP 401 since then (verified 2026-09-26).
--
-- This definer function inserts the session and echoes only its id, so the
-- watch gets a JSON body without needing any read access to the table.
-- anon can already INSERT directly (policy kart_insert: with check true);
-- this path is narrower: insert-only (an id collision raises
-- unique_violation / HTTP 409 instead of overwriting), the payload must be a
-- JSON object whose id matches, and the 600 KB payload cap still applies.
-- The iPhone app is unaffected (it keeps its return=minimal upsert).
-- Idempotent.
-- ===========================================================================

create or replace function public.kart_insert(p_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'kart_insert: payload must be a JSON object'
      using errcode = '22023';
  end if;
  if lower(p_payload->>'id') is distinct from p_id::text then
    raise exception 'kart_insert: payload id must match p_id'
      using errcode = '22023';
  end if;

  insert into public.kart_sessions (id, payload) values (p_id, p_payload);
  return jsonb_build_object('id', p_id);
end $$;

revoke all on function public.kart_insert(uuid, jsonb) from public;
grant execute on function public.kart_insert(uuid, jsonb) to anon, authenticated;

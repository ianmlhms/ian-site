-- =============================================================
-- security-fix-calls-v1.sql   (audit 15 Nov 2026)  -- NOT APPLIED YET
-- Run:  supabase db query --linked -f scripts/security-fix-calls-v1.sql
-- Idempotent. Belongs to the call.html + rtc-ring.js changes of the same
-- commit. ORDER: run this SQL first, then deploy the two files.
--
-- What it closes
-- HIGH  A video call rings over the Realtime broadcast channel
--   "rtc:<user id>". Broadcast channels here are public: there are no
--   policies on realtime.messages and the pages do not use private
--   channels, so ANYBODY holding the public anon key (no account needed)
--   can send
--     { event:"ring", payload:{ callId, from:<any uuid>, to:<victim>,
--                               fromName:"<name of a friend>" } }
--   to any player (user ids are public on every leaderboard). The banner
--   shows the name the sender typed; "answer" opens call.html, turns on
--   camera + microphone and connects to whoever sits in "call:<callId>".
--   A stranger gets a live video call with a pupil while posing as a
--   friend. The friends check only existed for the Web Push path (notify).
--
-- The fix: the ring that counts is a server row.
--   caller  -> call_ring(to, callId)   : server checks auth.uid(), kart
--                                        block, accepted friendship, rate
--   callee  -> call_incoming()         : the calls really made to me, with
--                                        the caller's real username
--   The broadcast is only a "look now" hint. rtc-ring.js shows a banner
--   only for a row from call_incoming(); call.html (answer side) refuses
--   a link whose call is not in call_incoming().
--
-- How it could break something
-- * Until BOTH sides run the new files: an updated callee does not ring
--   for a caller who still has the old call.html cached (no server row),
--   and answering from a push notification of such a caller shows
--   "Invalid call link". Old callee + new caller keeps working. Bump
--   rtc-ring.js?v= on all pages when deploying so this window is short.
-- * Calls are friends-only now on the server too (the UI and the push
--   path already were).
-- * If this SQL is NOT applied, the new files fall back to the old
--   behaviour (they only do that when the RPC does not exist).
-- * NOT fixed here (phase 2, one line in call.html, see RING_SENDS_CALL_ID):
--   the hint still carries the callId so old cached pages keep ringing.
--   Somebody listening on "rtc:<victim>" can still read a real callId and
--   join "call:<callId>" (sees SDP/IP addresses, could race the real
--   caller's offer). Set RING_SENDS_CALL_ID = false about a week after
--   deploying; then the callId only travels through call_incoming().
-- =============================================================

create table if not exists public.call_rings(
  call_id text primary key
    check (call_id ~ '^[A-Za-z0-9.-]{1,80}$'),
  from_user uuid not null
    references auth.users(id) on delete cascade,
  to_user uuid not null
    references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists call_rings_to_idx
  on public.call_rings(to_user, created_at);
create index if not exists call_rings_from_idx
  on public.call_rings(from_user, created_at);
alter table public.call_rings enable row level security;
revoke all on public.call_rings from public, anon, authenticated;
grant all on public.call_rings to service_role;

-- The caller registers the call. false = not allowed (not friends).
create or replace function public.call_ring(p_to uuid, p_call_id text)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  c_max_per_minute constant integer := 6;
  c_keep constant interval := interval '10 minutes';
  uid uuid := auth.uid();
  recent integer;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  perform public.assert_not_kart();
  if p_call_id is null or p_call_id !~ '^[A-Za-z0-9.-]{1,80}$' then
    raise exception 'bad call id' using errcode = '22023';
  end if;
  if p_to is null or p_to = uid
     or not public.mp_are_friends(uid, p_to) then
    return false;
  end if;
  select count(*) into recent from public.call_rings
   where from_user = uid and created_at > now() - interval '1 minute';
  if recent >= c_max_per_minute then
    raise exception 'too many calls, wait a minute';
  end if;
  delete from public.call_rings where created_at < now() - c_keep;
  insert into public.call_rings (call_id, from_user, to_user)
  values (p_call_id, uid, p_to)
  on conflict (call_id) do nothing;
  return exists (select 1 from public.call_rings
                  where call_id = p_call_id
                    and from_user = uid and to_user = p_to);
end $function$;

-- The calls made to me in the last 3 minutes (newest first).
create or replace function public.call_incoming(p_call_id text default null)
 returns table(call_id text, from_user uuid, from_name text, age_seconds integer)
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select r.call_id, r.from_user, p.username,
         greatest(0, extract(epoch from now() - r.created_at))::integer
    from public.call_rings r
    join public.profiles p on p.id = r.from_user
   where r.to_user = auth.uid()
     and r.created_at > now() - interval '3 minutes'
     and (p_call_id is null or r.call_id = p_call_id)
   order by r.created_at desc
   limit 5
$function$;

-- Caller hangs up before the answer, or the callee declines.
create or replace function public.call_cancel(p_call_id text)
 returns void
 language sql
 security definer
 set search_path to 'public'
as $function$
  delete from public.call_rings
   where call_id = p_call_id
     and auth.uid() in (from_user, to_user)
$function$;

revoke all on function public.call_ring(uuid, text) from public, anon;
revoke all on function public.call_incoming(text) from public, anon;
revoke all on function public.call_cancel(text) from public, anon;
grant execute on function public.call_ring(uuid, text) to authenticated;
grant execute on function public.call_incoming(text) to authenticated;
grant execute on function public.call_cancel(text) to authenticated;

select proname, has_function_privilege('anon', oid, 'execute') as anon_can,
       has_function_privilege('authenticated', oid, 'execute') as user_can
  from pg_proc
 where pronamespace = 'public'::regnamespace
   and proname in ('call_ring', 'call_incoming', 'call_cancel')
 order by proname;

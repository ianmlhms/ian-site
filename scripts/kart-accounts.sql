-- ===========================================================================
-- KartTracker accounts: link a Garmin watch to an ian.lu account so every
-- session it uploads is saved to that account (Garmin app v1.4+).
--
-- Flow: the watch keeps a random 128-bit device token (32 hex chars) and shows
-- a QR code for https://ian.lu/kart-link.html?t=<token>. A signed-in user opens
-- it and calls kart_link_device(); from then on kart_insert() attaches that
-- watch's uploads to the user. Watches send their token with EVERY upload, so
-- linking later also adopts the watch's earlier, still-unowned sessions.
-- Only sha256(token) is stored.
--
-- Also locks direct REST writes on kart_sessions to (id, payload): the iPhone
-- app's upsert (merge-duplicates, id + payload) keeps working, but user_id /
-- device_hash can only be set by the definer functions below.
--
-- Depends on: kart-setup.sql, security-hardening-v1.sql, kart-insert-rpc.sql,
-- profiles (username = display name). Idempotent; run as one transaction.
-- Applied 2026-10-07 from the KartTracker session (contract agreed with the
-- ian.lu session, which builds kart-link.html / the "My karting" page).
-- ===========================================================================

begin;

-- ---- 1) watches ------------------------------------------------------------
create table if not exists public.kart_devices (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  token_hash   text not null unique,
  name         text not null default 'Garmin watch',
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz
);
alter table public.kart_devices enable row level security;
-- RPC-only: no policies, no direct grants.
revoke all on public.kart_devices from anon, authenticated;

-- ---- 2) session owner + uploading watch ------------------------------------
-- GPS tracks are personal data: deleting the account deletes its sessions.
alter table public.kart_sessions
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists device_hash text;
create index if not exists kart_sessions_user_idx   on public.kart_sessions (user_id, created_at desc);
create index if not exists kart_sessions_device_idx on public.kart_sessions (device_hash);

-- REST writes limited to the shared row contract (iPhone app upsert).
revoke insert, update on public.kart_sessions from anon, authenticated;
grant insert (id, payload) on public.kart_sessions to anon, authenticated;
grant update (id, payload) on public.kart_sessions to anon, authenticated;

-- ---- 3) helpers --------------------------------------------------------------
create or replace function public.kart_token_hash(p_token text)
returns text language plpgsql immutable set search_path = public as $$
begin
  if p_token is null or p_token !~ '^[0-9a-fA-F]{32}$' then
    raise exception 'kart: device token must be 32 hex characters'
      using errcode = '22023';
  end if;
  return encode(sha256(convert_to(lower(p_token), 'UTF8')), 'hex');
end $$;
revoke all on function public.kart_token_hash(text) from public, anon, authenticated;

-- ---- 4) upload (replaces the 2-argument version) -----------------------------
-- Dropped and recreated in this transaction: a second overload next to the
-- old one would make 2-argument calls ambiguous for PostgREST. v1.2/v1.3
-- watches keep calling with two arguments and hit the default.
drop function if exists public.kart_insert(uuid, jsonb);
create or replace function public.kart_insert(p_id uuid, p_payload jsonb,
                                              p_device_token text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_hash text;
  v_user uuid;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'kart_insert: payload must be a JSON object' using errcode = '22023';
  end if;
  if lower(p_payload->>'id') is distinct from p_id::text then
    raise exception 'kart_insert: payload id must match p_id' using errcode = '22023';
  end if;

  if p_device_token is not null then
    v_hash := public.kart_token_hash(p_device_token);
    update public.kart_devices set last_seen_at = now()
     where token_hash = v_hash
    returning user_id into v_user;
  end if;

  insert into public.kart_sessions (id, payload, user_id, device_hash)
  values (p_id, p_payload, v_user, v_hash);
  return jsonb_build_object('id', p_id, 'saved_to_account', v_user is not null);
end $$;
revoke all on function public.kart_insert(uuid, jsonb, text) from public;
grant execute on function public.kart_insert(uuid, jsonb, text) to anon, authenticated;

-- ---- 5) watch: am I linked? ----------------------------------------------------
create or replace function public.kart_device_status(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_name text;
  v_found boolean;
begin
  select p.username, true into v_name, v_found
    from public.kart_devices d
    left join public.profiles p on p.id = d.user_id
   where d.token_hash = public.kart_token_hash(p_token);
  return jsonb_build_object('linked', coalesce(v_found, false), 'name', v_name);
end $$;
revoke all on function public.kart_device_status(text) from public;
grant execute on function public.kart_device_status(text) to anon, authenticated;

-- ---- 6) signed-in user: link / list / unlink watches ----------------------------
-- Whoever holds the watch controls it: linking an already-linked token moves it.
create or replace function public.kart_link_device(p_token text, p_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_hash text;
  v_device uuid;
  v_adopted integer;
begin
  if v_uid is null then
    raise exception 'kart_link_device: sign in first' using errcode = '42501';
  end if;
  v_hash := public.kart_token_hash(p_token);

  insert into public.kart_devices (user_id, token_hash, name)
  values (v_uid, v_hash, coalesce(left(nullif(btrim(p_name), ''), 40), 'Garmin watch'))
  on conflict (token_hash) do update
     set user_id = excluded.user_id, name = excluded.name, created_at = now()
  returning id into v_device;

  -- adopt this watch's earlier sessions that nobody owns yet
  update public.kart_sessions set user_id = v_uid
   where device_hash = v_hash and user_id is null;
  get diagnostics v_adopted = row_count;

  return jsonb_build_object('device_id', v_device, 'adopted_sessions', v_adopted);
end $$;

create or replace function public.kart_my_devices()
returns table (id uuid, name text, created_at timestamptz, last_seen_at timestamptz,
               session_count bigint)
language sql stable security definer set search_path = public as $$
  select d.id, d.name, d.created_at, d.last_seen_at,
         (select count(*) from public.kart_sessions s
           where s.device_hash = d.token_hash and s.user_id = d.user_id)
    from public.kart_devices d
   where d.user_id = auth.uid()
   order by d.created_at desc;
$$;

-- Unlinking stops future attachment; already-saved sessions stay in the account.
create or replace function public.kart_unlink_device(p_device_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  delete from public.kart_devices where id = p_device_id and user_id = auth.uid();
  return found;
end $$;

-- ---- 7) signed-in user: sessions -------------------------------------------------
-- Summaries only; the full session is still read through kart_get(id).
create or replace function public.kart_my_sessions()
returns table (id uuid, created_at timestamptz, session_date text, track_name text,
               lap_count integer, best_lap double precision, source text)
language sql stable security definer set search_path = public as $$
  select k.id, k.created_at, k.payload->>'date', k.payload->>'trackName',
         coalesce(jsonb_array_length(k.payload->'lapTimes'), 0),
         (select min((v)::double precision)
            from jsonb_array_elements_text(coalesce(k.payload->'lapTimes', '[]'::jsonb)) as v),
         k.payload->>'source'
    from public.kart_sessions k
   where k.user_id = auth.uid()
   order by k.created_at desc;
$$;

create or replace function public.kart_rename_session(p_id uuid, p_name text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update public.kart_sessions
     set payload = jsonb_set(payload, '{trackName}',
                             coalesce(to_jsonb(left(nullif(btrim(p_name), ''), 60)), 'null'::jsonb))
   where id = p_id and user_id = auth.uid();
  return found;
end $$;

create or replace function public.kart_delete_my_session(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  delete from public.kart_sessions where id = p_id and user_id = auth.uid();
  return found;
end $$;

-- "Save to my account" from a share link. Owned sessions can never be taken.
-- A session uploaded by a v1.4+ watch can only be claimed by that watch's
-- owner (link the watch instead); legacy sessions without a device can be
-- claimed by whoever holds the link — the link is the capability.
create or replace function public.kart_claim(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'kart_claim: sign in first' using errcode = '42501';
  end if;
  update public.kart_sessions s set user_id = v_uid
   where s.id = p_id and s.user_id is null
     and (s.device_hash is null
          or s.device_hash in (select d.token_hash from public.kart_devices d
                                where d.user_id = v_uid));
  return found;
end $$;

-- signed-in only (anon named explicitly: Supabase's default privileges grant it
-- EXECUTE on every new function, which `from public` alone doesn't undo)
revoke all on function public.kart_link_device(text, text) from public, anon;
revoke all on function public.kart_my_devices() from public, anon;
revoke all on function public.kart_unlink_device(uuid) from public, anon;
revoke all on function public.kart_my_sessions() from public, anon;
revoke all on function public.kart_rename_session(uuid, text) from public, anon;
revoke all on function public.kart_delete_my_session(uuid) from public, anon;
revoke all on function public.kart_claim(uuid) from public, anon;
grant execute on function public.kart_link_device(text, text)   to authenticated;
grant execute on function public.kart_my_devices()              to authenticated;
grant execute on function public.kart_unlink_device(uuid)       to authenticated;
grant execute on function public.kart_my_sessions()             to authenticated;
grant execute on function public.kart_rename_session(uuid, text) to authenticated;
grant execute on function public.kart_delete_my_session(uuid)   to authenticated;
grant execute on function public.kart_claim(uuid)               to authenticated;

commit;

-- =============================================
-- Face login v1 ("Mam Gesiicht aloggen").
-- Run once before deploying auth-face.
-- Idempotent.
--
-- The face itself is NEVER stored here: the face
-- scan and the match run on the player's own
-- device, and its face template stays in that
-- browser's localStorage. This table only holds
-- one random device key per enrolled device
-- (SHA-256 hash, never the key itself), which
-- auth-face trades for a normal Supabase session
-- once the face check on that device passed.
-- Only the service role (auth-face) can touch it.
-- =============================================
create table if not exists public.face_devices(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null
    references auth.users(id) on delete cascade,
  secret_hash text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index if not exists face_devices_user_idx
  on public.face_devices(user_id, created_at);
alter table public.face_devices
  enable row level security;
revoke all on public.face_devices
  from public, anon, authenticated;
grant all on public.face_devices to service_role;

-- ===========================================================================
-- KartTracker shared sessions. The iPhone app uploads a session as JSON; the
-- public page kart.html?s=<id> reads it back by its (unguessable) UUID.
-- Sessions are "public by link": readable by anyone who has the UUID, but the
-- id is a random UUID so they're effectively unlisted. Paste into Supabase ▸
-- SQL Editor ▸ Run. Idempotent.
-- ===========================================================================

create table if not exists public.kart_sessions (
  id         uuid primary key,                       -- the app's KartSession.id
  payload    jsonb not null,
  created_at timestamptz not null default now(),
  -- cap payload size so a runaway GPS track can't bloat the row (~600 KB).
  constraint kart_payload_size check (length(payload::text) < 600000)
);
alter table public.kart_sessions enable row level security;

-- Anyone with the UUID may read it (public-by-link viewer).
drop policy if exists kart_read on public.kart_sessions;
create policy kart_read on public.kart_sessions for select using (true);

-- The app uploads with the public anon key; allow insert + upsert-by-id (so
-- re-sharing the same session overwrites it), but never delete from the client.
drop policy if exists kart_insert on public.kart_sessions;
create policy kart_insert on public.kart_sessions for insert with check (true);
drop policy if exists kart_update on public.kart_sessions;
create policy kart_update on public.kart_sessions for update using (true) with check (true);

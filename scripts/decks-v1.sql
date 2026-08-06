-- decks-v1.sql — PPT Builder (ppt.html)
-- Private, own-only presentation studio. Idempotent: safe to re-run.
-- Run: supabase db query --linked -f scripts/decks-v1.sql

-- ---------------------------------------------------------------
-- 1. decks — one row per presentation
-- ---------------------------------------------------------------
create table if not exists public.decks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid()
    references auth.users on delete cascade,
  title text not null default 'Ouni Titel',
  subject text,
  lang text not null default 'de',
  presenters jsonb not null default '[]'::jsonb,
  source_text text,
  slides jsonb not null default '[]'::jsonb,
  style jsonb not null default '{}'::jsonb,
  engine text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.decks enable row level security;

drop policy if exists decks_own on public.decks;
create policy decks_own on public.decks
  for all to authenticated using (user_id = auth.uid());

create index if not exists decks_user_updated
  on public.decks (user_id, updated_at desc);

-- ---------------------------------------------------------------
-- 2. deck_jobs — queue for the Mac-mini generator (phase 4)
--    Written only by the service role (edge fn + DeckWorker).
--    The page reads its own rows and polls until status='done'.
-- ---------------------------------------------------------------
create table if not exists public.deck_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null
    references auth.users on delete cascade,
  status text not null default 'queued',
  request jsonb not null,
  result jsonb,
  error text,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint deck_jobs_status_valid check (
    status in ('queued', 'running', 'done', 'error')
  )
);

alter table public.deck_jobs enable row level security;

-- read-only for the owner; all writes go through the service role
drop policy if exists deck_jobs_own_read on public.deck_jobs;
create policy deck_jobs_own_read on public.deck_jobs
  for select to authenticated using (user_id = auth.uid());

create index if not exists deck_jobs_queued
  on public.deck_jobs (status, created_at)
  where status in ('queued', 'running');

-- ---------------------------------------------------------------
-- 3. service_heartbeats — is the mini alive?
--    No policies on purpose: service role only.
-- ---------------------------------------------------------------
create table if not exists public.service_heartbeats (
  service text primary key,
  beat_at timestamptz not null default now(),
  note text
);

alter table public.service_heartbeats enable row level security;

-- ---------------------------------------------------------------
-- 4. deck-uploads bucket — teacher handouts (PDF/DOCX/photos)
--    Private. Object path must start with the owner's uid.
-- ---------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('deck-uploads', 'deck-uploads', false)
on conflict (id) do nothing;

drop policy if exists deck_uploads_own on storage.objects;
create policy deck_uploads_own on storage.objects
  for all to authenticated
  using (
    bucket_id = 'deck-uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'deck-uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

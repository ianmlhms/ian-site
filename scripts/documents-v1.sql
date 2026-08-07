-- documents-v1.sql — Word Builder (doc.html)
-- Private, own-only document studio. Idempotent: safe to re-run.
-- Run: supabase db query --linked -f scripts/documents-v1.sql

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid()
    references auth.users on delete cascade,
  title text not null default 'Ouni Titel',
  subject text,
  lang text not null default 'de',
  kind text not null default 'free',
  source_text text,
  blocks jsonb not null default '[]'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  engine text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.documents enable row level security;

drop policy if exists documents_own on public.documents;
create policy documents_own on public.documents
  for all to authenticated using (user_id = auth.uid());

create index if not exists documents_user_updated
  on public.documents (user_id, updated_at desc);

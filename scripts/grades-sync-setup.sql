-- Grade calculator — sync each user's grade sheets to their account.
-- Paste into Supabase ▸ SQL Editor ▸ New query ▸ Run.

create table if not exists public.grade_sheets (
  user_id    uuid not null references auth.users(id) on delete cascade,
  sheet_key  text not null,            -- e.g. "5e (classique)" or "1ère | C – Sciences naturelles"
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, sheet_key)
);

alter table public.grade_sheets enable row level security;

-- Each user can only see and change their own sheets.
drop policy if exists grade_sheets_own on public.grade_sheets;
create policy grade_sheets_own on public.grade_sheets
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

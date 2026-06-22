-- ===========================================================================
-- WebUntis homework sync — storage table (admin-only).
-- The `webuntis-sync` Edge Function (service role) upserts rows; only the admin
-- (konto@ian.lu) can read them. Paste into Supabase ▸ SQL Editor ▸ Run.
-- ===========================================================================

create table if not exists public.homework (
  id            bigint primary key,        -- WebUntis homework id
  subject       text,
  assigned_date date,
  due_date      date,
  text          text,
  remark        text,
  completed     boolean not null default false,
  synced_at     timestamptz not null default now()
);
alter table public.homework enable row level security;

-- Only the admin can read homework (it's personal). The Edge Function writes via
-- the service-role key, which bypasses RLS — so no insert/update policy needed.
drop policy if exists homework_admin_read on public.homework;
create policy homework_admin_read on public.homework for select using (public.is_admin());

-- ===========================================================================
-- Class-scoped features: homework board + class chat + personal timetable.
-- Paste into Supabase ▸ SQL Editor ▸ New query ▸ Run. Idempotent (safe re-run).
-- Needs profiles + is_admin() (scripts/messenger-setup-v2.sql) and the `class`
-- column (scripts/class-v1.sql).
-- ===========================================================================

-- Caller's own school class, as a SECURITY DEFINER helper so the RLS policies
-- below can scope rows to "same class as me" without exposing profiles writes.
-- Returns NULL when the user hasn't set a class (then class-scoped rows are
-- neither readable nor insertable for them — they must set a class first).
create or replace function public.my_class()
returns text language sql security definer stable set search_path = public as $$
  select class from public.profiles where id = auth.uid();
$$;
grant execute on function public.my_class() to authenticated;

-- ---------------------------------------------------------------------------
-- 1) Class homework board — a shared per-class assignment list.
-- ---------------------------------------------------------------------------
create table if not exists public.class_homework(
  id         uuid primary key default gen_random_uuid(),
  class      text not null,
  subject    text check (subject is null or char_length(subject) <= 40),
  title      text not null check (char_length(title) between 1 and 200),
  due        date,
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.class_homework enable row level security;

drop policy if exists class_hw_read   on public.class_homework;
drop policy if exists class_hw_insert on public.class_homework;
drop policy if exists class_hw_delete on public.class_homework;
-- read + add only inside your own class; only the author (or an admin) may delete
create policy class_hw_read on public.class_homework for select to authenticated
  using (class = public.my_class());
create policy class_hw_insert on public.class_homework for insert to authenticated
  with check (class = public.my_class() and created_by = auth.uid());
create policy class_hw_delete on public.class_homework for delete to authenticated
  using (created_by = auth.uid() or public.is_admin());
create index if not exists class_homework_class_idx on public.class_homework(class, due);

-- ---------------------------------------------------------------------------
-- 2) Class chat — one live room per class (Supabase Realtime).
-- ---------------------------------------------------------------------------
create table if not exists public.class_chat(
  id         uuid primary key default gen_random_uuid(),
  class      text not null,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
alter table public.class_chat enable row level security;

drop policy if exists class_chat_read   on public.class_chat;
drop policy if exists class_chat_insert on public.class_chat;
drop policy if exists class_chat_delete on public.class_chat;
create policy class_chat_read on public.class_chat for select to authenticated
  using (class = public.my_class());
create policy class_chat_insert on public.class_chat for insert to authenticated
  with check (class = public.my_class() and user_id = auth.uid());
create policy class_chat_delete on public.class_chat for delete to authenticated
  using (user_id = auth.uid() or public.is_admin());
create index if not exists class_chat_class_idx on public.class_chat(class, created_at);

-- add to the realtime publication once (the ALTER errors if already a member)
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'class_chat'
  ) then
    alter publication supabase_realtime add table public.class_chat;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3) Personal weekly timetable — private, one jsonb blob per user.
-- ---------------------------------------------------------------------------
create table if not exists public.timetables(
  user_id    uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.timetables enable row level security;

drop policy if exists timetable_rw on public.timetables;
create policy timetable_rw on public.timetables for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Quinn: remove his school class (he's not a student — no class tag).
-- ---------------------------------------------------------------------------
update public.profiles set class = null
where id = (select id from auth.users where lower(email) = 'quinn@mulheims.lu');

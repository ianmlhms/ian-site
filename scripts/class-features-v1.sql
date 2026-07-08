-- Class board / class chat / timetable.
-- Short lines so nothing wraps. Run it all once.
-- Safe: brand-new empty tables, no data lost.

drop table if exists public.class_homework cascade;
drop table if exists public.class_chat cascade;
drop table if exists public.timetables cascade;
drop function if exists public.my_class() cascade;

create function public.my_class()
  returns text
  language sql
  security definer
  stable
  set search_path = public
  as 'select class from profiles where id = auth.uid()';

grant execute
  on function public.my_class()
  to authenticated;

create table public.class_homework(
  id uuid primary key default gen_random_uuid(),
  class text not null,
  subject text,
  title text not null,
  due date,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);

alter table public.class_homework
  enable row level security;

create policy class_hw_read
  on public.class_homework
  for select to authenticated
  using (class = public.my_class());

create policy class_hw_insert
  on public.class_homework
  for insert to authenticated
  with check (
    class = public.my_class()
    and created_by = auth.uid()
  );

create policy class_hw_delete
  on public.class_homework
  for delete to authenticated
  using (
    created_by = auth.uid()
    or public.is_admin()
  );

create index class_homework_class_idx
  on public.class_homework(class, due);

create table public.class_chat(
  id uuid primary key default gen_random_uuid(),
  class text not null,
  user_id uuid not null default auth.uid(),
  body text not null,
  created_at timestamptz not null default now()
);

alter table public.class_chat
  enable row level security;

create policy class_chat_read
  on public.class_chat
  for select to authenticated
  using (class = public.my_class());

create policy class_chat_insert
  on public.class_chat
  for insert to authenticated
  with check (
    class = public.my_class()
    and user_id = auth.uid()
  );

create policy class_chat_delete
  on public.class_chat
  for delete to authenticated
  using (
    user_id = auth.uid()
    or public.is_admin()
  );

create index class_chat_class_idx
  on public.class_chat(class, created_at);

alter publication supabase_realtime
  add table public.class_chat;

create table public.timetables(
  user_id uuid primary key default auth.uid(),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.timetables
  enable row level security;

create policy timetable_rw
  on public.timetables
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

update public.profiles
  set class = null
  where id = (
    select id from auth.users
    where lower(email) = 'quinn@mulheims.lu'
  );

-- devoirs-v1.sql — HomeworkBot's solution + à-rendre PDFs on ian.lu/homework.html (Nov 2026).
-- Run: supabase db query --linked -f scripts/devoirs-v1.sql   (needs is_admin(), messenger-setup-v2.sql)
-- Writes happen only through the devoir-ingest edge function (service role); only the admin can read.

create table if not exists public.homework_solutions(
  homework_id   bigint primary key,
  subject       text,
  due_date      date,
  task_text     text,
  status        text not null check (status in ('solved','needs_scan','nothing_to_do','failed')),
  summary       text,
  ask           text,
  solution_path text,
  handin_path   text,
  done          boolean not null default false,
  updated_at    timestamptz not null default now()
);

alter table public.homework_solutions enable row level security;

drop policy if exists homework_solutions_admin_select on public.homework_solutions;
create policy homework_solutions_admin_select on public.homework_solutions
  for select to authenticated using (public.is_admin());

drop policy if exists homework_solutions_admin_update on public.homework_solutions;
create policy homework_solutions_admin_update on public.homework_solutions
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- The admin may change the "done" tick only; everything else comes from the ingest function.
revoke all on public.homework_solutions from anon, authenticated;
grant select on public.homework_solutions to authenticated;
grant update (done) on public.homework_solutions to authenticated;

-- Private bucket: PDFs readable (via signed URLs) by the admin only; writes by the service role only.
insert into storage.buckets (id, name, public)
values ('devoirs', 'devoirs', false)
on conflict (id) do update set public = false;

drop policy if exists devoirs_admin_read on storage.objects;
create policy devoirs_admin_read on storage.objects
  for select to authenticated using (bucket_id = 'devoirs' and public.is_admin());

-- 8 Nov 2026: "Page remplie" PDF (book/dossier page with the answers written on it)
alter table public.homework_solutions add column if not exists filled_path text;

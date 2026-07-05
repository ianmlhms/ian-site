-- ===========================================================================
-- Study Buddy — saved conversations with 14-day retention.
-- Paste into Supabase ▸ SQL Editor ▸ New query ▸ Run. Idempotent (safe to re-run).
-- Owner-only RLS: each user sees only their own chats. A daily pg_cron job deletes
-- anything older than 14 days; the page also filters reads to <14 days as a backstop.
-- ===========================================================================

create table if not exists public.buddy_conversations (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid(),
  mode       text not null,
  subject    text,
  title      text,
  messages   jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.buddy_conversations enable row level security;

drop policy if exists bc_owner_select on public.buddy_conversations;
create policy bc_owner_select on public.buddy_conversations
  for select to authenticated using (user_id = auth.uid());

drop policy if exists bc_owner_insert on public.buddy_conversations;
create policy bc_owner_insert on public.buddy_conversations
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists bc_owner_update on public.buddy_conversations;
create policy bc_owner_update on public.buddy_conversations
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists bc_owner_delete on public.buddy_conversations;
create policy bc_owner_delete on public.buddy_conversations
  for delete to authenticated using (user_id = auth.uid());

create index if not exists bc_user_updated on public.buddy_conversations (user_id, updated_at desc);

-- ---- 14-day retention via pg_cron (best-effort; read filter is the backstop) ----
do $$
begin
  execute 'create extension if not exists pg_cron';
  perform cron.schedule(
    'buddy-purge', '23 3 * * *',
    'delete from public.buddy_conversations where updated_at < now() - interval ''14 days''');
exception when others then
  raise notice 'pg_cron not scheduled (enable it in Dashboard > Database > Extensions, then re-run). %', sqlerrm;
end $$;

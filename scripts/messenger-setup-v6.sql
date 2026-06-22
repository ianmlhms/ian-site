-- ===========================================================================
-- Messenger v6 — emoji reactions + message editing.
-- (Typing indicator, online dots, per-chat mute, search and voice messages are
--  client-only and need no SQL — voice reuses the existing chat-media bucket.)
-- Paste into Supabase ▸ SQL Editor ▸ Run. Idempotent.
-- ===========================================================================

-- ---- 1) Emoji reactions ---------------------------------------------------
create table if not exists public.message_reactions (
  message_id bigint not null references public.messages(id) on delete cascade,
  group_id   bigint not null references public.groups(id)   on delete cascade,
  user_id    uuid   not null references auth.users(id)      on delete cascade,
  username   text   not null,
  emoji      text   not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);
alter table public.message_reactions enable row level security;
alter table public.message_reactions replica identity full;  -- DELETE events carry group_id

drop policy if exists reactions_read on public.message_reactions;
create policy reactions_read on public.message_reactions for select using (
  exists (select 1 from public.group_members m
          where m.group_id = message_reactions.group_id and m.user_id = auth.uid()));

drop policy if exists reactions_insert on public.message_reactions;
create policy reactions_insert on public.message_reactions for insert with check (
  user_id = auth.uid()
  and exists (select 1 from public.group_members m
              where m.group_id = message_reactions.group_id and m.user_id = auth.uid()));

drop policy if exists reactions_delete on public.message_reactions;
create policy reactions_delete on public.message_reactions for delete using (user_id = auth.uid());

do $$ begin
  if not exists (select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='message_reactions') then
    alter publication supabase_realtime add table public.message_reactions;
  end if;
end $$;

-- ---- 2) Edit your own messages --------------------------------------------
alter table public.messages add column if not exists edited_at timestamptz;
drop policy if exists messages_update_own on public.messages;
create policy messages_update_own on public.messages for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

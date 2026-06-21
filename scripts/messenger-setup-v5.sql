-- ===========================================================================
-- Messenger v5 — read receipts (WhatsApp-style ✓ / ✓✓ "read").
-- Builds on chat_reads from v4. Paste into Supabase ▸ SQL Editor ▸ Run. Idempotent.
-- ===========================================================================

-- 1) Let members SEE each other's read timestamps *within a chat they share*.
--    (v4's chat_reads_own policy stays for insert/update — own rows only.)
drop policy if exists chat_reads_read_group on public.chat_reads;
create policy chat_reads_read_group on public.chat_reads for select using (
  exists (select 1 from public.group_members m
          where m.group_id = chat_reads.group_id and m.user_id = auth.uid())
);

-- 2) Stream chat_reads over realtime so the sender's ticks turn "read" live
--    when the recipient opens the chat.
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_reads'
  ) then
    alter publication supabase_realtime add table public.chat_reads;
  end if;
end $$;

-- Class chat removed from the site (23 Sep 2026, at Ian's request).
-- Why: signups are auto-confirmed and set_class() is self-service, so anyone
-- could claim a class and read its chat. The page is gone; this closes the
-- table itself, which the API would otherwise still serve.
-- The rows are KEPT (drop the table separately if they should go too).
drop policy if exists class_chat_read on public.class_chat;
drop policy if exists class_chat_insert on public.class_chat;
drop policy if exists class_chat_delete on public.class_chat;
revoke all on public.class_chat from anon, authenticated;
do $$
begin
  if exists (select 1 from pg_publication_tables
             where pubname = 'supabase_realtime'
               and schemaname = 'public' and tablename = 'class_chat') then
    alter publication supabase_realtime drop table public.class_chat;
  end if;
end $$;

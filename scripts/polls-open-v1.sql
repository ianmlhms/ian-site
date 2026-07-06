-- Open up Ëmfroen (polls): let any signed-in user create and manage their OWN
-- polls (previously admin-only). Voting already works for every signed-in user.
--
-- Run once in the Supabase SQL editor.

drop policy if exists polls_admin_insert on public.polls;
create policy polls_insert_any on public.polls
  for insert to authenticated with check (created_by = auth.uid());

drop policy if exists polls_admin_update on public.polls;
create policy polls_update_own_or_admin on public.polls
  for update to authenticated
  using (public.is_admin() or created_by = auth.uid())
  with check (public.is_admin() or created_by = auth.uid());

drop policy if exists polls_admin_delete on public.polls;
create policy polls_delete_own_or_admin on public.polls
  for delete to authenticated
  using (public.is_admin() or created_by = auth.uid());

-- ===========================================================================
-- KartTracker admin panel: let the admin (konto@ian.lu) delete sessions from
-- karts.html. The list itself reuses the existing public read (so share links
-- keep working); only delete is gated. Paste into Supabase ▸ SQL Editor ▸ Run.
-- Idempotent. Depends on: kart_sessions (kart-setup.sql) and is_admin()
-- (messenger-setup-v2.sql).
-- ===========================================================================

create or replace function public.kart_delete(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'not allowed';
  end if;
  delete from public.kart_sessions where id = p_id;
end $$;
grant execute on function public.kart_delete(uuid) to authenticated;

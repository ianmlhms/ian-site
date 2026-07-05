-- ===========================================================================
-- Study Buddy v1 — per-user daily usage cap for the AI homework tutor.
-- Paste into Supabase ▸ SQL Editor ▸ New query ▸ Run. Idempotent (safe to re-run).
-- The Edge Function `study-buddy` calls ai_usage_bump() with the service role to
-- count each message; the page reads ai_usage (own row) to show the remaining count.
-- ===========================================================================

create table if not exists public.ai_usage (
  user_id uuid not null default auth.uid(),
  day     date not null default current_date,
  count   int  not null default 0,
  primary key (user_id, day)
);
alter table public.ai_usage enable row level security;

-- a user may read ONLY their own usage row (to show "N messages left today")
drop policy if exists ai_usage_read_own on public.ai_usage;
create policy ai_usage_read_own on public.ai_usage
  for select to authenticated using (user_id = auth.uid());

-- atomic increment; returns the new count for today. SECURITY DEFINER so the
-- Edge Function (service role) can bump any user's counter. Not client-callable.
create or replace function public.ai_usage_bump(p_user uuid, p_limit int)
returns int language plpgsql security definer set search_path = public as $$
declare c int;
begin
  insert into public.ai_usage (user_id, day, count)
    values (p_user, current_date, 1)
  on conflict (user_id, day)
    do update set count = public.ai_usage.count + 1
  returning count into c;
  return c;
end; $$;

revoke all on function public.ai_usage_bump(uuid, int) from public, anon, authenticated;

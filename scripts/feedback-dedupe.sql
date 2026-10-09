-- Feedback was saved 10-15 times per click (double submit). Remove the existing
-- duplicates (same user + message + page within 10 minutes, keep the first) and
-- skip new ones server-side. (9 Oct 2026)
delete from public.feedback f
 using public.feedback g
 where f.ctid <> g.ctid
   and f.message = g.message
   and coalesce(f.page, '') = coalesce(g.page, '')
   and coalesce(f.username, '') = coalesce(g.username, '')
   and f.created_at >= g.created_at
   and f.created_at < g.created_at + interval '10 minutes'
   and (f.created_at > g.created_at or f.ctid > g.ctid);

create or replace function public.feedback_skip_duplicates()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.feedback f
              where f.message = new.message
                and coalesce(f.page, '') = coalesce(new.page, '')
                and coalesce(f.username, '') = coalesce(new.username, '')
                and f.created_at > now() - interval '10 minutes') then
    return null;
  end if;
  return new;
end $$;
drop trigger if exists feedback_skip_duplicates on public.feedback;
create trigger feedback_skip_duplicates before insert on public.feedback
  for each row execute function public.feedback_skip_duplicates();

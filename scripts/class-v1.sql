-- ===========================================================================
-- Class tags — store each user's school class on their profile and let them
-- set it via a locked-down RPC (the profiles table has no direct UPDATE policy,
-- so username/avatar/class all change only through SECURITY DEFINER functions).
-- Paste into Supabase ▸ SQL Editor ▸ New query ▸ Run. Idempotent (safe to re-run).
-- Needs profiles (scripts/messenger-setup-v2.sql).
-- ===========================================================================

-- Short free text (e.g. "5C6", "7C1", "2CG", "5e"). Kept small; NULL = not set yet.
alter table public.profiles add column if not exists class text
  check (class is null or char_length(class) <= 12);

-- profiles is already publicly readable (policy profiles_read using(true)), so the
-- class shows up next to names via a plain select — no extra read RPC needed.

-- Set / change my own class. It must be a *specific* class inside a year
-- (5C6, 7C1, 2CG, 4GPS…), not a bare year ("5e", "7", "5EME"). We normalize to a
-- compact upper form (strip spaces/punctuation), then require year-digits +
-- section letters (+ optional class number) and reject the year-only idioms.
-- Same rule the client enforces (class-gate.js). Empty input is rejected.
create or replace function public.set_class(p_class text)
returns void language plpgsql security definer set search_path = public as $$
declare v text := upper(regexp_replace(coalesce(p_class, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  if v = '' or char_length(v) > 12 then
    raise exception 'invalid class';
  end if;
  if v !~ '^[0-9]{1,2}[A-Z]{1,4}[0-9]{0,2}$' or v ~ '^[0-9]{1,2}(E|EME|IEME)?$' then
    raise exception 'class must name a specific class in a year, e.g. 5C6';
  end if;
  update public.profiles set class = v where id = auth.uid();
end; $$;
grant execute on function public.set_class(text) to authenticated;

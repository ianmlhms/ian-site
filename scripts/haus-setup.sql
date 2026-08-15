-- haus-setup.sql — cloud saves for the private Haus-Planer (haus/)
-- Run once with `supabase db query --linked`.
--
-- Each saved house belongs to one account. RLS keeps the two allow-listed
-- accounts fully separate; the page gate controls who can open the planner.

create table if not exists public.house_saves (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  house_id      text        not null,             -- client-generated project id
  name          text,
  style         text,
  variant_count int         default 0,
  thumb         text,                              -- small JPEG data URL for the library
  data          jsonb       not null,             -- full house project
  updated_at    timestamptz not null default now(),
  unique (user_id, house_id)
);

alter table public.house_saves enable row level security;

-- Owner-only access keeps saves separate for every account.
drop policy if exists house_saves_select on public.house_saves;
create policy house_saves_select on public.house_saves
  for select using (user_id = auth.uid());

drop policy if exists house_saves_insert on public.house_saves;
create policy house_saves_insert on public.house_saves
  for insert with check (user_id = auth.uid());

drop policy if exists house_saves_update on public.house_saves;
create policy house_saves_update on public.house_saves
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists house_saves_delete on public.house_saves;
create policy house_saves_delete on public.house_saves
  for delete using (user_id = auth.uid());

-- Upserts should always move a save to the front of the library.
create or replace function public.house_touch()
  returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists house_saves_touch on public.house_saves;
create trigger house_saves_touch
  before update on public.house_saves
  for each row execute function public.house_touch();

grant select, insert, update, delete on public.house_saves to authenticated;

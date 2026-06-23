-- hotel-setup.sql — cloud saves for the private Hotel-Simulator (hotel.html)
-- Run once in the Supabase SQL editor.
--
-- Each saved hotel belongs to ONE account. RLS makes a row visible/editable only
-- to its owner, so saves are fully separate per user (konto@ian.lu and his brother
-- each see only their own hotels). The page itself is gated client-side to the two
-- allow-listed emails in hotel.html — this table just stores the saves.

create table if not exists public.hotel_saves (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  hotel_id   text        not null,                 -- client-generated id (uid()) per hotel
  name       text,
  style      text,
  buildings  int         default 0,
  ts         bigint,                               -- client save timestamp (ms) for ordering in the UI
  data       jsonb       not null,                 -- full hotel state
  updated_at timestamptz not null default now(),
  unique (user_id, hotel_id)
);

alter table public.hotel_saves enable row level security;

-- Owner-only access (separate saves per account).
drop policy if exists hotel_saves_select on public.hotel_saves;
create policy hotel_saves_select on public.hotel_saves
  for select using (user_id = auth.uid());

drop policy if exists hotel_saves_insert on public.hotel_saves;
create policy hotel_saves_insert on public.hotel_saves
  for insert with check (user_id = auth.uid());

drop policy if exists hotel_saves_update on public.hotel_saves;
create policy hotel_saves_update on public.hotel_saves
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists hotel_saves_delete on public.hotel_saves;
create policy hotel_saves_delete on public.hotel_saves
  for delete using (user_id = auth.uid());

-- Keep updated_at fresh on every upsert/update (used for ordering).
create or replace function public.hotel_touch()
  returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists hotel_saves_touch on public.hotel_saves;
create trigger hotel_saves_touch
  before update on public.hotel_saves
  for each row execute function public.hotel_touch();

grant select, insert, update, delete on public.hotel_saves to authenticated;

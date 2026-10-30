-- Zuch & Tram Sim: a running service ("Weiderfueren") follows the account across devices.
-- The game keeps its snapshot in localStorage; pixelbreak-records.js mirrors it into this table (at most once a minute per slot)
-- and hands the rows back when the game opens. Run once in the Supabase SQL editor. Idempotent.
--
-- slot: the localStorage key without its "pb_resume_" prefix. The Zuch tile, the Tram tile and the lock-less standalone page
--       each have their own slot, so a Zuch service and a Tram service wait side by side.
-- data: the snapshot JSON text as the game wrote it. The game re-validates it on every device (nothing in here is trusted).
-- snap_at: the snapshot's own "at" (the device clock when the ride was saved), used to tell which ride is newer.

create table if not exists public.game_resume (
  user_id    uuid        not null references auth.users(id) on delete cascade,
  slot       text        not null check (slot in ('train-sim', 'train-sim_rail', 'train-sim_tram')),
  data       text        not null check (char_length(data) <= 32768),
  snap_at    timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, slot)
);

alter table public.game_resume enable row level security;

drop policy if exists game_resume_own on public.game_resume;
create policy game_resume_own on public.game_resume
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.game_resume to authenticated;

-- An old device (slept, offline) must never overwrite a newer ride with its stale snapshot:
-- an update whose snap_at is older than the stored one is skipped silently (deletes are always allowed).
create or replace function public.game_resume_keep_newer()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.snap_at < old.snap_at then
    return null;   -- skips this update silently
  end if;
  return new;
end $$;

drop trigger if exists game_resume_keep_newer on public.game_resume;
create trigger game_resume_keep_newer
  before update on public.game_resume
  for each row execute function public.game_resume_keep_newer();

-- Rebirth guard (10 Oct 2026): a save from before a rebirth (lower rebirth count
-- `rbc`) must never overwrite the cloud save, even when offline earnings gave that
-- old device a higher `tb`. Otherwise an old phone could undo a rebirth and lose
-- the stars. Extends the progress guard from game-saves-guard.sql.
create or replace function public.game_saves_keep_progress()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if jsonb_typeof(old.data -> 'rbc') = 'number'
     and jsonb_typeof(new.data -> 'rbc') = 'number'
     and (new.data ->> 'rbc')::numeric < (old.data ->> 'rbc')::numeric then
    return null;   -- older round than the cloud copy: keep the cloud copy
  end if;
  if jsonb_typeof(old.data -> 'rbc') = 'number' and (old.data ->> 'rbc')::numeric > 0
     and jsonb_typeof(new.data -> 'rbc') is distinct from 'number' then
    return null;   -- a pre-rebirth-era save without rbc can't replace a reborn save
  end if;
  if jsonb_typeof(old.data -> 'tb') = 'number'
     and jsonb_typeof(new.data -> 'tb') = 'number'
     and (new.data ->> 'tb')::numeric < (old.data ->> 'tb')::numeric then
    return null;   -- keep the save with more progress (skips this update silently)
  end if;
  return new;
end $$;

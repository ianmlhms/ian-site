-- A game save that has baked/earned LESS than the stored cloud save must never
-- replace it. Happened 8 Oct 2026: Cookie Clicker opened signed out on a device,
-- then sign-in flushed the fresh 0-progress save over 522M cookies.
-- Applies to saves carrying a numeric "tb" (total baked, e.g. Cookie Clicker).
create or replace function public.game_saves_keep_progress()
returns trigger language plpgsql set search_path = public as $$
begin
  if jsonb_typeof(old.data -> 'tb') = 'number'
     and jsonb_typeof(new.data -> 'tb') = 'number'
     and (new.data ->> 'tb')::numeric < (old.data ->> 'tb')::numeric then
    return null;   -- keep the save with more progress (skips this update silently)
  end if;
  return new;
end $$;

drop trigger if exists game_saves_keep_progress on public.game_saves;
create trigger game_saves_keep_progress
  before update on public.game_saves
  for each row execute function public.game_saves_keep_progress();

-- scores.score was int4 (max 2,147,483,647): bigger Cookie Clicker scores failed
-- to save (gigidalessio stuck at 2.147B). bigint goes to 9.2e18; the client
-- already caps at Number.MAX_SAFE_INTEGER.
alter table public.scores alter column score type bigint;

-- MTB Mëllerdall: no trail can be ridden in under 60 seconds (integration wave, 25 Oct 2026).
-- The game already refuses impossible times on the client (every checkpoint in order, time >= trail length / 20 m/s, see pb/mtb/game.js minRunMs); this is the same
-- rule on the server, as a floor for all trail boards (the shortest trail, 1.3 km, takes about 2 minutes). A trail time is stored as 10,000,000 - milliseconds, so a
-- time under 60 s is a score above 9,940,000. Same pattern as scripts/reaction-floor.sql. OPTIONAL but recommended; apply manually, never run by the client.

create or replace function public.mtb_score_floor()
returns trigger language plpgsql as $$
begin
  if new.game_id like 'mtb-%' and new.game_id <> 'mtb-daily' and new.score > 9940000 then
    return null;  -- skip the insert/update silently, keep the old row
  end if;
  return new;
end $$;

drop trigger if exists mtb_score_floor on public.scores;
create trigger mtb_score_floor before insert or update on public.scores
  for each row execute function public.mtb_score_floor();

drop trigger if exists mtb_score_floor on public.weekly_scores;
create trigger mtb_score_floor before insert or update on public.weekly_scores
  for each row execute function public.mtb_score_floor();

-- Remove impossible scores that are already stored (a test ride of 16.3 s showed up in the reviewer's screenshots; it was never posted, this is only a safety net).
delete from public.scores where game_id like 'mtb-%' and game_id <> 'mtb-daily' and score > 9940000;
delete from public.weekly_scores where game_id like 'mtb-%' and game_id <> 'mtb-daily' and score > 9940000;

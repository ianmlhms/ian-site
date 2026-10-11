-- Reaction Time: no human reacts in under 100 ms (11 Oct 2026).
-- A tap that fast after green is a lucky guess, or a score sent without playing.
-- The game already treats it as "too early"; the server now ignores such scores
-- too, in both the all-time board and the Game of the Week board.

create or replace function public.reaction_score_floor()
returns trigger language plpgsql as $$
begin
  if new.game_id = 'reaction' and new.score < 100 then
    return null;  -- skip the insert/update silently, keep the old row
  end if;
  return new;
end $$;

drop trigger if exists reaction_score_floor on public.scores;
create trigger reaction_score_floor before insert or update on public.scores
  for each row execute function public.reaction_score_floor();

drop trigger if exists reaction_score_floor on public.weekly_scores;
create trigger reaction_score_floor before insert or update on public.weekly_scores
  for each row execute function public.reaction_score_floor();

-- Remove impossible scores that are already stored (Nora's 19 ms, 10 Oct 2026).
delete from public.scores where game_id = 'reaction' and score < 100;
delete from public.weekly_scores where game_id = 'reaction' and score < 100;

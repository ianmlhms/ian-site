-- Scores: an update never makes a player's score worse (12 Oct 2026).
-- The arcade now syncs scores at most once a minute and caches the last cloud
-- score instead of reading it before every save (Supabase egress), so a stale
-- tab or a second device could send a lower score. The server keeps the better one.

create or replace function public.scores_keep_best()
returns trigger language plpgsql as $$
begin
  if not public.merge_score_is_better(new.game_id, new.score, old.score)
     and new.score is distinct from old.score then
    new.score := old.score;
    new.updated_at := old.updated_at;
  end if;
  return new;
end $$;

drop trigger if exists scores_keep_best on public.scores;
create trigger scores_keep_best before update on public.scores
  for each row execute function public.scores_keep_best();

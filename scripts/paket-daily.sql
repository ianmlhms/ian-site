-- Paket Express daily route. REVIEW AND APPLY MANUALLY; never run by the client.
-- Requires arcade-weekly-streaks.sql (lux_today), assert_not_kart and merge_score_is_better.
create table if not exists public.daily_scores (
  day date not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  game_id text not null check (game_id = 'paket-express-daily'),
  username text,
  score bigint not null check (score between 0 and 1000000),
  updated_at timestamptz not null default now(),
  primary key (day, user_id, game_id)
);
alter table public.daily_scores enable row level security;
revoke all on table public.daily_scores from public, anon, authenticated;
create index if not exists daily_scores_board on public.daily_scores(day, game_id, score desc, updated_at);

create or replace function public.submit_daily_score(p_game text, p_score bigint)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  affected integer;
begin
  if uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  perform public.assert_not_kart();
  if p_game is distinct from 'paket-express-daily' or p_score is null
     or p_score < 0 or p_score > 1000000 then return false; end if;
  -- ON CONFLICT's row lock + conditional update keep the best even for simultaneous submissions.
  insert into public.daily_scores(day, user_id, game_id, username, score, updated_at)
  values(public.lux_today(), uid, p_game, (select username from public.profiles where id = uid), p_score, now())
  on conflict (day, user_id, game_id) do update
    set score = excluded.score, username = excluded.username, updated_at = excluded.updated_at
    where public.merge_score_is_better(p_game, excluded.score, daily_scores.score);
  get diagnostics affected = row_count;
  return affected > 0;
end $$;
revoke all on function public.submit_daily_score(text,bigint) from public, anon;
grant execute on function public.submit_daily_score(text,bigint) to authenticated;

-- Top 20, plus the caller's row if outside the top 20. Empty days still return ends_at.
create or replace function public.daily_board(p_game text, p_day date default null)
returns table(day date, game_id text, ends_at timestamptz, rank integer,
              user_id uuid, username text, score bigint, is_self boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  perform public.assert_not_kart();
  if p_game is distinct from 'paket-express-daily' then return; end if;
  return query
    with target as (select coalesce(p_day,public.lux_today()) as d),
    ranked as (
      select s.*, (row_number() over(order by s.score desc, s.updated_at, s.user_id))::integer as position
      from public.daily_scores s, target t where s.day = t.d and s.game_id = p_game
    )
    select t.d, p_game, ((t.d + 1)::timestamp at time zone 'Europe/Luxembourg'),
           r.position, r.user_id, coalesce(p.username,r.username), r.score, coalesce(r.user_id = auth.uid(),false)
    from target t
    left join ranked r on r.position <= 20 or r.user_id = auth.uid()
    left join public.profiles p on p.id = r.user_id
    order by r.position nulls last;
end $$;
revoke all on function public.daily_board(text,date) from public, anon;
grant execute on function public.daily_board(text,date) to authenticated;

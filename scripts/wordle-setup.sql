-- ===========================================================================
-- Wuertspill (Wordle) public leaderboard.
-- Paste into Supabase ▸ SQL Editor ▸ Run. Idempotent.
-- ===========================================================================

create table if not exists public.wordle_results (
  user_id    uuid not null references auth.users(id) on delete cascade,
  username   text not null,
  lang       text not null,                 -- 'lb' | 'de'
  day        int  not null,                 -- floor(Date.now()/86400000) = UTC days since epoch
  guesses    int  not null,                 -- 1..6 = solved in N, 0 = failed
  created_at timestamptz not null default now(),
  primary key (user_id, lang, day)
);
alter table public.wordle_results enable row level security;

-- Public read so the leaderboard works even when signed out.
drop policy if exists wordle_read on public.wordle_results;
create policy wordle_read on public.wordle_results for select using (true);
drop policy if exists wordle_insert on public.wordle_results;
create policy wordle_insert on public.wordle_results for insert with check (user_id = auth.uid());

-- Record today's result (first result per day/lang is locked in).
create or replace function public.record_wordle(p_username text, p_lang text, p_day int, p_guesses int)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.wordle_results (user_id, username, lang, day, guesses)
  values (auth.uid(), coalesce(nullif(trim(p_username), ''), 'player'), p_lang, p_day, greatest(0, least(6, p_guesses)))
  on conflict (user_id, lang, day) do nothing;
end $$;
grant execute on function public.record_wordle(text, text, int, int) to authenticated;

-- Leaderboard for a language: wins, win%, avg guesses, and today's result.
create or replace function public.wordle_leaderboard(p_lang text)
returns table(username text, played int, wins int, avg_guesses numeric, today int)
language sql security definer stable set search_path = public as $$
  select r.username,
    count(*)::int,
    count(*) filter (where r.guesses between 1 and 6)::int,
    round(avg(r.guesses) filter (where r.guesses between 1 and 6), 2),
    min(r.guesses) filter (where r.day = floor(extract(epoch from now()) / 86400)::int)
  from public.wordle_results r
  where r.lang = p_lang
  group by r.user_id, r.username
  order by count(*) filter (where r.guesses between 1 and 6) desc,
           round(avg(r.guesses) filter (where r.guesses between 1 and 6), 2) asc nulls last
  limit 100;
$$;
grant execute on function public.wordle_leaderboard(text) to anon, authenticated;

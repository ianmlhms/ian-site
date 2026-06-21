-- PixelBreak — Supabase schema for accounts + high scores.
-- Paste this whole file into the Supabase SQL Editor (Dashboard ▸ SQL Editor ▸ New query) and Run.
-- Auth (email/password) is built in; this only adds the scores table + access rules.

-- One best score per user per game. username is denormalised so the leaderboard
-- needs no join and stays cheap to read from the static site.
create table if not exists public.scores (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  username    text not null,
  game_id     text not null,
  game_name   text,
  score       integer not null,
  updated_at  timestamptz not null default now(),
  unique (user_id, game_id)
);

create index if not exists scores_game_idx on public.scores (game_id, score desc);

alter table public.scores enable row level security;

-- Anyone (even logged-out visitors) may READ scores → public leaderboard.
drop policy if exists "scores public read" on public.scores;
create policy "scores public read" on public.scores
  for select using (true);

-- A signed-in user may only write their OWN rows.
drop policy if exists "scores insert own" on public.scores;
create policy "scores insert own" on public.scores
  for insert with check (auth.uid() = user_id);

drop policy if exists "scores update own" on public.scores;
create policy "scores update own" on public.scores
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- OPTIONAL but recommended for a smooth arcade signup:
-- Dashboard ▸ Authentication ▸ Providers ▸ Email ▸ turn OFF "Confirm email"
-- so new accounts work instantly without an email round-trip.

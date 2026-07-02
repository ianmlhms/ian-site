-- PixelBreak game saves: cloud sync of per-game progress (not just high scores).
-- Run once in the Supabase SQL editor. Idempotent.

create table if not exists public.game_saves (
  user_id    uuid        not null references auth.users(id) on delete cascade,
  game_id    text        not null,
  data       jsonb       not null check (pg_column_size(data) <= 8192),
  updated_at timestamptz not null default now(),
  primary key (user_id, game_id)
);

alter table public.game_saves enable row level security;

drop policy if exists game_saves_own on public.game_saves;
create policy game_saves_own on public.game_saves
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

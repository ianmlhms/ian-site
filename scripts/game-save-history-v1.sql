-- game-save-history-v1.sql (20 Oct 2026)
-- Server-side history for game_saves, so a lost
-- game (Business Empire reset by one wrong tap on
-- 20 Oct 2026) can be restored by an admin.
--
--  * game_save_history: the state a save had just
--    BEFORE an update replaced it. Written by an
--    AFTER UPDATE trigger on game_saves, i.e. only
--    when the update really happened (the
--    keep-progress guard skips rejected ones).
--  * Recorded when the new save is a big drop
--    (reason drop: several numbers halve or the
--    JSON shrinks to under half), at most one per
--    10 minutes, and as a rolling snapshot at most
--    once per 6 h per user and game (rolling).
--  * Kept: newest 10 drop rows and newest 10 other
--    rows per user and game (so a week of rolling
--    snapshots can never push out the pre-reset
--    state).
--  * RLS on, no client privileges at all.
--  * admin_game_save_history / admin_restore_game_save
--    (is_admin() only).
--  * game_saves_keep_progress is replaced: same
--    rules as game-saves-guard-rebirth.sql plus ONE
--    exemption: the in-game Undo of a rebirth sends
--    a save with a numeric ud and rbc exactly one
--    below the cloud copy.
--
-- Needs: game-saves-v1.sql, messenger-setup-v2.sql
-- (is_admin). No dollar quoting, short lines: safe
-- to paste into the Supabase SQL editor.
-- Idempotent. Run:  supabase db query --linked \
--   -f scripts/game-save-history-v1.sql

create table if not exists public.game_save_history (
  id bigint generated always as identity
    primary key,
  user_id uuid not null
    references auth.users(id) on delete cascade,
  game_id text not null,
  data jsonb not null,
  saved_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  reason text not null
    check (reason in
      ('rolling', 'drop', 'before-restore'))
);

create index if not exists
  game_save_history_user_game_idx
  on public.game_save_history
  (user_id, game_id, recorded_at desc);

alter table public.game_save_history
  enable row level security;
revoke all on public.game_save_history
  from public, anon, authenticated;

-- All numeric leaves of a JSON document, with path.
create or replace function
  public.game_save_leaves(p jsonb)
returns table(path text[], val numeric)
language sql immutable
set search_path = public as '
  with recursive walk(path, node) as (
    select array[]::text[], p
    union all
    select w.path || k.key, k.value
    from walk w
    cross join lateral (
      select e.key, e.value from jsonb_each(
        case when jsonb_typeof(w.node) = ''object''
          then w.node
          else jsonb_build_object() end) e
      union all
      select (a.i - 1)::text, a.v
      from jsonb_array_elements(
        case when jsonb_typeof(w.node) = ''array''
          then w.node
          else jsonb_build_array() end)
        with ordinality as a(v, i)
    ) k
  )
  select path, (node #>> ''{}'')::numeric
  from walk
  where jsonb_typeof(node) = ''number''
';

-- Does p_new look like a reset of p_old? Game
-- agnostic: the JSON shrank to under half, or at
-- least 3 (and a third) of the positive numbers in
-- the old save are gone or at most half as big.
create or replace function
  public.game_save_big_drop(
    p_old jsonb, p_new jsonb)
returns boolean
language sql stable
set search_path = public as '
  select case
    when length(p_old::text) < 100 then false
    when length(p_new::text) * 2 <
         length(p_old::text) then true
    else coalesce((
      select count(*) filter (
          where n.val is null
            or n.val * 2 <= o.val) >= 3
        and count(*) filter (
          where n.val is null
            or n.val * 2 <= o.val) * 3
          >= count(*)
      from public.game_save_leaves(p_old) o
      left join public.game_save_leaves(p_new) n
        on n.path = o.path
      where o.val > 0
    ), false)
  end
';

-- Insert one history row and trim to the newest 10
-- of its kind (drop rows / all other rows).
create or replace function
  public.game_save_history_add(
    p_user uuid, p_game text, p_data jsonb,
    p_saved_at timestamptz, p_reason text)
returns void
language plpgsql security definer
set search_path = public as '
begin
  insert into public.game_save_history
    (user_id, game_id, data, saved_at, reason)
  values
    (p_user, p_game, p_data, p_saved_at, p_reason);
  delete from public.game_save_history h
  where h.user_id = p_user
    and h.game_id = p_game
    and (h.reason = ''drop'') = (p_reason = ''drop'')
    and h.id not in (
      select k.id from public.game_save_history k
      where k.user_id = p_user
        and k.game_id = p_game
        and (k.reason = ''drop'')
          = (p_reason = ''drop'')
      order by k.recorded_at desc, k.id desc
      limit 10);
end;
';

create or replace function
  public.game_saves_history()
returns trigger
language plpgsql security definer
set search_path = public as '
declare
  why text;
begin
  if new.data = old.data then
    return null;
  end if;
  if public.game_save_big_drop(old.data, new.data)
     and not exists (
       select 1 from public.game_save_history h
       where h.user_id = old.user_id
         and h.game_id = old.game_id
         and h.reason = ''drop''
         and h.recorded_at >
           now() - interval ''10 minutes'') then
    why := ''drop'';
  elsif not exists (
       select 1 from public.game_save_history h
       where h.user_id = old.user_id
         and h.game_id = old.game_id
         and h.recorded_at >
           now() - interval ''6 hours'') then
    why := ''rolling'';
  end if;
  if why is not null then
    perform public.game_save_history_add(
      old.user_id, old.game_id, old.data,
      old.updated_at, why);
  end if;
  return null;
end;
';

drop trigger if exists game_saves_history
  on public.game_saves;
create trigger game_saves_history
  after update on public.game_saves
  for each row
  execute function public.game_saves_history();

-- The keep-progress guard of
-- game-saves-guard-rebirth.sql plus the Undo
-- exemption.
create or replace function
  public.game_saves_keep_progress()
returns trigger
language plpgsql
set search_path to 'public' as '
begin
  if jsonb_typeof(new.data -> ''ud'') = ''number''
     and jsonb_typeof(old.data -> ''rbc'') = ''number''
     and jsonb_typeof(new.data -> ''rbc'') = ''number''
     and (new.data ->> ''rbc'')::numeric
       = (old.data ->> ''rbc'')::numeric - 1 then
    return new;   -- in-game Undo of the last rebirth
  end if;
  if jsonb_typeof(old.data -> ''rbc'') = ''number''
     and jsonb_typeof(new.data -> ''rbc'') = ''number''
     and (new.data ->> ''rbc'')::numeric
       < (old.data ->> ''rbc'')::numeric then
    return null;   -- older round than the cloud copy
  end if;
  if jsonb_typeof(old.data -> ''rbc'') = ''number''
     and (old.data ->> ''rbc'')::numeric > 0
     and jsonb_typeof(new.data -> ''rbc'')
       is distinct from ''number'' then
    return null;   -- pre-rebirth save: cannot replace
  end if;
  if jsonb_typeof(old.data -> ''tb'') = ''number''
     and jsonb_typeof(new.data -> ''tb'') = ''number''
     and (new.data ->> ''tb'')::numeric
       < (old.data ->> ''tb'')::numeric then
    return null;   -- keep the save with more progress
  end if;
  return new;
end;
';

-- Admin: history of one user (one game or all).
create or replace function
  public.admin_game_save_history(
    p_user uuid, p_game text default null)
returns table(
  id bigint, game_id text, saved_at timestamptz,
  recorded_at timestamptz, reason text,
  size_bytes integer, data jsonb)
language plpgsql security definer
set search_path = public as '
begin
  if not public.is_admin() then
    raise exception ''not authorized'';
  end if;
  return query
    select h.id, h.game_id, h.saved_at,
      h.recorded_at, h.reason,
      pg_column_size(h.data), h.data
    from public.game_save_history h
    where h.user_id = p_user
      and (p_game is null or h.game_id = p_game)
    order by h.recorded_at desc, h.id desc;
end;
';

-- Admin: put a history entry back as the live save.
-- Delete + insert (not update) on purpose: the
-- keep-progress guard would reject an older state.
-- The save being replaced goes to the history first.
create or replace function
  public.admin_restore_game_save(p_id bigint)
returns void
language plpgsql security definer
set search_path = public as '
declare
  h public.game_save_history;
  cur public.game_saves;
begin
  if not public.is_admin() then
    raise exception ''not authorized'';
  end if;
  select * into h
    from public.game_save_history where id = p_id;
  if not found then
    raise exception ''unknown history entry'';
  end if;
  select * into cur from public.game_saves
    where user_id = h.user_id
      and game_id = h.game_id;
  if found then
    perform public.game_save_history_add(
      cur.user_id, cur.game_id, cur.data,
      cur.updated_at, ''before-restore'');
    delete from public.game_saves
      where user_id = h.user_id
        and game_id = h.game_id;
  end if;
  insert into public.game_saves
    (user_id, game_id, data, updated_at)
  values (h.user_id, h.game_id, h.data, now());
end;
';

revoke execute on function
  public.game_save_leaves(jsonb),
  public.game_save_big_drop(jsonb, jsonb),
  public.game_save_history_add(
    uuid, text, jsonb, timestamptz, text),
  public.game_saves_history(),
  public.admin_game_save_history(uuid, text),
  public.admin_restore_game_save(bigint)
  from public, anon, authenticated;

grant execute on function
  public.admin_game_save_history(uuid, text),
  public.admin_restore_game_save(bigint)
  to authenticated;

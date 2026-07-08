-- ==========================================
-- Class season rollover (summer 2026).
-- Two things:
--   1. Schema: a "confirmed my class for the
--      new year" flag + a one-time-bump guard.
--   2. The bump itself: move everyone up a
--      school year (5C6 -> 4C6) on/after
--      9 Jul 2026.
-- Paste ALL of it into Supabase > SQL Editor.
-- Idempotent AND date-guarded: safe to run
-- now (the bump no-ops before 9 Jul) and safe
-- to re-run any number of times (it bumps
-- exactly once, tracked in class_rollovers).
-- No $-quoting, lines <=56 chars (SQL-editor
-- paste rule). Needs profiles + set_class
-- (scripts/class-v1.sql).
-- ==========================================

-- 1a. Per-user flag: which season the user has
-- reconfirmed their class for (set 15 Sep+).
alter table public.profiles
  add column if not exists
  class_confirmed text;

-- 1b. One-time marker table for the year bump
-- so re-running the script never double-bumps.
create table if not exists
  public.class_rollovers(
    season text primary key,
    ran_at timestamptz default now());

alter table public.class_rollovers
  enable row level security;
-- no policies: only the SQL editor / service
-- role touches it; clients never read it.

-- 1c. Stamp "I confirmed my class for the new
-- school year" (called by class-gate.js after
-- 15 Sep). The class value itself is changed
-- via the existing validated set_class RPC.
create or replace function
  public.mark_class_confirmed()
  returns void
  language sql
  security definer
  set search_path = public
  as 'update public.profiles
        set class_confirmed = ''2026-09''
      where id = auth.uid()';

grant execute on function
  public.mark_class_confirmed()
  to authenticated;

-- ==========================================
-- 2. THE BUMP. Runs only on/after 9 Jul 2026
-- and only once (guarded by class_rollovers).
-- Decrements the leading year number by 1
-- (5C6->4C6, 2CG->1CG, 7C1->6C1). Terminal
-- year 1 and malformed classes are left as-is
-- (the 15 Sep reconfirm lets those users fix
-- it by hand).
-- ==========================================
update public.profiles
   set class =
     (substring(
        class from '^([0-9]{1,2})'
      )::int - 1)::text
     || substring(
          class from '^[0-9]{1,2}(.*)$'
        )
 where current_date >= date '2026-07-09'
   and class ~ '^[0-9]{1,2}[A-Z]'
   and substring(
         class from '^([0-9]{1,2})'
       )::int > 1
   and not exists (
     select 1 from public.class_rollovers
     where season = '2026-07');

-- record the bump so it never repeats
insert into public.class_rollovers(season)
  select '2026-07'
  where current_date >= date '2026-07-09'
  on conflict do nothing;

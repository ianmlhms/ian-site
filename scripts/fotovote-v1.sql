-- Fotovote v1: private swipe and duel voting.
-- Idempotent and safe to re-run; no data is dropped.
-- Paste into Supabase ▸ SQL Editor ▸ New query ▸ Run.

-- ---- 1) Voters ----
create table if not exists public.pv_voters (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  token text not null unique,
  is_owner boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.pv_voters
  enable row level security;

revoke all on public.pv_voters
  from anon, authenticated;

-- ---- 2) Photos ----
create table if not exists public.pv_photos (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null,
  thumb_path text not null,
  w integer not null,
  h integer not null,
  taken_at timestamptz,
  day_label text,
  place text,
  cluster_id text,
  contributor text,
  orig_uuid text,
  auto_score numeric not null default 0,
  elo numeric not null default 1500,
  duels integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.pv_photos
  enable row level security;

revoke all on public.pv_photos
  from anon, authenticated;

create index if not exists pv_photos_elo_idx
  on public.pv_photos (elo desc);

create index if not exists pv_photos_cluster_idx
  on public.pv_photos (cluster_id);

-- ---- 3) Swipes ----
create table if not exists public.pv_swipes (
  photo_id uuid not null
    references public.pv_photos (id)
    on delete cascade,
  voter_id uuid not null
    references public.pv_voters (id)
    on delete cascade,
  keep boolean not null,
  created_at timestamptz not null default now(),
  primary key (photo_id, voter_id)
);

alter table public.pv_swipes
  enable row level security;

revoke all on public.pv_swipes
  from anon, authenticated;

create index if not exists pv_swipes_voter_idx
  on public.pv_swipes (voter_id);

create index if not exists pv_swipes_keep_idx
  on public.pv_swipes (photo_id)
  where keep;

-- ---- 4) Duels ----
create table if not exists public.pv_duels (
  id bigint generated always as identity
    primary key,
  voter_id uuid not null
    references public.pv_voters (id)
    on delete cascade,
  a_id uuid not null
    references public.pv_photos (id)
    on delete cascade,
  b_id uuid not null
    references public.pv_photos (id)
    on delete cascade,
  winner_id uuid not null
    references public.pv_photos (id)
    on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.pv_duels
  enable row level security;

revoke all on public.pv_duels
  from anon, authenticated;

create index if not exists pv_duels_voter_idx
  on public.pv_duels (voter_id);

-- ---- 5) Private voter lookup ----
create or replace function public.pv_voter(
  p_token text
)
returns uuid
language sql
security definer
stable
set search_path = public
as '
  select id
  from public.pv_voters
  where token = p_token
';

revoke all on function public.pv_voter(text)
  from public, anon, authenticated;

-- ---- 6) Progress ----
create or replace function public.pv_me(
  p_token text
)
returns table (
  voter_id uuid,
  name text,
  is_owner boolean,
  total int,
  swiped int,
  kept int,
  survivors int,
  my_duels int
)
language plpgsql
security definer
set search_path = public
as '
declare
  v_voter uuid;
begin
  v_voter := public.pv_voter(p_token);
  if v_voter is null then
    raise exception ''invalid_token''
      using errcode = ''28000'';
  end if;

  return query
  select
    v.id,
    v.name,
    v.is_owner,
    (select count(*)::int
       from public.pv_photos),
    (select count(*)::int
       from public.pv_swipes s
      where s.voter_id = v_voter),
    (select count(*)::int
       from public.pv_swipes s
      where s.voter_id = v_voter
        and s.keep),
    (select count(*)::int
       from (
         select s.photo_id
         from public.pv_swipes s
         where s.keep
         group by s.photo_id
         having count(*) >= 2
       ) kept_twice),
    (select count(*)::int
       from public.pv_duels d
      where d.voter_id = v_voter)
  from public.pv_voters v
  where v.id = v_voter;
end;
';

revoke all on function public.pv_me(text)
  from public, authenticated;
grant execute on function public.pv_me(text)
  to anon;

-- ---- 7) Swipe queue ----
create or replace function public.pv_next_swipe(
  p_token text,
  p_n int default 12
)
returns table (
  id uuid,
  storage_path text,
  thumb_path text,
  w int,
  h int,
  day_label text
)
language plpgsql
security definer
set search_path = public
as '
declare
  v_voter uuid;
  v_limit int;
begin
  v_voter := public.pv_voter(p_token);
  if v_voter is null then
    raise exception ''invalid_token''
      using errcode = ''28000'';
  end if;

  v_limit := greatest(1, least(
    coalesce(p_n, 12), 50
  ));

  return query
  select
    p.id,
    p.storage_path,
    p.thumb_path,
    p.w,
    p.h,
    p.day_label
  from public.pv_photos p
  where not exists (
    select 1
    from public.pv_swipes s
    where s.photo_id = p.id
      and s.voter_id = v_voter
  )
  order by md5(p.id::text || v_voter::text)
  limit v_limit;
end;
';

revoke all on function
  public.pv_next_swipe(text, int)
  from public, authenticated;
grant execute on function
  public.pv_next_swipe(text, int)
  to anon;

-- ---- 8) Save and undo swipes ----
create or replace function public.pv_swipe(
  p_token text,
  p_photo uuid,
  p_keep boolean
)
returns void
language plpgsql
security definer
set search_path = public
as '
declare
  v_voter uuid;
begin
  v_voter := public.pv_voter(p_token);
  if v_voter is null then
    raise exception ''invalid_token''
      using errcode = ''28000'';
  end if;

  insert into public.pv_swipes (
    photo_id,
    voter_id,
    keep
  )
  values (
    p_photo,
    v_voter,
    p_keep
  )
  on conflict (photo_id, voter_id)
  do update set keep = excluded.keep;
end;
';

revoke all on function
  public.pv_swipe(text, uuid, boolean)
  from public, authenticated;
grant execute on function
  public.pv_swipe(text, uuid, boolean)
  to anon;

create or replace function public.pv_unswipe(
  p_token text,
  p_photo uuid
)
returns void
language plpgsql
security definer
set search_path = public
as '
declare
  v_voter uuid;
begin
  v_voter := public.pv_voter(p_token);
  if v_voter is null then
    raise exception ''invalid_token''
      using errcode = ''28000'';
  end if;

  delete from public.pv_swipes
  where photo_id = p_photo
    and voter_id = v_voter;
end;
';

revoke all on function
  public.pv_unswipe(text, uuid)
  from public, authenticated;
grant execute on function
  public.pv_unswipe(text, uuid)
  to anon;

-- ---- 9) Duel queue ----
-- Picks the least-dueled survivor that actually has
-- a legal opponent, so one dead-end candidate never
-- makes the client think the duels are finished.
create or replace function public.pv_next_duel(
  p_token text
)
returns table (
  a_id uuid,
  a_path text,
  a_w int,
  a_h int,
  b_id uuid,
  b_path text,
  b_w int,
  b_h int
)
language plpgsql
security definer
set search_path = public
as '
declare
  v_voter uuid;
begin
  v_voter := public.pv_voter(p_token);
  if v_voter is null then
    raise exception ''invalid_token''
      using errcode = ''28000'';
  end if;

  return query
  with survivors as (
    select s.photo_id
    from public.pv_swipes s
    where s.keep
    group by s.photo_id
    having count(*) >= 2
  ),
  pool as (
    select
      p.id,
      p.storage_path,
      p.w,
      p.h,
      p.elo,
      p.cluster_id,
      p.duels
    from public.pv_photos p
    join survivors sv
      on sv.photo_id = p.id
  ),
  cand as (
    select *
    from pool
    order by duels, random()
    limit 25
  )
  select
    a.id,
    a.storage_path,
    a.w,
    a.h,
    b.id,
    b.storage_path,
    b.w,
    b.h
  from cand a
  cross join lateral (
    select
      o.id,
      o.storage_path,
      o.w,
      o.h
    from pool o
    where o.id <> a.id
      and (
        o.cluster_id is null
        or a.cluster_id is null
        or o.cluster_id <> a.cluster_id
      )
      and not exists (
        select 1
        from public.pv_duels d
        where d.voter_id = v_voter
          and (
            (d.a_id = a.id and d.b_id = o.id)
            or
            (d.a_id = o.id and d.b_id = a.id)
          )
      )
    order by abs(o.elo - a.elo),
      o.duels,
      random()
    limit 1
  ) b
  order by a.duels, random()
  limit 1;
end;
';

revoke all on function public.pv_next_duel(text)
  from public, authenticated;
grant execute on function public.pv_next_duel(text)
  to anon;

-- ---- 10) Save a duel and update Elo ----
create or replace function public.pv_duel(
  p_token text,
  p_a uuid,
  p_b uuid,
  p_winner uuid
)
returns void
language plpgsql
security definer
set search_path = public
as '
declare
  v_voter uuid;
  v_elo_a numeric;
  v_elo_b numeric;
  v_count int;
  v_survivors int;
  v_expected_a numeric;
  v_score_a numeric;
  v_k constant numeric := 32;
begin
  v_voter := public.pv_voter(p_token);
  if v_voter is null then
    raise exception ''invalid_token''
      using errcode = ''28000'';
  end if;

  if p_a = p_b
    or p_winner is null
    or p_winner not in (p_a, p_b) then
    raise exception ''bad_duel'';
  end if;

  select
    max(p.elo) filter (where p.id = p_a),
    max(p.elo) filter (where p.id = p_b),
    count(*)::int
  into v_elo_a, v_elo_b, v_count
  from (
    select locked.id, locked.elo
    from public.pv_photos locked
    where locked.id in (p_a, p_b)
    order by locked.id
    for update
  ) p;

  if v_count <> 2 then
    raise exception ''bad_duel'';
  end if;

  select count(*)::int
  into v_survivors
  from (
    select s.photo_id
    from public.pv_swipes s
    where s.keep
      and s.photo_id in (p_a, p_b)
    group by s.photo_id
    having count(*) >= 2
  ) valid;

  if v_survivors <> 2 then
    raise exception ''bad_duel'';
  end if;

  v_expected_a := 1 / (
    1 + power(
      10::numeric,
      (v_elo_b - v_elo_a) / 400
    )
  );
  v_score_a := case when p_winner = p_a
    then 1 else 0 end;

  insert into public.pv_duels (
    voter_id,
    a_id,
    b_id,
    winner_id
  )
  values (
    v_voter,
    p_a,
    p_b,
    p_winner
  );

  update public.pv_photos p
  set
    elo = case
      when p.id = p_a then
        v_elo_a + v_k * (
          v_score_a - v_expected_a
        )
      else
        v_elo_b + v_k * (
          (1 - v_score_a) -
          (1 - v_expected_a)
        )
      end,
    duels = p.duels + 1
  where p.id in (p_a, p_b);
end;
';

revoke all on function
  public.pv_duel(text, uuid, uuid, uuid)
  from public, authenticated;
grant execute on function
  public.pv_duel(text, uuid, uuid, uuid)
  to anon;

-- ---- 11) Owner standings ----
create or replace function public.pv_standings(
  p_token text,
  p_limit int default 300
)
returns table (
  rank int,
  id uuid,
  storage_path text,
  thumb_path text,
  elo numeric,
  duels int,
  keeps int,
  day_label text,
  contributor text
)
language plpgsql
security definer
set search_path = public
as '
declare
  v_voter uuid;
  v_owner boolean;
  v_limit int;
begin
  v_voter := public.pv_voter(p_token);
  if v_voter is null then
    raise exception ''invalid_token''
      using errcode = ''28000'';
  end if;

  select v.is_owner
  into v_owner
  from public.pv_voters v
  where v.id = v_voter;

  if not v_owner then
    raise exception ''not_owner'';
  end if;

  v_limit := greatest(1, least(
    coalesce(p_limit, 300), 1000
  ));

  return query
  select
    row_number() over (
      order by p.elo desc, p.id
    )::int,
    p.id,
    p.storage_path,
    p.thumb_path,
    p.elo,
    p.duels,
    kept.keeps,
    p.day_label,
    p.contributor
  from public.pv_photos p
  join (
    select
      s.photo_id,
      count(*)::int as keeps
    from public.pv_swipes s
    where s.keep
    group by s.photo_id
    having count(*) >= 2
  ) kept on kept.photo_id = p.id
  order by p.elo desc, p.id
  limit v_limit;
end;
';

revoke all on function
  public.pv_standings(text, int)
  from public, authenticated;
grant execute on function
  public.pv_standings(text, int)
  to anon;

-- ---- 12) Public photo bucket ----
insert into storage.buckets (id, name, public)
values ('fotovote', 'fotovote', true)
on conflict (id) do update
set public = true;

-- Deliberately NO policy on storage.objects.
-- A public bucket is served through the public object
-- route, which bypasses RLS, so reads work without one.
-- Granting anon `select` here would additionally allow
-- LISTING the bucket, and unguessable paths are the
-- only thing keeping these photos private.
drop policy if exists fotovote_public_read
  on storage.objects;

-- No client-write policy either. The service role
-- bypasses RLS and is the only role that may upload.
drop policy if exists fotovote_anon_insert
  on storage.objects;
drop policy if exists fotovote_anon_update
  on storage.objects;
drop policy if exists fotovote_anon_delete
  on storage.objects;

-- For future folder-scoped rules, use this form:
-- (storage.foldername(name))[1] = 'folder'

-- ---- 13) Ready-to-edit voter seed ----
-- Change the names here if needed. Existing names are
-- left alone, so re-running does not rotate live links.
insert into public.pv_voters (
  name,
  token,
  is_owner
)
select
  seed.name,
  seed.token,
  seed.is_owner
from (
  values
    (
      'Ian',
      encode(gen_random_bytes(16), 'hex'),
      true
    ),
    (
      'Quinn',
      encode(gen_random_bytes(16), 'hex'),
      false
    ),
    (
      'Papa',
      encode(gen_random_bytes(16), 'hex'),
      false
    )
) as seed (name, token, is_owner)
where not exists (
  select 1
  from public.pv_voters existing
  where existing.name = seed.name
);

-- Read the three private links after the first run:
-- select name, token from public.pv_voters;

-- =============================================
-- PIN authentication v1.
-- Run once before deploying auth-pin.
-- Idempotent. Function bodies use plain strings.
-- Every line is kept at 56 characters or fewer.
-- =============================================
-- pgcrypto is expected in the extensions schema.
create table if not exists public.user_pins(
  user_id uuid primary key,
  pin_hash text not null,
  pin_length int not null,
  failed_attempts int not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.user_pins
  enable row level security;
revoke all on public.user_pins
  from public, anon, authenticated;
grant all on public.user_pins to service_role;
-- The launch time is inserted once. Users created
-- before it remain legacy users forever.
create table if not exists public.pin_auth_meta(
  id int primary key,
  launched_at timestamptz not null default now()
);
alter table public.pin_auth_meta
  enable row level security;
revoke all on public.pin_auth_meta
  from public, anon, authenticated;
grant all on public.pin_auth_meta to service_role;
insert into public.pin_auth_meta(id)
  values (1)
  on conflict (id) do nothing;
-- IPs are keyed by a server-side salted digest. The raw
-- address never enters the database.
create table if not exists public.pin_ip_throttle(
  ip_key text primary key,
  window_start timestamptz not null default now(),
  attempts int not null default 0,
  target_keys text[] not null default array[]::text[],
  updated_at timestamptz not null default now()
);
alter table public.pin_ip_throttle
  add column if not exists target_keys text[]
  not null default array[]::text[];
alter table public.pin_ip_throttle
  enable row level security;
revoke all on public.pin_ip_throttle
  from public, anon, authenticated;
grant all on public.pin_ip_throttle to service_role;
-- Admin resets are durable and server-only.
create table if not exists public.pin_admin_resets(
  id bigint generated always as identity primary key,
  admin_id uuid not null,
  target_id uuid not null,
  target_username text not null,
  created_at timestamptz not null default now()
);
alter table public.pin_admin_resets
  enable row level security;
revoke all on public.pin_admin_resets
  from public, anon, authenticated;
grant all on public.pin_admin_resets to service_role;
-- Email and username resolution stay server-only.
create index if not exists users_email_lower_idx
  on auth.users(lower(email));
create index if not exists profiles_name_lower_idx
  on public.profiles(lower(username));
create or replace function public.lookup_pin_account(
  p_identifier text
)
  returns table(
    account_id uuid,
    account_email text,
    account_created_at timestamptz
  )
  language sql
  security definer
  stable
  set search_path = public, extensions
  as '
  select found.account_id,
         found.account_email,
         found.account_created_at
    from (
      select u.id as account_id,
             u.email::text as account_email,
             u.created_at as account_created_at
        from auth.users as u
        where position(''@'' in p_identifier) > 0
          and lower(u.email) =
            lower(btrim(p_identifier))
      union all
      select u.id as account_id,
             u.email::text as account_email,
             u.created_at as account_created_at
        from public.profiles as p
        join auth.users as u on u.id = p.id
        where position(''@'' in p_identifier) = 0
          and lower(p.username) =
            lower(btrim(p_identifier))
    ) as found
    limit 1';
revoke execute on function
  public.lookup_pin_account(text)
  from public, anon, authenticated;
grant execute on function
  public.lookup_pin_account(text)
  to service_role;
create or replace function public.has_pin()
  returns boolean
  language sql
  security definer
  stable
  set search_path = public, extensions
  as 'select exists(
        select 1 from public.user_pins
        where user_id = auth.uid())';
revoke execute on function public.has_pin()
  from public, anon;
grant execute on function public.has_pin()
  to authenticated;
create or replace function public.verify_pin(
  p_user uuid,
  p_pin text
)
  returns boolean
  language plpgsql
  security definer
  set search_path = public, extensions
  as '
  declare
    v_hash text;
  begin
    select pin_hash into v_hash
      from public.user_pins
      where user_id = p_user;
    v_hash := coalesce(
      v_hash,
      ''$2a$10$xa/7QpVB5UGWgkDYaY8QWOaOZuxW1elGI.''
      || ''uuE3lT.7x130l.dbgoa'');
    return extensions.crypt(p_pin, v_hash) = v_hash;
  end';
revoke execute on function public.verify_pin(
  uuid,
  text
) from public, anon, authenticated;
grant execute on function public.verify_pin(
  uuid,
  text
) to service_role;
create or replace function public.set_pin(
  p_user uuid,
  p_pin text,
  p_length int
)
  returns void
  language plpgsql
  security definer
  set search_path = public, extensions
  as '
  begin
    if p_length not in (4, 6) then
      raise exception ''invalid pin length'';
    end if;
    if p_pin !~ ''^[0-9]+$'' then
      raise exception ''invalid pin shape'';
    end if;
    if length(p_pin) <> p_length then
      raise exception ''invalid pin length'';
    end if;
    insert into public.user_pins(
      user_id,
      pin_hash,
      pin_length,
      failed_attempts,
      locked_until,
      updated_at
    ) values (
      p_user,
      extensions.crypt(
        p_pin,
        extensions.gen_salt(''bf'', 10)),
      p_length,
      0,
      null,
      now()
    )
    on conflict (user_id) do update
      set pin_hash = excluded.pin_hash,
          pin_length = excluded.pin_length,
          failed_attempts = 0,
          locked_until = null,
          updated_at = now();
  end';
revoke execute on function public.set_pin(
  uuid,
  text,
  int
) from public, anon, authenticated;
grant execute on function public.set_pin(
  uuid,
  text,
  int
) to service_role;
create or replace function public.fail_pin(
  p_user uuid
)
  returns void
  language plpgsql
  security definer
  set search_path = public, extensions
  as '
  declare
    v_count int;
    v_length int;
    v_step int;
    v_tier int;
    v_until timestamptz;
  begin
    update public.user_pins
      set failed_attempts = failed_attempts + 1,
          updated_at = now()
      where user_id = p_user
      returning failed_attempts, pin_length
      into v_count, v_length;
    if not found then
      return;
    end if;
    v_step := case when v_length = 4
      then 3 else 5 end;
    if mod(v_count, v_step) <> 0 then
      return;
    end if;
    v_tier := least(3, v_count / v_step);
    v_until := now() + case v_tier
      when 1 then interval ''1 minute''
      when 2 then interval ''5 minutes''
      else interval ''30 minutes''
    end;
    update public.user_pins
      set locked_until = v_until
      where user_id = p_user;
  end';
revoke execute on function public.fail_pin(uuid)
  from public, anon, authenticated;
grant execute on function public.fail_pin(uuid)
  to service_role;
create or replace function public.reset_pin_failures(
  p_user uuid
)
  returns void
  language sql
  security definer
  set search_path = public, extensions
  as 'update public.user_pins
        set failed_attempts = 0,
            locked_until = null,
            updated_at = now()
      where user_id = p_user';
revoke execute on function
  public.reset_pin_failures(uuid)
  from public, anon, authenticated;
grant execute on function
  public.reset_pin_failures(uuid)
  to service_role;
drop function if exists public.use_pin_ip(text);
create or replace function public.use_pin_ip(
  p_key text,
  p_target text
)
  returns boolean
  language plpgsql
  security definer
  set search_path = public, extensions
  as '
  declare
    v_attempts int;
    v_targets int;
  begin
    update public.pin_ip_throttle
      set window_start = now(),
          attempts = 0,
          target_keys = array[]::text[]
      where ip_key = p_key
        and window_start <
          now() - interval ''15 minutes'';
    insert into public.pin_ip_throttle(
      ip_key,
      window_start,
      attempts,
      target_keys,
      updated_at
    ) values (
      p_key,
      now(),
      1,
      array[p_target],
      now()
    )
    on conflict (ip_key) do update
      set attempts = pin_ip_throttle.attempts + 1,
      target_keys = case
        when p_target = any(
          pin_ip_throttle.target_keys)
        then pin_ip_throttle.target_keys
        else array_append(
          pin_ip_throttle.target_keys,
          p_target
        )
      end,
      updated_at = now()
    returning attempts, cardinality(target_keys)
      into v_attempts, v_targets;
    return v_attempts <= 10 and v_targets <= 4;
  end';
revoke execute on function public.use_pin_ip(text, text)
  from public, anon, authenticated;
grant execute on function public.use_pin_ip(text, text)
  to service_role;
drop function if exists public.admin_reset_pin(uuid);
drop function if exists public.admin_reset_pin(
  uuid,
  uuid,
  text
);
drop function if exists public.admin_reset_pin(
  uuid,
  uuid,
  text,
  text[]
);
create or replace function public.admin_reset_pin(
  p_admin uuid,
  p_user uuid,
  p_username text
)
  returns void
  language plpgsql
  security definer
  set search_path = public, extensions
  as '
  begin
    if not exists (
      select 1
        from public.profiles as p
        where p.id = p_user
          and lower(p.username) =
            lower(btrim(p_username))
    ) then
      raise exception ''invalid target'';
    end if;
    delete from public.user_pins
      where user_id = p_user;
    insert into public.pin_admin_resets(
      admin_id,
      target_id,
      target_username
    ) values (
      p_admin,
      p_user,
      p_username
    );
  end';
revoke execute on function
  public.admin_reset_pin(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function
  public.admin_reset_pin(uuid, uuid, text)
  to service_role;

-- Old throttle windows are disposable operational data.
create index if not exists pin_ip_updated_idx
  on public.pin_ip_throttle(updated_at);

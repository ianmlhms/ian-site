-- =============================================
-- Signup IP guard v1 (14 Nov 2026).
-- Automatic action against mass account creation (675
-- scripted accounts on 12-13 Nov). Email confirmation stays
-- OFF on purpose: most players sign up on school iPads.
--
-- Ian's rule: NO real player may ever fail to create an
-- account. So the guard almost never refuses a signup:
--
-- * SOFT (>= 20 signups from one IP in 1 h, or >= 40 in
--   24 h): signups still WORK. The accounts that IP made in
--   the last 24 h, and every new one while it stays above
--   the limit, are kept off the leaderboards (fake scores
--   are the only point of the script). Slack alert in
--   #claude, at most once per hour per IP.
-- * HARD (>= 200 signups from one IP in 1 h): new signups
--   from that IP are refused for 1 hour, only to stop the
--   database being flooded. Real peak so far: 12 signups/
--   hour for the WHOLE site (launch day, 6 Jul); the site
--   has 154 accounts in total. The script did 60-140/hour.
-- * The education network RESTENA (school iPads) is in
--   signup_ip_allow: it can trigger SOFT but never HARD.
-- * Logging in / playing with existing accounts is never
--   affected.
--
-- Lift a flag: delete from signup_ip_flags where ip = '1.2.3.4';
-- Unban an account: delete from leaderboard_bans where user_id = ...;
-- IPs are kept 30 days (pg_cron purge).
-- Enable: Management API PATCH config/auth
--   hook_before_user_created_enabled = true
--   hook_before_user_created_uri =
--     pg-functions://postgres/public/hook_before_user_created
-- Idempotent.
-- =============================================

create table if not exists public.signup_log(
  id bigint generated always as identity primary key,
  ip inet not null,
  email text,
  soft boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists signup_log_ip_time
  on public.signup_log (ip, created_at);
create index if not exists signup_log_email
  on public.signup_log (email);

-- One row per IP that went over a limit.
create table if not exists public.signup_ip_flags(
  ip inet primary key,
  level text not null check (level in ('soft', 'hard')),
  reason text not null,
  until timestamptz not null,
  alerted_at timestamptz,
  created_at timestamptz not null default now()
);

-- Networks that may never be HARD-blocked (school).
create table if not exists public.signup_ip_allow(
  net cidr primary key,
  note text
);
insert into public.signup_ip_allow(net, note)
select n::cidr, 'RESTENA (AS2602), education network'
  from unnest(array['158.64.0.0/16', '185.149.137.0/24',
    '185.149.138.0/23', '192.103.2.0/24', '192.172.253.0/24',
    '193.168.1.0/24', '193.168.64.0/18', '193.168.80.0/24',
    '2001:a18::/29']) n
on conflict do nothing;

do $$
declare t text;
begin
  foreach t in array array['signup_log', 'signup_ip_flags',
                           'signup_ip_allow'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- Slack note to #claude; never breaks a signup.
create or replace function public.signup_guard_alert(p_text text)
returns void language plpgsql security definer
set search_path = public as $$
declare tok text; chan text;
begin
  select decrypted_secret into tok from vault.decrypted_secrets
   where name = 'slack_bot_token';
  select decrypted_secret into chan from vault.decrypted_secrets
   where name = 'slack_claude_channel';
  if tok is not null and chan is not null then
    perform net.http_post(
      url := 'https://slack.com/api/chat.postMessage',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || tok),
      body := jsonb_build_object('channel', chan,
        'text', p_text));
  end if;
exception when others then
  raise warning 'signup guard alert failed: %', sqlerrm;
end $$;
revoke all on function public.signup_guard_alert(text)
  from public, anon, authenticated;

-- The decision for one signup. Returns 'refuse' or null.
-- security definer: it bans accounts and alerts (vault,
-- pg_net), which the auth role must not reach directly.
create or replace function public.signup_ip_check(
  p_ip text, p_email text)
returns text language plpgsql security definer
set search_path = public as $$
declare
  c_soft_hour constant int := 20;
  c_soft_day constant int := 40;
  c_hard_hour constant int := 200;
  c_soft_for constant interval := interval '1 hour';
  c_hard_for constant interval := interval '1 hour';
  c_alert_every constant interval := interval '1 hour';
  v_ip inet;
  v_school boolean;
  v_flag signup_ip_flags%rowtype;
  v_hour int; v_day int; v_banned int := 0;
  v_level text;
begin
  begin
    v_ip := p_ip::inet;
  exception when others then
    return null;   -- no usable IP: never act on that
  end;
  if v_ip is null then return null; end if;
  v_school := exists (select 1 from signup_ip_allow a
                      where v_ip <<= a.net);

  select * into v_flag from signup_ip_flags where ip = v_ip;
  if v_flag.ip is not null and v_flag.level = 'hard'
     and v_flag.until > now()
     and not v_school then
    return 'refuse';
  end if;

  select count(*) filter (where created_at > now() - interval '1 hour'),
         count(*)
    into v_hour, v_day
    from signup_log
   where ip = v_ip and created_at > now() - interval '24 hours';
  v_hour := v_hour + 1;   -- this signup
  v_day := v_day + 1;

  v_level := case
    when v_hour >= c_hard_hour and not v_school then 'hard'
    when v_hour >= c_soft_hour or v_day >= c_soft_day then 'soft'
    when v_flag.ip is not null and v_flag.until > now() then 'soft'
    else null end;

  insert into signup_log(ip, email, soft)
  values (v_ip, lower(nullif(btrim(p_email), '')),
          v_level is not null);
  if v_level is null then return null; end if;

  insert into signup_ip_flags(ip, level, reason, until)
  values (v_ip, v_level,
          format('%s signups in 1 h, %s in 24 h', v_hour, v_day),
          now() + case v_level when 'hard' then c_hard_for
                                else c_soft_for end)
  on conflict (ip) do update
    set level = excluded.level, reason = excluded.reason,
        until = greatest(signup_ip_flags.until, excluded.until)
  returning * into v_flag;

  -- Accounts that already exist from this IP's burst.
  insert into leaderboard_bans(user_id, reason)
  select u.id, format('mass signup from one IP (%s)', v_flag.reason)
    from auth.users u
   where lower(u.email) in (
     select l.email from signup_log l
      where l.ip = v_ip and l.email is not null
        and l.created_at > now() - interval '24 hours')
  on conflict do nothing;
  get diagnostics v_banned = row_count;

  if v_flag.alerted_at is null
     or v_flag.alerted_at < now() - c_alert_every then
    update signup_ip_flags set alerted_at = now() where ip = v_ip;
    perform signup_guard_alert(format(
      E'🚫 Konto-Spam op ian.lu vun IP %s%s\n%s.\n%s\nOpmaachen: delete from signup_ip_flags where ip = ''%s'';',
      host(v_ip), case when v_school then ' (Schoulnetz)' else '' end,
      v_flag.reason,
      case when v_level = 'hard'
        then 'Nei Konte vun do sinn 1 Stonn gespaart.'
        else 'Konte ginn nach gemaach, mee kommen net op d''Leaderboards.' end,
      host(v_ip)));
  end if;
  return case when v_level = 'hard' then 'refuse' end;
end $$;
revoke all on function public.signup_ip_check(text, text)
  from public, anon, authenticated;
grant execute on function public.signup_ip_check(text, text)
  to supabase_auth_admin;

-- New accounts created while their IP is flagged SOFT: keep
-- them off the leaderboards from the first second.
create or replace function public.signup_soft_ban()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  if exists (select 1 from signup_log l
             where l.email = lower(new.email) and l.soft
               and l.created_at > now() - interval '10 minutes') then
    insert into leaderboard_bans(user_id, reason)
    values (new.id, 'signed up during a mass-signup burst')
    on conflict do nothing;
  end if;
  return null;
exception when others then
  raise warning 'signup soft ban failed: %', sqlerrm;
  return null;   -- never break a signup
end $$;
drop trigger if exists signup_soft_ban on auth.users;
create trigger signup_soft_ban
  after insert on auth.users
  for each row execute function public.signup_soft_ban();

-- The hook itself (invoker, as Supabase recommends).
-- Any error inside the guard lets the signup through.
create or replace function public.hook_before_user_created(
  event jsonb)
returns jsonb language plpgsql as $$
declare v_result text;
begin
  begin
    v_result := public.signup_ip_check(
      event->'metadata'->>'ip_address',
      event->'user'->>'email');
  exception when others then
    raise warning 'signup guard failed, allowing: %', sqlerrm;
    return '{}'::jsonb;
  end;
  if v_result is distinct from 'refuse' then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', 'Ze vill nei Konten vun dësem Netz. Probéier an enger Stonn nach eng Kéier.'));
end $$;
grant usage on schema public to supabase_auth_admin;
revoke execute on function public.hook_before_user_created(jsonb)
  from public, anon, authenticated;
grant execute on function public.hook_before_user_created(jsonb)
  to supabase_auth_admin;

-- Keep IPs 30 days only.
select cron.unschedule(jobid) from cron.job
 where jobname = 'signup-log-purge';
select cron.schedule('signup-log-purge', '17 3 * * *',
  $c$delete from public.signup_log
      where created_at < now() - interval '30 days';
     delete from public.signup_ip_flags
      where until < now() - interval '30 days'$c$);

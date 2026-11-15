-- =============================================
-- Anti-cheat: no "Haha" notice any more (15 Nov 2026).
-- Ian: remove the "Haha, du hues also awer probéiert" message
-- entirely. punish_suspicious no longer writes a user notice,
-- and every existing one is deleted. Flag + ban + Slack stay.
-- Replaces punish_suspicious from anticheat-own-best-v1.sql.
-- Idempotent.
-- =============================================

-- Flag + ban + Slack (no notice to the player since 15 Nov 2026). Shared by both triggers.
create or replace function public.punish_suspicious(
  p_user uuid, p_game text, p_username text,
  p_score double precision, p_prev double precision,
  p_prev_user text, p_why text, p_where text)
returns void language plpgsql security definer
set search_path = public as $$
declare fid bigint; tok text; chan text;
begin
  insert into public.score_flags
    (user_id, game_id, username, score, prev_best,
     prev_user, reason)
  values (p_user, p_game, p_username, p_score, p_prev,
          p_prev_user, case when p_where = 'weekly'
            then 'weekly: ' || p_why else p_why end)
  returning id into fid;
  insert into public.leaderboard_bans (user_id, reason)
  values (p_user, format('caught %sscore #%s: %s %s (%s)',
    case when p_where = 'weekly' then 'weekly ' else '' end,
    fid, p_game, p_score, p_why))
  on conflict do nothing;
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
          'text', format(E'⚠️ Score-Fuddler %s gefaangen (#%s)\n*%s* – %s: %s\nVirdrun #1: %s mat %s\nWisou: %s\nScore net gespäichert, Kont vun de Leaderboards gebannt.',
            case when p_where = 'weekly'
              then 'am Spill vun der Woch' else 'op ian.lu' end,
            fid, coalesce(p_username, '?'), p_game, p_score,
            coalesce(p_prev_user, '?'), p_prev, p_why)));
    end if;
  exception when others then
    raise warning 'score catch alert failed: %', sqlerrm;
  end;
end $$;
revoke all on function public.punish_suspicious(
  uuid, text, text, double precision, double precision,
  text, text, text)
  from public, anon, authenticated;

delete from public.user_notices
 where title->>'lb' = 'Haha, du hues also awer probéiert';

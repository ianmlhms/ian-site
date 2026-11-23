-- =============================================
-- Anti-cheat catcher OFF (Ian, 23 Nov 2026).
-- The "Score-Fuddeler" catcher (zz_catch_suspicious_score / zz_catch_suspicious_weekly,
-- anticheat-idle-v1.sql) flagged a real Dino player (Sinus: 1387 = 4.5x his own weekly
-- best, a normal Dino run) and banned him. Ian: switch the catcher off.
-- The triggers are DISABLED, not dropped: `enable trigger` turns them back on.
-- Kept: score floors (ski/mtb/reaction), the row guard, keep-best, banned-account drop.
-- One-off: unban Sinus, restore his weekly Dino 1387, remove the flag.
-- Idempotent.
-- =============================================
alter table public.scores disable trigger zz_catch_suspicious_score;
alter table public.weekly_scores disable trigger zz_catch_suspicious_weekly;

delete from public.leaderboard_bans b using public.profiles p
 where p.id = b.user_id and p.username = 'Sinus'
   and b.reason like 'caught weekly score #% dino %';
update public.weekly_scores w set score = greatest(w.score, 1387)
  from public.profiles p
 where p.id = w.user_id and p.username = 'Sinus' and w.game_id = 'dino' and w.week = '2026-11-23';
delete from public.score_flags f using public.profiles p
 where p.id = f.user_id and p.username = 'Sinus' and f.game_id = 'dino' and f.created_at >= '2026-11-23';

-- check
select c.relname, t.tgname, t.tgenabled from pg_trigger t join pg_class c on c.oid = t.tgrelid
 where t.tgname in ('zz_catch_suspicious_score', 'zz_catch_suspicious_weekly');

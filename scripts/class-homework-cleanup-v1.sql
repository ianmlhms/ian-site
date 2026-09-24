-- ==========================================
-- Hausaufgaben housekeeping (24 Sep 2026)
-- 1) Every morning at 03:50 UTC (05:50 LU
--    summer, 04:50 winter) delete homework
--    that was due before today (Luxembourg
--    date). Undated items are kept.
-- 2) The WebUntis sync runs every 20 min
--    from 04:00 to 20:40 UTC instead of
--    once a day.
-- Safe to re-run.
-- ==========================================
select cron.unschedule(jobid)
  from cron.job
  where jobname = 'class-homework-cleanup';

select cron.schedule(
  'class-homework-cleanup',
  '50 3 * * *',
  $job$
  delete from public.class_homework
   where due < (now() at time zone
     'Europe/Luxembourg')::date
  $job$);

select cron.alter_job(
  job_id := (select jobid from cron.job
    where jobname = 'webuntis-homework-sync'),
  schedule := '*/20 4-20 * * *');

select jobname, schedule from cron.job
  order by jobid;

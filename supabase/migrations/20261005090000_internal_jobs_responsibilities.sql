-- schema.sql lists internal_jobs.responsibilities inside `create table if not
-- exists`, so projects whose table predates it never got the column. The skill
-- discovery learning job reads it (backend/app/learning/skill_discovery.py).
alter table public.internal_jobs
  add column if not exists responsibilities text;

comment on column public.internal_jobs.responsibilities is
  'One responsibility per line for structured candidate job views.';

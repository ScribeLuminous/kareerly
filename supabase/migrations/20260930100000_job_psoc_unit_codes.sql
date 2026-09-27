-- A job may have a reviewer-assigned PSOC 2012 unit group. Leave unclassified
-- jobs null; never infer their required skills from this occupation code.
alter table public.internal_jobs
  add column if not exists psoc_unit_code text;

alter table public.employer_job_posts
  add column if not exists psoc_unit_code text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'internal_jobs_psoc_unit_code_format') then
    alter table public.internal_jobs
      add constraint internal_jobs_psoc_unit_code_format
      check (psoc_unit_code is null or psoc_unit_code ~ '^[0-9]{4}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'employer_job_posts_psoc_unit_code_format') then
    alter table public.employer_job_posts
      add constraint employer_job_posts_psoc_unit_code_format
      check (psoc_unit_code is null or psoc_unit_code ~ '^[0-9]{4}$');
  end if;
end $$;

comment on column public.internal_jobs.psoc_unit_code is
  'Reviewer-assigned PSOC 2012 unit group from the PSA reference; null until reviewed.';
comment on column public.employer_job_posts.psoc_unit_code is
  'Reviewer-assigned PSOC 2012 unit group from the PSA reference; null until reviewed.';

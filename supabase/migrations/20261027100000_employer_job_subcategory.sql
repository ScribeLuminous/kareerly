-- schema.sql adds job_subcategory to both job tables, but no migration did,
-- so databases built from migrations were missing it. The job editor and the
-- bulk job upload save the sub-category here.
alter table public.employer_job_posts
  add column if not exists job_subcategory text;

alter table public.internal_jobs
  add column if not exists job_subcategory text;

comment on column public.employer_job_posts.job_subcategory is
  'The sub-category chosen within category_name, e.g. Hospitality under Hospitality and Tourism.';

-- Lets the API see new columns straight away.
notify pgrst, 'reload schema';

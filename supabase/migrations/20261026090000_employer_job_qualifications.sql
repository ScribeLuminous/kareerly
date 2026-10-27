alter table public.employer_job_posts
  add column if not exists qualifications text;

comment on column public.employer_job_posts.qualifications is
  'One qualification per line (education, licences, experience) for structured employer and candidate job views.';

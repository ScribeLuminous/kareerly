alter table public.employer_job_posts
  add column if not exists responsibilities text;

comment on column public.employer_job_posts.responsibilities is
  'One responsibility per line for structured employer and candidate job views.';

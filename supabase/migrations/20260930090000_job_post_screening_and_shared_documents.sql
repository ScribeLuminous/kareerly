-- Screening questions and hiring stages on employer job posts, the candidate's
-- answers on each application, and the resume/portfolio a candidate chooses to
-- share with one employer.

alter table public.employer_job_posts
  add column if not exists screening_questions jsonb not null default '[]'::jsonb,
  add column if not exists hiring_stages jsonb not null default '[]'::jsonb;

comment on column public.employer_job_posts.screening_questions is
  'Ordered list of {"question": text, "expected_answer": text|null}. Candidates answer these when applying.';
comment on column public.employer_job_posts.hiring_stages is
  'Ordered list of {"stage": text, "description": text|null} describing the hiring process to candidates.';

alter table public.employer_job_posts drop constraint if exists employer_job_posts_screening_questions_array;
alter table public.employer_job_posts add constraint employer_job_posts_screening_questions_array
  check (jsonb_typeof(screening_questions) = 'array' and jsonb_array_length(screening_questions) <= 10);
alter table public.employer_job_posts drop constraint if exists employer_job_posts_hiring_stages_array;
alter table public.employer_job_posts add constraint employer_job_posts_hiring_stages_array
  check (jsonb_typeof(hiring_stages) = 'array' and jsonb_array_length(hiring_stages) <= 10);

alter table public.job_applications
  add column if not exists screening_answers jsonb not null default '[]'::jsonb;

comment on column public.job_applications.screening_answers is
  'Ordered list of {"question": text, "answer": text}, copied from the job post when the candidate applied.';

alter table public.job_applications drop constraint if exists job_applications_screening_answers_array;
alter table public.job_applications add constraint job_applications_screening_answers_array
  check (jsonb_typeof(screening_answers) = 'array');

-- Documents live in their own table so employers can't read them through the
-- job_applications row policy. Employers get them only through the backend,
-- which checks the application has reached Interviewing or Hired.
create table if not exists public.application_shared_documents (
  application_id uuid primary key references public.job_applications(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  resume_id uuid references public.resumes(id) on delete set null,
  share_resume boolean not null default false,
  portfolio_url text check (portfolio_url is null or portfolio_url ~* '^https?://'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.application_shared_documents enable row level security;

drop policy if exists "Candidates manage own shared documents" on public.application_shared_documents;
create policy "Candidates manage own shared documents" on public.application_shared_documents
  for all
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.job_applications
      where job_applications.id = application_shared_documents.application_id
        and job_applications.user_id = auth.uid()
    )
    and (
      resume_id is null
      or exists (select 1 from public.resumes where resumes.id = resume_id and resumes.user_id = auth.uid())
    )
  );

-- Public applicant counts for open employer posts (withdrawn applications are
-- not counted). Returns counts only, never who applied.
create or replace function public.get_job_applicant_counts(target_job_ids text[])
returns table(job_id text, applicant_count integer)
language sql
stable
security definer
set search_path = public
as $$
  select posts.job_id, count(applications.id)::integer
  from public.employer_job_posts as posts
  left join public.job_applications as applications
    on applications.job_source = 'employer'
   and applications.job_id = posts.job_id
   and applications.status <> 'withdrawn'
  where posts.job_id = any(target_job_ids)
    and posts.posting_status in ('active', 'open')
  group by posts.job_id;
$$;

revoke all on function public.get_job_applicant_counts(text[]) from public;
grant execute on function public.get_job_applicant_counts(text[]) to anon, authenticated;

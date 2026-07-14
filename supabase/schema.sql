do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type user_role as enum ('candidate', 'employer', 'admin');
  end if;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role user_role not null,
  first_name text not null,
  last_name text not null,
  email text not null unique,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.candidate_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  birthday date,
  location text,
  preferred_industry text,
  preferred_work_setup text,
  expected_salary text,
  target_role text,
  skill_to_develop text,
  education_json jsonb,
  certifications_json jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.candidate_profiles add column if not exists public_id text;
create unique index if not exists candidate_profiles_public_id_key on public.candidate_profiles(public_id) where public_id is not null;

create table if not exists public.employer_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  company_name text not null,
  company_size text,
  industry text,
  business_email text,
  company_location text,
  company_website text,
  company_description text,
  contact_person_name text,
  contact_role text,
  contact_number text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.employer_profiles add column if not exists company_location text;
alter table public.employer_profiles add column if not exists company_website text;
alter table public.employer_profiles add column if not exists company_description text;
alter table public.employer_profiles add column if not exists contact_person_name text;
alter table public.employer_profiles add column if not exists contact_role text;
alter table public.employer_profiles add column if not exists contact_number text;

create table if not exists public.resumes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  original_filename text,
  storage_bucket text,
  storage_path text,
  file_mime_type text,
  file_size_bytes bigint,
  parsed_text text,
  extracted_profile_json jsonb,
  created_at timestamptz default now()
);

alter table public.resumes add column if not exists storage_bucket text;
alter table public.resumes add column if not exists storage_path text;
alter table public.resumes add column if not exists file_mime_type text;
alter table public.resumes add column if not exists file_size_bytes bigint;

create table if not exists public.user_skills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  skill_id text,
  skill_name text not null,
  confidence numeric default 0,
  source text,
  created_at timestamptz default now()
);

create table if not exists public.match_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  resume_id uuid references public.resumes(id) on delete set null,
  preferences_json jsonb,
  results_json jsonb,
  created_at timestamptz default now()
);

insert into storage.buckets (id, name, public)
values ('resumes', 'resumes', false)
on conflict (id) do nothing;

create table if not exists public.internal_jobs (
  id uuid primary key default gen_random_uuid(),
  job_id text not null unique,

  category_code text,
  category_name text,
  job_subcategory text,

  job_title text not null,
  company_name text,
  location text,
  work_setup text,
  employment_type text,
  job_level text,

  salary_min_php integer,
  salary_max_php integer,

  job_description text,
  responsibilities text,
  required_skills text,
  preferred_skills text,
  must_have_skill_ids text,
  application_deadline date,

  source_platform text,
  source_url text,
  source_note text,

  is_synthetic_seed boolean default true,
  posting_status text default 'active',

  willing_to_train boolean default false,
  trial_period boolean default false,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.employer_job_posts (
  id uuid primary key default gen_random_uuid(),
  job_id text not null unique,
  employer_id uuid not null references public.employer_profiles(id) on delete cascade,

  category_code text,
  category_name text,
  job_subcategory text,

  job_title text not null,
  company_name text,
  location text,
  work_setup text,
  employment_type text,
  job_level text,

  salary_min_php integer,
  salary_max_php integer,

  job_description text,
  responsibilities text,
  required_skills text,
  preferred_skills text,
  must_have_skill_ids text,

  posting_status text default 'draft',

  willing_to_train boolean default false,
  trial_period boolean default false,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.employer_job_posts add column if not exists application_deadline date;
alter table public.employer_job_posts add column if not exists responsibilities text;

create index if not exists internal_jobs_active_created_idx
  on public.internal_jobs (posting_status, created_at desc);
create index if not exists employer_job_posts_active_created_idx
  on public.employer_job_posts (posting_status, created_at desc);

create table if not exists public.learning_resources (
  id uuid primary key default gen_random_uuid(),
  resource_id text not null unique,

  course_or_certification_title text not null,
  course_or_certification_description text,
  recommended_experience text,
  schedule text,
  level text,
  estimated_duration text,

  skills_youll_gain text,
  skill_ids text,
  category_id text,
  category_name text,

  offered_by_provider text,
  provider_type text,
  provider_trust_score_auto numeric,
  resource_type text,
  language text,
  delivery_mode text,
  cost_type text,
  status text default 'active',

  notes text,
  external_course_or_certification_link text,
  mapped_skill_names text,
  skill_id_mapping_status text,
  skill_id_mapping_notes text,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.saved_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  job_source text not null default 'internal' check (job_source in ('internal', 'employer')),
  job_id text not null,
  created_at timestamptz default now(),
  unique(user_id, job_source, job_id)
);

create table if not exists public.job_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  job_source text not null default 'internal' check (job_source in ('internal', 'employer')),
  job_id text not null,
  status text default 'submitted',
  rejection_reason text,
  created_at timestamptz default now()
);
alter table public.job_applications add column if not exists rejection_reason text;

create table if not exists public.application_messages (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.job_applications(id) on delete cascade,
  sender_user_id uuid not null references public.profiles(id) on delete cascade,
  sender_role text not null check (sender_role in ('candidate', 'employer')),
  message_kind text not null default 'message' check (message_kind in ('request', 'message')),
  message_text text not null,
  created_at timestamptz default now()
);

create table if not exists public.candidate_skill_progress (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.profiles(id) on delete cascade,
  skill_id text,
  skill_name text not null,
  category_id text,
  category_name text,
  status text default 'missing' check (status in ('missing', 'started', 'in_progress', 'completed', 'evidenced', 'covered')),
  progress_percent integer default 0,
  selected_resource_id text,
  evidence_url text,
  evidence_filename text,
  evidence_uploaded_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.saved_jobs add column if not exists job_source text not null default 'internal';
alter table public.saved_jobs drop constraint if exists saved_jobs_job_source_check;
alter table public.saved_jobs add constraint saved_jobs_job_source_check check (job_source in ('internal', 'employer'));
alter table public.saved_jobs drop constraint if exists saved_jobs_user_id_job_id_key;
alter table public.saved_jobs drop constraint if exists saved_jobs_user_id_job_source_job_id_key;
alter table public.saved_jobs add constraint saved_jobs_user_id_job_source_job_id_key unique(user_id, job_source, job_id);

alter table public.job_applications add column if not exists job_source text not null default 'internal';
alter table public.job_applications drop constraint if exists job_applications_job_source_check;
alter table public.job_applications add constraint job_applications_job_source_check check (job_source in ('internal', 'employer'));
alter table public.job_applications add column if not exists job_title text;
alter table public.job_applications add column if not exists company_name text;
alter table public.job_applications add column if not exists candidate_name text;
alter table public.job_applications add column if not exists candidate_email text;
alter table public.job_applications add column if not exists candidate_location text;
alter table public.job_applications add column if not exists match_score integer default 0;
alter table public.job_applications add column if not exists matched_skills text[] default '{}';
alter table public.job_applications add column if not exists missing_skills text[] default '{}';
alter table public.job_applications add column if not exists message_request_state text not null default 'none';
alter table public.job_applications add column if not exists applied_at timestamptz default now();
alter table public.job_applications add column if not exists withdrawn_at timestamptz;
alter table public.job_applications add column if not exists updated_at timestamptz default now();
alter table public.job_applications alter column status set default 'pending';
update public.job_applications set status = 'pending' where status = 'submitted';
alter table public.job_applications drop constraint if exists job_applications_status_check;
alter table public.job_applications add constraint job_applications_status_check check (status in ('pending', 'shortlisted', 'interviewing', 'hired', 'rejected', 'withdrawn'));
alter table public.job_applications drop constraint if exists job_applications_message_request_state_check;
alter table public.job_applications add constraint job_applications_message_request_state_check check (message_request_state in ('none', 'pending', 'accepted', 'declined', 'ignored'));
alter table public.job_applications drop constraint if exists job_applications_user_id_job_source_job_id_key;
alter table public.job_applications add constraint job_applications_user_id_job_source_job_id_key unique(user_id, job_source, job_id);

alter table public.internal_jobs add column if not exists job_subcategory text;
alter table public.employer_job_posts add column if not exists job_subcategory text;

alter table public.profiles enable row level security;
alter table public.candidate_profiles enable row level security;
alter table public.employer_profiles enable row level security;
alter table public.resumes enable row level security;
alter table public.user_skills enable row level security;
alter table public.match_history enable row level security;
alter table public.internal_jobs enable row level security;
alter table public.employer_job_posts enable row level security;
alter table public.learning_resources enable row level security;
alter table public.saved_jobs enable row level security;
alter table public.job_applications enable row level security;
alter table public.application_messages enable row level security;
alter table public.candidate_skill_progress enable row level security;

drop policy if exists "Users can read own profile" on public.profiles;
create policy "Users can read own profile" on public.profiles for select using (auth.uid() = id);

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile" on public.profiles for update using (auth.uid() = id);

drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile" on public.profiles for insert with check (auth.uid() = id);

drop policy if exists "Users can manage own candidate profile" on public.candidate_profiles;
create policy "Users can manage own candidate profile" on public.candidate_profiles for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.get_employer_applicant_public_ids()
returns table(application_id uuid, public_id text)
language sql
security definer
set search_path = public
as $$
  select applications.id, candidates.public_id
  from public.job_applications as applications
  join public.candidate_profiles as candidates on candidates.user_id = applications.user_id
  join public.employer_job_posts as jobs on jobs.job_id = applications.job_id
  join public.employer_profiles as employers on employers.id = jobs.employer_id
  where applications.job_source = 'employer'
    and employers.user_id = auth.uid();
$$;

revoke all on function public.get_employer_applicant_public_ids() from public;
grant execute on function public.get_employer_applicant_public_ids() to authenticated;

drop policy if exists "Users can manage own employer profile" on public.employer_profiles;
create policy "Users can manage own employer profile" on public.employer_profiles for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can manage own resumes" on public.resumes;
create policy "Users can manage own resumes" on public.resumes for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can manage own resume files" on storage.objects;
create policy "Users can manage own resume files" on storage.objects
for all using (
  bucket_id = 'resumes'
  and auth.uid()::text = (storage.foldername(name))[1]
) with check (
  bucket_id = 'resumes'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "Users can manage own skills" on public.user_skills;
create policy "Users can manage own skills" on public.user_skills for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can manage own match history" on public.match_history;
create policy "Users can manage own match history" on public.match_history for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can manage own candidate skill progress" on public.candidate_skill_progress;
create policy "Users can manage own candidate skill progress" on public.candidate_skill_progress for all using (auth.uid() = candidate_id) with check (auth.uid() = candidate_id);

drop policy if exists "Anyone can read active internal jobs" on public.internal_jobs;
create policy "Anyone can read active internal jobs" on public.internal_jobs for select using (posting_status = 'active');

drop policy if exists "Anyone can read active employer job posts" on public.employer_job_posts;
create policy "Anyone can read active employer job posts" on public.employer_job_posts for select using (
  posting_status = 'active'
  and (application_deadline is null or application_deadline > (now() at time zone 'Asia/Manila')::date)
);

drop policy if exists "Employers can manage own job posts" on public.employer_job_posts;
create policy "Employers can manage own job posts" on public.employer_job_posts for all using (
  exists (
    select 1
    from public.employer_profiles
    where employer_profiles.id = employer_job_posts.employer_id
      and employer_profiles.user_id = auth.uid()
  )
) with check (
  exists (
    select 1
    from public.employer_profiles
    where employer_profiles.id = employer_job_posts.employer_id
      and employer_profiles.user_id = auth.uid()
  )
);

drop policy if exists "Anyone can read active learning resources" on public.learning_resources;
create policy "Anyone can read active learning resources" on public.learning_resources for select using (coalesce(status, 'active') = 'active');

drop policy if exists "Users can manage own saved jobs" on public.saved_jobs;
create policy "Users can manage own saved jobs" on public.saved_jobs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can manage own applications" on public.job_applications;
create policy "Users can manage own applications" on public.job_applications for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Employers can read own job applications" on public.job_applications;
create policy "Employers can read own job applications" on public.job_applications
for select using (
  exists (
    select 1
    from public.employer_job_posts
    join public.employer_profiles on employer_profiles.id = employer_job_posts.employer_id
    where employer_profiles.user_id = auth.uid()
      and employer_job_posts.job_id = job_applications.job_id
  )
);

drop policy if exists "Employers can update own job application statuses" on public.job_applications;
create policy "Employers can update own job application statuses" on public.job_applications
for update using (
  exists (
    select 1
    from public.employer_job_posts
    join public.employer_profiles on employer_profiles.id = employer_job_posts.employer_id
    where employer_profiles.user_id = auth.uid()
      and employer_job_posts.job_id = job_applications.job_id
  )
);

drop policy if exists "Users can read own application messages" on public.application_messages;
create policy "Users can read own application messages" on public.application_messages
for select using (
  exists (
    select 1
    from public.job_applications
    where job_applications.id = application_messages.application_id
      and job_applications.user_id = auth.uid()
  )
);

drop policy if exists "Employers can read own application messages" on public.application_messages;
create policy "Employers can read own application messages" on public.application_messages
for select using (
  exists (
    select 1
    from public.job_applications
    join public.employer_job_posts on employer_job_posts.job_id = job_applications.job_id
    join public.employer_profiles on employer_profiles.id = employer_job_posts.employer_id
    where job_applications.id = application_messages.application_id
      and employer_profiles.user_id = auth.uid()
  )
);

drop policy if exists "Employers can send own application messages" on public.application_messages;
create policy "Employers can send own application messages" on public.application_messages
for insert with check (
  sender_user_id = auth.uid()
  and sender_role = 'employer'
  and exists (
    select 1
    from public.job_applications
    join public.employer_job_posts on employer_job_posts.job_id = job_applications.job_id
    join public.employer_profiles on employer_profiles.id = employer_job_posts.employer_id
    where job_applications.id = application_messages.application_id
      and employer_profiles.user_id = auth.uid()
  )
);

drop policy if exists "Candidates can send own application messages" on public.application_messages;
create policy "Candidates can send own application messages" on public.application_messages
for insert with check (
  sender_user_id = auth.uid()
  and sender_role = 'candidate'
  and message_kind = 'message'
  and exists (
    select 1
    from public.job_applications
    where job_applications.id = application_messages.application_id
      and job_applications.user_id = auth.uid()
      and job_applications.message_request_state = 'accepted'
  )
);

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_role user_role := coalesce((new.raw_user_meta_data ->> 'role')::user_role, 'candidate'::user_role);
  first_name_value text := coalesce(nullif(new.raw_user_meta_data ->> 'first_name', ''), split_part(new.email, '@', 1));
  last_name_value text := coalesce(new.raw_user_meta_data ->> 'last_name', '');
begin
  insert into public.profiles (id, role, first_name, last_name, email)
  values (new.id, requested_role, first_name_value, last_name_value, new.email)
  on conflict (id) do nothing;

  if requested_role = 'employer' then
    insert into public.employer_profiles (
      user_id,
      company_name,
      company_size,
      industry,
      business_email
    )
  values (
      new.id,
      coalesce(nullif(new.raw_user_meta_data ->> 'company_name', ''), 'Employer Workspace'),
      new.raw_user_meta_data ->> 'company_size',
      new.raw_user_meta_data ->> 'industry',
      new.email
    )
    on conflict (user_id) do nothing;
  else
    insert into public.candidate_profiles (user_id)
    values (new.id)
    on conflict (user_id) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

-- Deadline dates are inclusive closure dates in Philippine local time. The
-- scheduled job persists the status even when no employer has the dashboard open.
create extension if not exists pg_cron with schema extensions;

create or replace function public.close_expired_employer_job_posts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  closed_count integer;
begin
  update public.employer_job_posts
  set posting_status = 'closed', updated_at = now()
  where posting_status in ('active', 'open')
    and application_deadline is not null
    and application_deadline <= (now() at time zone 'Asia/Manila')::date;

  get diagnostics closed_count = row_count;
  return closed_count;
end;
$$;

do $$
declare
  existing_job_id bigint;
begin
  select jobid into existing_job_id
  from cron.job
  where jobname = 'close-expired-employer-job-posts';

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'close-expired-employer-job-posts',
    '*/5 * * * *',
    'select public.close_expired_employer_job_posts();'
  );
end;
$$;

-- Minimal copies of the employer, job post and application tables from
-- ../schema.sql (with the existing employer policies) so the structured
-- evaluation migration can be tested on a plain local PostgreSQL.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null, email text
);
create table if not exists public.employer_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  company_name text not null
);
create table if not exists public.employer_job_posts (
  id uuid primary key default gen_random_uuid(),
  job_id text not null unique,
  employer_id uuid not null references public.employer_profiles(id) on delete cascade,
  job_title text not null,
  posting_status text default 'active'
);
create table if not exists public.job_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  job_source text not null default 'employer',
  job_id text not null,
  status text default 'pending',
  rejection_reason text,
  match_score integer,
  matched_skills text[] default '{}',
  missing_skills text[] default '{}',
  message_request_state text not null default 'none',
  updated_at timestamptz default now()
);
alter table public.employer_profiles enable row level security;
alter table public.employer_job_posts enable row level security;
alter table public.job_applications enable row level security;
drop policy if exists "Users can manage own employer profile" on public.employer_profiles;
create policy "Users can manage own employer profile" on public.employer_profiles for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Employers can manage own job posts" on public.employer_job_posts;
create policy "Employers can manage own job posts" on public.employer_job_posts for all using (
  exists (select 1 from public.employer_profiles where employer_profiles.id = employer_job_posts.employer_id and employer_profiles.user_id = auth.uid()));
drop policy if exists "Users can manage own applications" on public.job_applications;
create policy "Users can manage own applications" on public.job_applications for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Employers can read own job applications" on public.job_applications;
create policy "Employers can read own job applications" on public.job_applications for select using (
  exists (select 1 from public.employer_job_posts join public.employer_profiles on employer_profiles.id = employer_job_posts.employer_id
    where employer_profiles.user_id = auth.uid() and employer_job_posts.job_id = job_applications.job_id));

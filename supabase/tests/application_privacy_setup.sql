-- State before 20261117090000_application_privacy_and_integrity.sql: the
-- columns and grants production has, and applications that still carry a
-- copy of the candidate's identity.
\set ON_ERROR_STOP on

alter table public.profiles add column if not exists first_name text;
alter table public.profiles add column if not exists last_name text;
alter table public.candidate_profiles add column if not exists location text;
alter table public.employer_job_posts add column if not exists company_name text;
alter table public.employer_job_posts add column if not exists application_deadline date;
alter table public.job_applications add column if not exists company_name text;
alter table public.job_applications add column if not exists candidate_name text;
alter table public.job_applications add column if not exists candidate_email text;
alter table public.job_applications add column if not exists candidate_location text;
alter table public.job_applications add column if not exists applied_at timestamptz default now();
alter table public.job_applications add column if not exists withdrawn_at timestamptz;
alter table public.job_applications drop constraint if exists job_applications_user_id_job_source_job_id_key;
alter table public.job_applications add constraint job_applications_user_id_job_source_job_id_key unique (user_id, job_source, job_id);

create table if not exists public.internal_jobs (
  id uuid primary key default gen_random_uuid(),
  job_id text not null unique,
  job_title text not null,
  company_name text,
  posting_status text default 'active',
  application_deadline date
);

update public.profiles set first_name = 'Cara', last_name = 'One' where id = '00000000-0000-0000-0000-0000000000c1';
update public.profiles set first_name = 'Cruz', last_name = 'Two' where id = '00000000-0000-0000-0000-0000000000c2';
insert into public.candidate_profiles (user_id, public_id, location) values
  ('00000000-0000-0000-0000-0000000000c1', 'KR-C1', 'Iloilo City, Iloilo'),
  ('00000000-0000-0000-0000-0000000000c2', 'KR-C2', 'Davao City, Davao del Sur')
  on conflict (user_id) do update set location = excluded.location;
update public.employer_job_posts set company_name = 'Employer One' where job_id = 'EMP-1';
update public.employer_job_posts set company_name = 'Employer Two' where job_id = 'EMP-2';
insert into public.employer_job_posts (id, job_id, employer_id, job_title, company_name, posting_status, application_deadline) values
  ('20000000-0000-0000-0000-000000000003', 'EMP-3', '10000000-0000-0000-0000-000000000001', 'Closed Role', 'Employer One', 'closed', null),
  ('20000000-0000-0000-0000-000000000004', 'EMP-4', '10000000-0000-0000-0000-000000000001', 'Expired Role', 'Employer One', 'active', date '2020-01-01')
  on conflict do nothing;
insert into public.internal_jobs (job_id, job_title, company_name, posting_status) values
  ('INT-OPEN', 'Reference Analyst', 'Reference Co', 'active'),
  ('INT-CLOSED', 'Old Reference Job', 'Reference Co', 'closed')
  on conflict do nothing;

-- Copies of identity that the migration must clear.
update public.job_applications
  set candidate_name = 'Cara One', candidate_email = 'candidate1@example.com', candidate_location = 'Iloilo City'
  where user_id = '00000000-0000-0000-0000-0000000000c1';
update public.job_applications
  set candidate_name = 'Cruz Two', candidate_email = 'candidate2@example.com'
  where user_id = '00000000-0000-0000-0000-0000000000c2';

-- Supabase's default table grants to signed-in users.
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on public.profiles, public.candidate_profiles, public.employer_profiles,
  public.employer_job_posts, public.job_applications, public.internal_jobs to authenticated;

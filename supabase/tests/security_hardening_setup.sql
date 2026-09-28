-- Brings the evaluation test database closer to production before
-- 20261004090000_security_hardening.sql runs: Supabase-style default grants
-- to anon/authenticated, the objects the sign-up trigger writes to, pg_trgm in
-- public, and the functions the advisor flagged.
do $$ begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type user_role as enum ('candidate', 'employer', 'admin');
  end if;
end $$;

alter table auth.users add column if not exists raw_user_meta_data jsonb not null default '{}'::jsonb;
alter table public.profiles add column if not exists first_name text;
alter table public.profiles add column if not exists last_name text;
alter table public.profiles add column if not exists updated_at timestamptz default now();
alter table public.employer_profiles add column if not exists company_size text;
alter table public.employer_profiles add column if not exists industry text;
alter table public.employer_profiles add column if not exists business_email text;
alter table public.profiles enable row level security;
drop policy if exists "Users can read own profile" on public.profiles;
create policy "Users can read own profile" on public.profiles for select using (auth.uid() = id);
drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile" on public.profiles for update using (auth.uid() = id);
drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile" on public.profiles for insert with check (auth.uid() = id);

-- Supabase grants table and function access to both API roles by default.
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant execute on all functions in schema public to anon, authenticated, service_role;

create extension if not exists pg_trgm with schema public;
create index if not exists employer_job_posts_title_trgm_idx on public.employer_job_posts using gin (job_title gin_trgm_ops);

create or replace function public.get_job_applicant_counts(target_job_ids text[])
returns table(job_id text, applicant_count integer)
language sql stable security definer set search_path = public
as $$
  select posts.job_id, count(applications.id)::integer
  from public.employer_job_posts as posts
  left join public.job_applications as applications on applications.job_id = posts.job_id
  where posts.job_id = any(target_job_ids)
  group by posts.job_id;
$$;
grant execute on function public.get_job_applicant_counts(text[]) to anon, authenticated;

-- A SECURITY DEFINER function the migration does not name, standing in for
-- anything deployed outside the repository.
create or replace function public.unlisted_definer_helper() returns integer
language sql security definer set search_path = public as $$ select 1 $$;
grant execute on function public.unlisted_definer_helper() to anon, authenticated;

-- The sign-up trigger as deployed; the migration replaces only its function.
create or replace function public.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, role, email)
  values (new.id, coalesce((new.raw_user_meta_data ->> 'role')::user_role, 'candidate'::user_role), new.email);
  return new;
end $$;
grant execute on function public.handle_new_auth_user() to anon, authenticated;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_auth_user();

create or replace function public.get_employer_applicant_public_ids()
returns table(application_id uuid, public_id text)
language sql security definer set search_path = public
as $$
  select applications.id, candidates.public_id
  from public.job_applications as applications
  join public.candidate_profiles as candidates on candidates.user_id = applications.user_id
  join public.employer_job_posts as jobs on jobs.job_id = applications.job_id
  join public.employer_profiles as employers on employers.id = jobs.employer_id
  where employers.user_id = auth.uid();
$$;
revoke all on function public.get_employer_applicant_public_ids() from public;
grant execute on function public.get_employer_applicant_public_ids() to anon, authenticated;

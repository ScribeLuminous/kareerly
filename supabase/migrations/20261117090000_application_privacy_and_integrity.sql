-- Applications: candidate identity stays out of the application row, and
-- neither side can change an application except through checked functions.
--
-- Before this migration:
-- * Applying copied the candidate's name, email and location onto
--   job_applications, and employers could read the whole row. The dashboard
--   hid those fields until Interviewing, but the employer's own session could
--   read them at every stage (audit SEC-01).
-- * "Users can manage own applications" let a candidate update any column of
--   their application (match score, status, message request state), and
--   "Employers can update own job application statuses" let an employer update
--   any column of an application to their job, including accepting a message
--   request on the candidate's behalf or reopening a withdrawn application
--   (audit SEC-03).
--
-- After it:
-- * candidate_name, candidate_email and candidate_location are always empty.
--   Employers get a name, email and location only from
--   get_employer_applicant_identities(), and only once an application has
--   reached Interviewing.
-- * Clients can read their applications but not write them. Candidates apply,
--   withdraw and answer message requests through submit_job_application,
--   withdraw_job_application and respond_to_message_request. Employers change
--   stages through set_application_stage (unchanged); the backend records a
--   sent message request with the service role.
--
-- The backend's service role is unaffected. Safe to re-run.

-- ---------- 1. Identity is not copied onto applications ----------

alter table public.job_applications add column if not exists candidate_name text;
alter table public.job_applications add column if not exists candidate_email text;
alter table public.job_applications add column if not exists candidate_location text;

comment on column public.job_applications.candidate_name is
  'Always null. Read identity with get_employer_applicant_identities().';
comment on column public.job_applications.candidate_email is
  'Always null. Read identity with get_employer_applicant_identities().';
comment on column public.job_applications.candidate_location is
  'Always null. Read identity with get_employer_applicant_identities().';

create or replace function public.clear_application_identity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.candidate_name := null;
  new.candidate_email := null;
  new.candidate_location := null;
  return new;
end;
$$;

revoke all on function public.clear_application_identity() from public, anon, authenticated;

drop trigger if exists job_applications_clear_identity on public.job_applications;
create trigger job_applications_clear_identity
  before insert or update on public.job_applications
  for each row execute function public.clear_application_identity();

-- Existing copies. Only these columns are set, so no stage or notification
-- trigger fires.
update public.job_applications
  set candidate_name = null, candidate_email = null, candidate_location = null
  where candidate_name is not null or candidate_email is not null or candidate_location is not null;

-- ---------- 2. Clients read applications; they do not write them ----------

drop policy if exists "Users can manage own applications" on public.job_applications;
drop policy if exists "Candidates can read own applications" on public.job_applications;
create policy "Candidates can read own applications" on public.job_applications
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Employers can update own job application statuses" on public.job_applications;
-- "Employers can read own job applications" (select) stays as it is.

revoke insert, update, delete on public.job_applications from authenticated;
grant select on public.job_applications to authenticated;

-- ---------- 3. Candidate actions ----------

-- Apply for an open job, or apply again after withdrawing. The job title and
-- company come from the job post, not the client.
create or replace function public.submit_job_application(
  target_job_source text,
  target_job_id text,
  applicant_match_score integer default null,
  applicant_matched_skills text[] default '{}',
  applicant_missing_skills text[] default '{}'
)
returns public.job_applications
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  job_title_value text;
  company_value text;
  score integer := case when applicant_match_score is null then null
                        else least(100, greatest(0, applicant_match_score)) end;
  matched text[];
  missing text[];
  existing public.job_applications%rowtype;
  saved public.job_applications%rowtype;
begin
  if caller is null then
    raise exception 'Authentication is required.' using errcode = '28000';
  end if;
  if not exists (select 1 from public.profiles where id = caller and role::text = 'candidate') then
    raise exception 'Only job seeker accounts can apply for jobs.' using errcode = '42501';
  end if;

  if target_job_source = 'employer' then
    select job_title, company_name into job_title_value, company_value
    from public.employer_job_posts
    where job_id = target_job_id
      and posting_status in ('active', 'open')
      and (application_deadline is null or application_deadline > (now() at time zone 'Asia/Manila')::date);
  elsif target_job_source = 'internal' then
    select job_title, company_name into job_title_value, company_value
    from public.internal_jobs
    where job_id = target_job_id
      and posting_status = 'active'
      and (application_deadline is null or application_deadline > (now() at time zone 'Asia/Manila')::date);
  else
    raise exception 'Unknown job source.' using errcode = '22023';
  end if;
  if not found then
    raise exception 'This job is closed or no longer accepting applications.' using errcode = 'P0002';
  end if;

  -- Up to 50 non-blank names each, in the order sent.
  select coalesce(array_agg(skill order by position), '{}') into matched
  from (select btrim(item) as skill, position
        from unnest(coalesce(applicant_matched_skills, '{}')) with ordinality as listed(item, position)
        where btrim(item) <> '' order by position limit 50) as cleaned;
  select coalesce(array_agg(skill order by position), '{}') into missing
  from (select btrim(item) as skill, position
        from unnest(coalesce(applicant_missing_skills, '{}')) with ordinality as listed(item, position)
        where btrim(item) <> '' order by position limit 50) as cleaned;

  select * into existing from public.job_applications
  where user_id = caller and job_source = target_job_source and job_id = target_job_id
  for update;

  if found then
    if existing.status is distinct from 'withdrawn' then
      raise exception 'You have already applied for this job.' using errcode = '23505';
    end if;
    update public.job_applications
      set status = 'pending', job_title = job_title_value, company_name = company_value,
          match_score = score, matched_skills = matched, missing_skills = missing,
          message_request_state = 'none', rejection_reason = null,
          applied_at = now(), withdrawn_at = null, updated_at = now()
      where id = existing.id
      returning * into saved;
  else
    insert into public.job_applications (
      user_id, job_source, job_id, job_title, company_name,
      match_score, matched_skills, missing_skills, status, applied_at, updated_at
    ) values (
      caller, target_job_source, target_job_id, job_title_value, company_value,
      score, matched, missing, 'pending', now(), now()
    )
    returning * into saved;
  end if;
  return saved;
end;
$$;

create or replace function public.withdraw_job_application(target_application_id uuid)
returns public.job_applications
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  saved public.job_applications%rowtype;
begin
  if caller is null then
    raise exception 'Authentication is required.' using errcode = '28000';
  end if;
  update public.job_applications
    set status = 'withdrawn', withdrawn_at = now(), updated_at = now()
    where id = target_application_id
      and user_id = caller
      and status in ('pending', 'shortlisted', 'interviewing')
    returning * into saved;
  if not found then
    if exists (select 1 from public.job_applications where id = target_application_id and user_id = caller) then
      raise exception 'This application can no longer be withdrawn.' using errcode = '22023';
    end if;
    raise exception 'Application was not found.' using errcode = 'P0002';
  end if;
  return saved;
end;
$$;

-- Accept, decline or ignore an employer's message request. Only an open
-- request (pending, or ignored earlier) can be answered.
create or replace function public.respond_to_message_request(target_application_id uuid, response text)
returns public.job_applications
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  saved public.job_applications%rowtype;
begin
  if caller is null then
    raise exception 'Authentication is required.' using errcode = '28000';
  end if;
  if response not in ('accepted', 'declined', 'ignored') then
    raise exception 'Response must be accepted, declined or ignored.' using errcode = '22023';
  end if;
  update public.job_applications
    set message_request_state = response, updated_at = now()
    where id = target_application_id
      and user_id = caller
      and message_request_state in ('pending', 'ignored')
    returning * into saved;
  if not found then
    if exists (select 1 from public.job_applications where id = target_application_id and user_id = caller) then
      raise exception 'There is no open message request for this application.' using errcode = '22023';
    end if;
    raise exception 'Application was not found.' using errcode = 'P0002';
  end if;
  return saved;
end;
$$;

-- ---------- 4. Identity for employers, from Interviewing on ----------

-- One row per application to the caller's job posts whose candidate identity
-- may be shown: Interviewing or Hired, or Rejected after reaching
-- Interviewing. Earlier stages, and rejections before Interviewing, stay
-- masked.
create or replace function public.get_employer_applicant_identities()
returns table(application_id uuid, full_name text, email text, location text)
language sql
stable
security definer
set search_path = public
as $$
  select applications.id,
         nullif(btrim(concat_ws(' ', profiles.first_name, profiles.last_name)), ''),
         profiles.email,
         candidates.location
  from public.job_applications as applications
  join public.employer_job_posts as jobs on jobs.job_id = applications.job_id
  join public.employer_profiles as employers on employers.id = jobs.employer_id
  join public.profiles as profiles on profiles.id = applications.user_id
  left join public.candidate_profiles as candidates on candidates.user_id = applications.user_id
  where applications.job_source = 'employer'
    and employers.user_id = auth.uid()
    and (
      applications.status in ('interviewing', 'hired')
      or (applications.status = 'rejected' and exists (
        select 1 from public.employer_review_audit_log as log
        where log.application_id = applications.id
          and log.event_type = 'stage_changed'
          and log.details ->> 'to' = 'interviewing'))
    );
$$;

revoke all on function public.submit_job_application(text, text, integer, text[], text[]) from public, anon;
revoke all on function public.withdraw_job_application(uuid) from public, anon;
revoke all on function public.respond_to_message_request(uuid, text) from public, anon;
revoke all on function public.get_employer_applicant_identities() from public, anon;
grant execute on function public.submit_job_application(text, text, integer, text[], text[]) to authenticated;
grant execute on function public.withdraw_job_application(uuid) to authenticated;
grant execute on function public.respond_to_message_request(uuid, text) to authenticated;
grant execute on function public.get_employer_applicant_identities() to authenticated;

-- An application's match score comes from the backend, not the browser
-- (audit APP-01).
--
-- 20261117090000 let candidates apply through submit_job_application, which
-- saved the match score and skill lists the browser sent, so a candidate could
-- send any score and the employer would see it. Now the backend's
-- POST /api/candidate/applications scores the job with the production matcher
-- and saves the application through submit_job_application_for, which only
-- the service role can call. The old client-callable function is removed.
-- Safe to re-run.

create or replace function public.submit_job_application_for(
  applicant_id uuid,
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
  job_title_value text;
  company_value text;
  score integer := case when applicant_match_score is null then null
                        else least(100, greatest(0, applicant_match_score)) end;
  matched text[];
  missing text[];
  existing public.job_applications%rowtype;
  saved public.job_applications%rowtype;
begin
  if applicant_id is null then
    raise exception 'Authentication is required.' using errcode = '28000';
  end if;
  if not exists (select 1 from public.profiles where id = applicant_id and role::text = 'candidate') then
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
  where user_id = applicant_id and job_source = target_job_source and job_id = target_job_id
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
      applicant_id, target_job_source, target_job_id, job_title_value, company_value,
      score, matched, missing, 'pending', now(), now()
    )
    returning * into saved;
  end if;
  return saved;
end;
$$;

revoke all on function public.submit_job_application_for(uuid, text, text, integer, text[], text[]) from public, anon, authenticated;
grant execute on function public.submit_job_application_for(uuid, text, text, integer, text[], text[]) to service_role;

drop function if exists public.submit_job_application(text, text, integer, text[], text[]);

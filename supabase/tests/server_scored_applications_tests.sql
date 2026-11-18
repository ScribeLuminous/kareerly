-- Checks for 20261118090000_server_scored_applications.sql. Runs after
-- application_privacy_tests.sql in the same database. Any failed check raises
-- and stops.
\set ON_ERROR_STOP on

-- Clients can no longer apply with a score of their choosing.
do $$ begin
  if exists (select 1 from pg_proc where proname = 'submit_job_application' and pronamespace = 'public'::regnamespace) then
    raise exception 'the client-callable submit_job_application still exists';
  end if;
  if has_function_privilege('authenticated', 'public.submit_job_application_for(uuid, text, text, integer, text[], text[])', 'execute')
     or has_function_privilege('anon', 'public.submit_job_application_for(uuid, text, text, integer, text[], text[])', 'execute') then
    raise exception 'clients can call submit_job_application_for';
  end if;
  if not has_function_privilege('service_role', 'public.submit_job_application_for(uuid, text, text, integer, text[], text[])', 'execute') then
    raise exception 'the backend cannot call submit_job_application_for';
  end if;
end $$;

-- The backend applies for a candidate with the score it calculated.
set role service_role;
select public.submit_job_application_for('00000000-0000-0000-0000-0000000000c2', 'employer', 'EMP-2', 250, array['Nursing', ' '], array['IV Therapy']);
do $$
declare row public.job_applications%rowtype;
begin
  select * into row from public.job_applications
  where user_id = '00000000-0000-0000-0000-0000000000c2' and job_id = 'EMP-2';
  if row.status <> 'pending' or row.job_title <> 'Nurse' or row.company_name <> 'Employer Two'
     or row.match_score <> 100 or row.matched_skills <> array['Nursing'] or row.missing_skills <> array['IV Therapy'] then
    raise exception 'server-scored application not saved as expected: %', row;
  end if;
  if row.candidate_name is not null or row.candidate_email is not null then
    raise exception 'identity copied onto the application';
  end if;
  begin
    perform public.submit_job_application_for('00000000-0000-0000-0000-0000000000c2', 'employer', 'EMP-2', 10, '{}', '{}');
    raise exception 'applied twice';
  exception when unique_violation then null;
  end;
  begin
    perform public.submit_job_application_for('00000000-0000-0000-0000-0000000000c2', 'employer', 'EMP-3', 10, '{}', '{}');
    raise exception 'applied to a closed job';
  exception when no_data_found then null;
  end;
  begin
    perform public.submit_job_application_for('00000000-0000-0000-0000-0000000000e1', 'employer', 'EMP-2', 10, '{}', '{}');
    raise exception 'an employer account applied';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.submit_job_application_for(null, 'employer', 'EMP-2', 10, '{}', '{}');
    raise exception 'applied without an applicant';
  exception when invalid_authorization_specification then null;
  end;
end $$;
reset role;

select 'Server-scored application checks passed.';

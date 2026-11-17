-- Checks for 20261117090000_application_privacy_and_integrity.sql. Any failed
-- check raises and stops.
\set ON_ERROR_STOP on

create or replace function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid, ''), false);
  set role authenticated;
end $$;

-- Ids used below.
-- c1 = 00000000-0000-0000-0000-0000000000c1, c2 = ...c2, e1 = ...e1 (owns EMP-1, EMP-3, EMP-4), e2 = ...e2 (owns EMP-2)
-- 30..01: c1 -> EMP-1 pending; 30..02: c2 -> EMP-1 shortlisted; 30..03: c1 -> EMP-2 interviewing, request accepted

-- ---------- Identity copies are gone and cannot come back ----------
do $$ begin
  if exists (select 1 from public.job_applications
             where candidate_name is not null or candidate_email is not null or candidate_location is not null) then
    raise exception 'identity copies were not cleared';
  end if;
end $$;
update public.job_applications set candidate_name = 'Leak', candidate_email = 'leak@example.com'
  where id = '30000000-0000-0000-0000-000000000001';
do $$ begin
  if (select candidate_name from public.job_applications where id = '30000000-0000-0000-0000-000000000001') is not null then
    raise exception 'identity can still be written to an application';
  end if;
end $$;

-- ---------- Nobody signed in can write an application directly ----------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
do $$ begin
  if (select count(*) from public.job_applications) <> 2 then
    raise exception 'candidate should read exactly their own two applications';
  end if;
  begin
    update public.job_applications set match_score = 100 where id = '30000000-0000-0000-0000-000000000001';
    raise exception 'candidate changed their match score';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.job_applications set status = 'hired' where id = '30000000-0000-0000-0000-000000000001';
    raise exception 'candidate changed their own stage';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.job_applications (user_id, job_source, job_id, status)
    values ('00000000-0000-0000-0000-0000000000c1', 'employer', 'EMP-3', 'pending');
    raise exception 'candidate inserted an application directly';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.job_applications where id = '30000000-0000-0000-0000-000000000001';
    raise exception 'candidate deleted an application';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000e1');
do $$ begin
  if (select count(*) from public.job_applications) <> 2 then
    raise exception 'employer 1 should read the two applications to EMP-1';
  end if;
  if exists (select 1 from public.job_applications where candidate_name is not null or candidate_email is not null) then
    raise exception 'employer can read identity on application rows';
  end if;
  begin
    update public.job_applications set message_request_state = 'accepted' where id = '30000000-0000-0000-0000-000000000001';
    raise exception 'employer accepted a message request for the candidate';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.job_applications set status = 'interviewing' where id = '30000000-0000-0000-0000-000000000002';
    raise exception 'employer changed a stage without set_application_stage';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ---------- submit_job_application ----------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
do $$ begin
  begin
    perform public.submit_job_application('employer', 'EMP-1', 50, '{}', '{}');
    raise exception 'applied twice to the same job';
  exception when unique_violation then null;
  end;
  begin
    perform public.submit_job_application('employer', 'EMP-3', 50, '{}', '{}');
    raise exception 'applied to a closed job';
  exception when no_data_found then null;
  end;
  begin
    perform public.submit_job_application('employer', 'EMP-4', 50, '{}', '{}');
    raise exception 'applied after the deadline';
  exception when no_data_found then null;
  end;
  begin
    perform public.submit_job_application('employer', 'NO-SUCH-JOB', 50, '{}', '{}');
    raise exception 'applied to a job that does not exist';
  exception when no_data_found then null;
  end;
  begin
    perform public.submit_job_application('internal', 'INT-CLOSED', 50, '{}', '{}');
    raise exception 'applied to a closed internal job';
  exception when no_data_found then null;
  end;
  begin
    perform public.submit_job_application('elsewhere', 'EMP-1', 50, '{}', '{}');
    raise exception 'accepted an unknown job source';
  exception when invalid_parameter_value then null;
  end;
end $$;

-- A new application takes the title and company from the job, and keeps
-- the score within 0-100 and the skill lists free of blanks.
select public.submit_job_application('internal', 'INT-OPEN', 250, array['SQL', ' ', ' Excel '], array['', 'Python']);
do $$
declare row public.job_applications%rowtype;
begin
  select * into row from public.job_applications
  where user_id = '00000000-0000-0000-0000-0000000000c1' and job_id = 'INT-OPEN';
  if row.status <> 'pending' or row.job_title <> 'Reference Analyst' or row.company_name <> 'Reference Co' then
    raise exception 'new application not saved as pending with the job''s title and company: %', row;
  end if;
  if row.match_score <> 100 or row.matched_skills <> array['SQL', 'Excel'] or row.missing_skills <> array['Python'] then
    raise exception 'score or skill lists not cleaned: %', row;
  end if;
end $$;
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000e1');
do $$ begin
  begin
    perform public.submit_job_application('employer', 'EMP-2', 50, '{}', '{}');
    raise exception 'an employer account applied for a job';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ---------- withdraw_job_application, then apply again ----------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
do $$ begin
  begin
    perform public.withdraw_job_application('30000000-0000-0000-0000-000000000002');
    raise exception 'withdrew another candidate''s application';
  exception when no_data_found then null;
  end;
end $$;
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000c2');
select public.withdraw_job_application('30000000-0000-0000-0000-000000000002');
do $$ begin
  if (select status from public.job_applications where id = '30000000-0000-0000-0000-000000000002') <> 'withdrawn'
     or (select withdrawn_at from public.job_applications where id = '30000000-0000-0000-0000-000000000002') is null then
    raise exception 'withdrawal not recorded';
  end if;
  begin
    perform public.withdraw_job_application('30000000-0000-0000-0000-000000000002');
    raise exception 'withdrew an already withdrawn application';
  exception when invalid_parameter_value then null;
  end;
end $$;
select public.submit_job_application('employer', 'EMP-1', 64, array['SQL'], '{}');
do $$
declare row public.job_applications%rowtype;
begin
  select * into row from public.job_applications where id = '30000000-0000-0000-0000-000000000002';
  if row.status <> 'pending' or row.withdrawn_at is not null or row.message_request_state <> 'none' or row.match_score <> 64 then
    raise exception 'applying again did not reopen the same application: %', row;
  end if;
end $$;
reset role;

-- ---------- respond_to_message_request ----------
update public.job_applications set message_request_state = 'pending' where id = '30000000-0000-0000-0000-000000000001';

select pg_temp.act_as('00000000-0000-0000-0000-0000000000c2');
do $$ begin
  begin
    perform public.respond_to_message_request('30000000-0000-0000-0000-000000000001', 'accepted');
    raise exception 'accepted a request on another candidate''s application';
  exception when no_data_found then null;
  end;
end $$;
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
do $$ begin
  begin
    perform public.respond_to_message_request('30000000-0000-0000-0000-000000000001', 'maybe');
    raise exception 'accepted an unknown response';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.respond_to_message_request('30000000-0000-0000-0000-000000000003', 'declined');
    raise exception 'answered a request that is no longer open';
  exception when invalid_parameter_value then null;
  end;
end $$;
select public.respond_to_message_request('30000000-0000-0000-0000-000000000001', 'ignored');
select public.respond_to_message_request('30000000-0000-0000-0000-000000000001', 'accepted');
do $$ begin
  if (select message_request_state from public.job_applications where id = '30000000-0000-0000-0000-000000000001') <> 'accepted' then
    raise exception 'request answer not saved';
  end if;
  begin
    perform public.respond_to_message_request('30000000-0000-0000-0000-000000000001', 'declined');
    raise exception 'changed an answered request';
  exception when invalid_parameter_value then null;
  end;
end $$;
reset role;

-- ---------- Identity from Interviewing on, for the job's own employer ----------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000e2');
do $$
declare found_row record;
begin
  select * into found_row from public.get_employer_applicant_identities();
  if found_row.application_id <> '30000000-0000-0000-0000-000000000003'
     or found_row.full_name <> 'Cara One' or found_row.email <> 'candidate1@example.com'
     or found_row.location <> 'Iloilo City, Iloilo' then
    raise exception 'interviewing applicant identity missing or wrong: %', found_row;
  end if;
  if (select count(*) from public.get_employer_applicant_identities()) <> 1 then
    raise exception 'employer 2 sees identities beyond their interviewing applicant';
  end if;
end $$;
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000e1');
do $$ begin
  if exists (select 1 from public.get_employer_applicant_identities()) then
    raise exception 'pending or shortlisted applicants were revealed';
  end if;
end $$;
-- Rejected before Interviewing stays masked; Interviewing reveals, and a
-- later rejection keeps it revealed. The stage function returns no identity.
select public.set_application_stage('30000000-0000-0000-0000-000000000002', 'rejected', 'Not a fit');
do $$ begin
  if exists (select 1 from public.get_employer_applicant_identities()) then
    raise exception 'an applicant rejected before Interviewing was revealed';
  end if;
  if (select (public.set_application_stage('30000000-0000-0000-0000-000000000001', 'interviewing', null)).candidate_email) is not null then
    raise exception 'set_application_stage returned identity';
  end if;
  if (select array_agg(application_id) from public.get_employer_applicant_identities())
     <> array['30000000-0000-0000-0000-000000000001'::uuid] then
    raise exception 'interviewing applicant not revealed to their employer';
  end if;
  perform public.set_application_stage('30000000-0000-0000-0000-000000000001', 'rejected', 'Hired someone else');
  if not exists (select 1 from public.get_employer_applicant_identities()
                 where application_id = '30000000-0000-0000-0000-000000000001') then
    raise exception 'rejection after Interviewing hid the identity again';
  end if;
end $$;
reset role;

-- ---------- Function access ----------
do $$ begin
  if has_function_privilege('anon', 'public.submit_job_application(text, text, integer, text[], text[])', 'execute')
     or has_function_privilege('anon', 'public.withdraw_job_application(uuid)', 'execute')
     or has_function_privilege('anon', 'public.respond_to_message_request(uuid, text)', 'execute')
     or has_function_privilege('anon', 'public.get_employer_applicant_identities()', 'execute') then
    raise exception 'anon can call an application function';
  end if;
  if has_function_privilege('authenticated', 'public.clear_application_identity()', 'execute') then
    raise exception 'the identity trigger function is callable';
  end if;
end $$;

select 'Application privacy checks passed.';

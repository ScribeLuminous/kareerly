\set ON_ERROR_STOP on
create or replace function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid, ''), false);
  set role authenticated;
end $$;

-- Employer Two's rubric was saved before assessments existed, so its only
-- criterion had no question. The migration fills it from the name.
do $$ begin
  if exists(select 1 from public.evaluation_criteria where btrim(question) = '') then raise exception 'empty questions left behind'; end if;
  if (select question from public.evaluation_criteria c join public.evaluation_rubrics r on r.id = c.rubric_id
      where r.job_post_id = '20000000-0000-0000-0000-000000000002' and c.name = 'Patient care' order by r.version desc limit 1)
    not like 'Tell us about your experience with Patient care.%' then raise exception 'legacy question not filled'; end if;
end $$;

-- An applicant already at Interviewing without an assessment can be sent one.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000e2');
select public.send_candidate_assessment('30000000-0000-0000-0000-000000000003');
reset role;

-- The candidate sees the assessment, its question and the notification.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
do $$ begin
  if (select count(*) from public.candidate_assessments where application_id = '30000000-0000-0000-0000-000000000003' and status = 'pending') <> 1 then raise exception 'candidate cannot see interviewing assessment'; end if;
  if (select count(*) from public.assessment_criterion_snapshots s join public.candidate_assessments a on a.id = s.assessment_id
      where a.application_id = '30000000-0000-0000-0000-000000000003' and btrim(s.question) <> '') < 1 then raise exception 'candidate cannot read the question'; end if;
  if (select count(*) from public.candidate_notifications where event_type = 'candidate_assessment' and application_id = '30000000-0000-0000-0000-000000000003') <> 1 then raise exception 'candidate notification missing'; end if;
end $$;
reset role;

-- Pending applicants still have to be shortlisted first.
insert into public.job_applications (id, user_id, job_id, status, matched_skills, missing_skills, message_request_state)
  values ('30000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-0000000000c1', 'EMP-1', 'pending', '{}', '{}', 'none');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000e1');
do $$ begin
  begin
    perform public.send_candidate_assessment('30000000-0000-0000-0000-000000000009');
    raise exception 'pending applicant was sent an assessment';
  exception when invalid_parameter_value then null;
  end;
end $$;
reset role;
\echo 'Assessment delivery fix checks passed.'

-- Checks for 20261028140000_assessment_link_opens.sql. Runs after the due-date
-- tests: application ...0002 has a reviewed assessment (employer e1, candidate
-- c2) and ...0009 has a pending one.
\set ON_ERROR_STOP on
create or replace function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid, ''), false);
  set role authenticated;
end $$;

update public.candidate_assessment_responses set response_text = response_text || ' Portfolio: https://example.com/work.'
  where assessment_id = (select id from public.candidate_assessments where application_id = '30000000-0000-0000-0000-000000000002');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000e1');
do $$
declare target uuid := (select id from public.candidate_assessments where application_id = '30000000-0000-0000-0000-000000000002');
begin
  perform public.log_assessment_link_opened(target, 'https://example.com/work');
  if (select count(*) from public.employer_review_audit_log where event_type = 'assessment_link_opened'
      and application_id = '30000000-0000-0000-0000-000000000002' and details ->> 'url' = 'https://example.com/work'
      and actor_user_id = '00000000-0000-0000-0000-0000000000e1') <> 1 then
    raise exception 'the opened link was not recorded for the reviewer';
  end if;
  -- A link that is not in the answers cannot be recorded.
  begin
    perform public.log_assessment_link_opened(target, 'https://evil.example/not-in-the-answers');
    raise exception 'recorded a link that is not in the answers';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.log_assessment_link_opened(target, 'javascript:alert(1)');
    raise exception 'recorded a non-web link';
  exception when invalid_parameter_value then null;
  end;
  -- An assessment still waiting for answers has no links to open.
  begin
    perform public.log_assessment_link_opened((select id from public.candidate_assessments where application_id = '30000000-0000-0000-0000-000000000009'), 'https://example.com/work');
    raise exception 'recorded a link on an unsubmitted assessment';
  exception when invalid_parameter_value then null;
  end;
end $$;
reset role;

-- Only the owning employer can record one: not another employer, not the candidate.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000e2');
do $$ begin
  begin
    perform public.log_assessment_link_opened((select id from public.candidate_assessments where application_id = '30000000-0000-0000-0000-000000000002'), 'https://example.com/work');
    raise exception 'another employer recorded a link';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c2');
do $$ begin
  begin
    perform public.log_assessment_link_opened((select id from public.candidate_assessments where application_id = '30000000-0000-0000-0000-000000000002'), 'https://example.com/work');
    raise exception 'the candidate recorded a link';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
set role anon;
do $$ begin
  begin
    perform public.log_assessment_link_opened(gen_random_uuid(), 'https://example.com/work');
    raise exception 'anon called the function';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
\echo 'Assessment link-open checks passed.'

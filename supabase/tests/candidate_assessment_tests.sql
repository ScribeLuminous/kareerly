\set ON_ERROR_STOP on
create or replace function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid, ''), false);
  set role authenticated;
end $$;

insert into public.candidate_profiles(user_id, public_id) values('00000000-0000-0000-0000-0000000000c2','CAN-2603');

-- The existing job rubric is reused, and the employer may edit it afterward.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000e1');
create temp table assessment_ids(key text primary key, value uuid);
grant all on assessment_ids to authenticated;
insert into assessment_ids values ('rubric', public.save_evaluation_rubric('20000000-0000-0000-0000-000000000001', '[
  {"name":"SQL","description":"Uses SQL at work","question":"Describe a query you improved.","weight":3,"is_required":true},
  {"name":"Communication","question":"Explain a finding to a customer.","weight":1,"is_required":false}
]'::jsonb));
insert into assessment_ids values ('assessment', public.send_candidate_assessment('30000000-0000-0000-0000-000000000002'));
insert into assessment_ids select 'question', id from public.assessment_criterion_snapshots where name = 'SQL';
do $$ begin
  if (select status from public.candidate_assessments where id = (select value from assessment_ids where key = 'assessment')) <> 'pending' then raise exception 'send did not make pending assessment'; end if;
  if (select count(*) from public.assessment_criterion_snapshots where assessment_id = (select value from assessment_ids where key = 'assessment')) <> 2 then raise exception 'criteria not snapshotted'; end if;
  begin
    perform public.send_candidate_assessment('30000000-0000-0000-0000-000000000002');
    raise exception 'duplicate send accepted';
  exception when unique_violation then null;
  end;
end $$;
select public.save_evaluation_rubric('20000000-0000-0000-0000-000000000001', '[
  {"name":"SQL","question":"A changed question","weight":5,"is_required":true}
]'::jsonb);
do $$ begin
  if (select question from public.assessment_criterion_snapshots where id = (select value from assessment_ids where key = 'question')) <> 'Describe a query you improved.' then raise exception 'sent question changed'; end if;
  if (select weight from public.assessment_criterion_snapshots where id = (select value from assessment_ids where key = 'question')) <> 3 then raise exception 'sent weight changed'; end if;
  if (select question from public.evaluation_criteria where rubric_id = (select value from assessment_ids where key = 'rubric') and name = 'SQL') <> 'Describe a query you improved.' then raise exception 'used rubric was mutated'; end if;
end $$;
reset role;

-- Another employer and another candidate cannot read or mutate the assessment.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000e2');
do $$ begin
  if exists(select 1 from public.candidate_assessments) then raise exception 'other employer read assessment'; end if;
  begin
    perform public.send_candidate_assessment('30000000-0000-0000-0000-000000000002');
    raise exception 'other employer sent assessment';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
do $$ begin
  if exists(select 1 from public.candidate_assessments) then raise exception 'other candidate read assessment'; end if;
  begin
    perform public.save_candidate_assessment((select value from assessment_ids where key = 'assessment'), '[]'::jsonb, true);
    raise exception 'other candidate submitted assessment';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000c2');
do $$ begin
  if (select count(*) from public.assessment_criterion_snapshots) <> 2 then raise exception 'candidate cannot read questions'; end if;
  if (select count(*) from public.candidate_notifications where event_type = 'candidate_assessment') <> 1 then raise exception 'candidate notification missing'; end if;
  begin
    perform public.save_candidate_assessment((select value from assessment_ids where key = 'assessment'), '[]'::jsonb, true);
    raise exception 'missing required answer accepted';
  exception when invalid_parameter_value then null;
  end;
end $$;
select public.save_candidate_assessment((select value from assessment_ids where key = 'assessment'),
  jsonb_build_array(jsonb_build_object('criterion_snapshot_id', (select value from assessment_ids where key = 'question'), 'response_text', 'I improved a slow query.')), false);
select public.save_candidate_assessment((select value from assessment_ids where key = 'assessment'), '[]'::jsonb, true);
do $$ begin
  if (select status from public.candidate_assessments where id = (select value from assessment_ids where key = 'assessment')) <> 'submitted' then raise exception 'assessment not submitted'; end if;
  begin
    perform public.save_candidate_assessment((select value from assessment_ids where key = 'assessment'), '[]'::jsonb, false);
    raise exception 'submitted answer changed';
  exception when invalid_parameter_value then null;
  end;
end $$;
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000e1');
do $$ begin
  if (select message from public.candidate_notifications where event_type = 'candidate_assessment_submitted') <> 'CAN-2603 submitted their Candidate Assessment.' then raise exception 'employer submission notification missing'; end if;
  if (select response_text from public.candidate_assessment_responses where criterion_snapshot_id = (select value from assessment_ids where key = 'question')) <> 'I improved a slow query.' then raise exception 'employer cannot read answer'; end if;
  if (select status from public.job_applications where id = '30000000-0000-0000-0000-000000000002') <> 'shortlisted' then raise exception 'submission moved application'; end if;
  begin
    perform public.set_application_stage('30000000-0000-0000-0000-000000000002', 'interviewing');
    raise exception 'decision before review accepted';
  exception when invalid_parameter_value then null;
  end;
end $$;
select public.save_evaluation_scorecard('30000000-0000-0000-0000-000000000002', (select value from assessment_ids where key = 'rubric'),
  jsonb_build_array(jsonb_build_object('criterion_id', (select source_criterion_id from public.assessment_criterion_snapshots where id = (select value from assessment_ids where key = 'question')), 'rating', 4, 'evidence', 'Specific query example.')),
  'Reviewed', true);
do $$ begin
  if (select status from public.candidate_assessments where id = (select value from assessment_ids where key = 'assessment')) <> 'reviewed' then raise exception 'scorecard did not mark reviewed'; end if;
  if (select evidence from public.evaluation_ratings where scorecard_id in (select id from public.evaluation_scorecards where application_id = '30000000-0000-0000-0000-000000000002') limit 1) <> 'Specific query example.' then raise exception 'employer notes not persisted'; end if;
  if (select status from public.job_applications where id = '30000000-0000-0000-0000-000000000002') <> 'shortlisted' then raise exception 'scorecard moved candidate'; end if;
  if (select count(*) from public.employer_review_audit_log where application_id = '30000000-0000-0000-0000-000000000002' and event_type in ('assessment_sent','assessment_submitted','scorecard_reviewed')) <> 3 then raise exception 'activity incomplete'; end if;
end $$;
select public.set_application_stage('30000000-0000-0000-0000-000000000002', 'interviewing');
do $$ begin
  if (select status from public.job_applications where id = '30000000-0000-0000-0000-000000000002') <> 'interviewing' then raise exception 'manual interviewing failed'; end if;
  if (select status from public.candidate_assessments where id = (select value from assessment_ids where key = 'assessment')) <> 'reviewed' then raise exception 'assessment history lost'; end if;
end $$;
select public.set_application_stage('30000000-0000-0000-0000-000000000002', 'rejected', 'Insufficient role fit after review');
do $$ begin
  if (select status from public.job_applications where id = '30000000-0000-0000-0000-000000000002') <> 'rejected' then raise exception 'manual decline failed'; end if;
  if (select count(*) from public.assessment_criterion_snapshots where assessment_id = (select value from assessment_ids where key = 'assessment')) <> 2 then raise exception 'decline erased assessment history'; end if;
  if (select count(*) from public.employer_review_audit_log where application_id = '30000000-0000-0000-0000-000000000002' and event_type in ('candidate_moved_to_interviewing','candidate_declined')) <> 2 then raise exception 'decision activity missing'; end if;
end $$;
reset role;
\echo 'Candidate assessment workflow and RLS checks passed.'

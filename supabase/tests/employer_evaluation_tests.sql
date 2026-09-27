-- Checks for 20260929090000_employer_structured_evaluation.sql: calculation,
-- incomplete evaluations, rubric versioning, authorization, stage audit and
-- preservation of existing records. Any failed check raises and stops.
\set ON_ERROR_STOP on
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on public.profiles, public.employer_profiles, public.employer_job_posts, public.job_applications to authenticated;

create or replace function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid, ''), false);
  set role authenticated;
end $$;

-- Existing applications survive the migration unchanged.
do $$ begin
  if (select count(*) from public.job_applications) <> 3 then raise exception 'applications lost in migration'; end if;
  if (select match_score from public.job_applications where id = '30000000-0000-0000-0000-000000000001') <> 57 then raise exception 'profile match changed'; end if;
  if (select status from public.job_applications where id = '30000000-0000-0000-0000-000000000002') <> 'shortlisted' then raise exception 'status changed'; end if;
  if (select message_request_state from public.job_applications where id = '30000000-0000-0000-0000-000000000003') <> 'accepted' then raise exception 'messaging state changed'; end if;
end $$;

-- Employer 1 builds a rubric: two required criteria (weights 3 and 1) and one optional (weight 2).
select pg_temp.act_as('00000000-0000-0000-0000-0000000000e1');
create temp table ids (key text primary key, value uuid);
grant all on ids to authenticated;
insert into ids values ('rubric1', public.save_evaluation_rubric('20000000-0000-0000-0000-000000000001', '[
  {"name":"SQL analysis","description":"Writes correct queries","weight":3,"is_required":true,
   "anchors":["No evidence","Basic","Solid","Advanced"],"prompts":["Walk me through a query you optimised."]},
  {"name":"Communicating findings","weight":1,"is_required":true},
  {"name":"Dashboard tools","weight":2,"is_required":false}
]'::jsonb));
insert into ids select 'sql', id from public.evaluation_criteria where name = 'SQL analysis';
insert into ids select 'comm', id from public.evaluation_criteria where name = 'Communicating findings';
insert into ids select 'dash', id from public.evaluation_criteria where name = 'Dashboard tools';
do $$ begin
  if (select count(*) from public.evaluation_criteria) <> 3 then raise exception 'criteria not saved'; end if;
  if (select prompts[1] from public.evaluation_criteria where name = 'SQL analysis') <> 'Walk me through a query you optimised.' then raise exception 'prompt not saved'; end if;
end $$;

-- Editing before any scorecard keeps version 1 in place.
select public.save_evaluation_rubric('20000000-0000-0000-0000-000000000001', '[
  {"name":"SQL analysis","weight":3,"is_required":true},
  {"name":"Communicating findings","weight":1,"is_required":true},
  {"name":"Dashboard tools","weight":2,"is_required":false}
]'::jsonb) = (select value from ids where key = 'rubric1') as same_rubric \gset
\if :same_rubric
\else
  \echo 'edit before scorecards should keep the same rubric version'
  select 1/0;
\endif
delete from ids where key in ('sql', 'comm', 'dash');
insert into ids select 'sql', id from public.evaluation_criteria where name = 'SQL analysis';
insert into ids select 'comm', id from public.evaluation_criteria where name = 'Communicating findings';
insert into ids select 'dash', id from public.evaluation_criteria where name = 'Dashboard tools';

-- Draft scorecard: SQL rated 4, communication not assessed. Drafts never count.
select public.save_evaluation_scorecard('30000000-0000-0000-0000-000000000001', (select value from ids where key = 'rubric1'),
  jsonb_build_array(
    jsonb_build_object('criterion_id', (select value from ids where key = 'sql'), 'rating', 4, 'evidence', 'Explained window functions on a real report.'),
    jsonb_build_object('criterion_id', (select value from ids where key = 'comm'), 'rating', null, 'evidence', '')
  ), 'First pass', false);
do $$
declare result jsonb := public.get_application_evaluation('30000000-0000-0000-0000-000000000001')->'versions'->0;
begin
  if (result->>'submitted_scorecards')::int <> 0 then raise exception 'draft counted as submitted'; end if;
  if result->'score' <> 'null'::jsonb then raise exception 'draft produced a score'; end if;
end $$;

-- Submitted but a required criterion is unassessed: no score, partial coverage.
select public.save_evaluation_scorecard('30000000-0000-0000-0000-000000000001', (select value from ids where key = 'rubric1'),
  jsonb_build_array(jsonb_build_object('criterion_id', (select value from ids where key = 'sql'), 'rating', 4, 'evidence', 'Explained window functions.')),
  'Submitted without communication evidence', true);
do $$
declare result jsonb := public.get_application_evaluation('30000000-0000-0000-0000-000000000001')->'versions'->0;
begin
  if result->'score' <> 'null'::jsonb then raise exception 'score published with a required criterion unassessed: %', result; end if;
  if (result->>'coverage_percent')::int <> 50 then raise exception 'coverage should be 3/6 = 50, got %', result->>'coverage_percent'; end if;
  if (result->>'is_complete')::boolean then raise exception 'incomplete evaluation reported complete'; end if;
  if (result->>'required_assessed')::int <> 1 then raise exception 'required assessed count wrong'; end if;
end $$;

-- Rate communication 2; dashboard (optional) stays not assessed.
-- score = 100 * (3*(4-1)/3 + 1*(2-1)/3) / (3+1) = 100 * (3 + 0.3333) / 4 = 83
select public.save_evaluation_scorecard('30000000-0000-0000-0000-000000000001', (select value from ids where key = 'rubric1'),
  jsonb_build_array(
    jsonb_build_object('criterion_id', (select value from ids where key = 'comm'), 'rating', 2, 'evidence', 'Summary was clear but skipped caveats.'),
    jsonb_build_object('criterion_id', (select value from ids where key = 'dash'), 'rating', null, 'evidence', 'Not covered in interview.')
  ), 'Complete', true);
do $$
declare result jsonb := public.get_application_evaluation('30000000-0000-0000-0000-000000000001')->'versions'->0;
begin
  if (result->>'score')::int <> 83 then raise exception 'expected 83, got %', result; end if;
  if (result->>'coverage_percent')::int <> 67 then raise exception 'coverage should be 4/6 = 67, got %', result->>'coverage_percent'; end if;
  if not (result->>'is_complete')::boolean then raise exception 'should be complete'; end if;
  if (result->'criteria'->2->>'not_assessed_count')::int <> 1 then raise exception 'not assessed not reported'; end if;
  if (result->'criteria'->2->>'rating_count')::int <> 0 then raise exception 'not assessed counted as a rating'; end if;
end $$;

-- A second reviewer on the same employer is not possible in the current
-- account model, so simulate one to check averaging and spread.
reset role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000f1', 'reviewer2@example.com');
insert into public.evaluation_scorecards (id, application_id, rubric_id, reviewer_user_id, status, submitted_at)
  values ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', (select value from ids where key = 'rubric1'), '00000000-0000-0000-0000-0000000000f1', 'submitted', now());
insert into public.evaluation_ratings (scorecard_id, criterion_id, rating) values
  ('40000000-0000-0000-0000-000000000001', (select value from ids where key = 'sql'), 2),
  ('40000000-0000-0000-0000-000000000001', (select value from ids where key = 'comm'), 2);
select pg_temp.act_as('00000000-0000-0000-0000-0000000000e1');
-- sql mean 3 -> 3*(2/3)=2; comm mean 2 -> 1/3; score = 100*(2.3333)/4 = 58
do $$
declare result jsonb := public.get_application_evaluation('30000000-0000-0000-0000-000000000001')->'versions'->0;
begin
  if (result->>'score')::int <> 58 then raise exception 'expected 58 with two reviewers, got %', result; end if;
  if (result->'criteria'->0->>'spread')::int <> 2 then raise exception 'spread should be 2'; end if;
  if (result->>'submitted_scorecards')::int <> 2 then raise exception 'two scorecards expected'; end if;
end $$;

-- Deterministic: the same inputs always give the same result.
do $$ begin
  if public.get_application_evaluation('30000000-0000-0000-0000-000000000001') <> public.get_application_evaluation('30000000-0000-0000-0000-000000000001') then
    raise exception 'result is not deterministic';
  end if;
end $$;

-- Changing weights after reviews creates version 2; version 1 results stay as they were.
insert into ids values ('rubric2', public.save_evaluation_rubric('20000000-0000-0000-0000-000000000001', '[
  {"name":"SQL analysis","weight":1,"is_required":true},
  {"name":"Communicating findings","weight":5,"is_required":true}
]'::jsonb));
do $$
declare evaluation jsonb := public.get_application_evaluation('30000000-0000-0000-0000-000000000001');
begin
  if (select value from ids where key = 'rubric1') = (select value from ids where key = 'rubric2') then raise exception 'rubric in use was edited in place'; end if;
  if (select version from public.evaluation_rubrics where id = (select value from ids where key = 'rubric2')) <> 2 then raise exception 'version 2 expected'; end if;
  if (select superseded_at from public.evaluation_rubrics where id = (select value from ids where key = 'rubric1')) is null then raise exception 'version 1 not marked superseded'; end if;
  if (select count(*) from public.evaluation_criteria where rubric_id = (select value from ids where key = 'rubric1')) <> 3 then raise exception 'version 1 criteria changed'; end if;
  if (evaluation->>'current_rubric_id')::uuid <> (select value from ids where key = 'rubric2') then raise exception 'current rubric should be version 2'; end if;
  if jsonb_array_length(evaluation->'versions') <> 1 then raise exception 'only version 1 has scorecards'; end if;
  if (evaluation->'versions'->0->>'score')::int <> 58 then raise exception 'version 1 was recalculated with new weights'; end if;
  if (evaluation->'versions'->0->>'rubric_version')::int <> 1 then raise exception 'result should name version 1'; end if;
end $$;

-- New scorecards cannot start on a superseded version.
do $$ begin
  begin
    perform public.save_evaluation_scorecard('30000000-0000-0000-0000-000000000002', (select value from ids where key = 'rubric1'), '[]'::jsonb, '', false);
    raise exception 'scorecard started on a superseded rubric';
  exception when invalid_parameter_value then null;
  end;
end $$;

-- Job summaries use only the current version: nothing scored on version 2 yet.
do $$ begin
  if (select count(*) from public.list_job_evaluation_summaries('20000000-0000-0000-0000-000000000001')) <> 2 then raise exception 'summaries should list both applicants'; end if;
  if exists (select 1 from public.list_job_evaluation_summaries('20000000-0000-0000-0000-000000000001') where result->'score' <> 'null'::jsonb) then
    raise exception 'summary mixed rubric versions';
  end if;
end $$;

-- Summaries report the caller's own scorecard status on the current version.
do $$ begin
  if exists (select 1 from public.list_job_evaluation_summaries('20000000-0000-0000-0000-000000000001') where my_scorecard_status is not null) then
    raise exception 'no scorecard exists on version 2 yet';
  end if;
end $$;

-- Ratings against another version's criteria are refused.
do $$ begin
  begin
    perform public.save_evaluation_scorecard('30000000-0000-0000-0000-000000000002', (select value from ids where key = 'rubric2'),
      jsonb_build_array(jsonb_build_object('criterion_id', (select value from ids where key = 'sql'), 'rating', 3)), '', false);
    raise exception 'rating accepted for a criterion from another version';
  exception when invalid_parameter_value then null;
  end;
end $$;

-- Out-of-range ratings are refused.
do $$ begin
  begin
    perform public.save_evaluation_scorecard('30000000-0000-0000-0000-000000000002', (select value from ids where key = 'rubric2'),
      jsonb_build_array(jsonb_build_object('criterion_id', (select id from public.evaluation_criteria where rubric_id = (select value from ids where key = 'rubric2') limit 1), 'rating', 5)), '', false);
    raise exception 'rating 5 accepted';
  exception when invalid_parameter_value or check_violation then null;
  end;
end $$;

select public.save_evaluation_scorecard('30000000-0000-0000-0000-000000000002', (select value from ids where key = 'rubric2'), '[]'::jsonb, 'Started', false);
do $$ begin
  if (select my_scorecard_status from public.list_job_evaluation_summaries('20000000-0000-0000-0000-000000000001')
      where application_id = '30000000-0000-0000-0000-000000000002') <> 'draft' then raise exception 'own draft status not reported'; end if;
end $$;

-- Stage changes are recorded with the actor; scores never change stage.
select (public.set_application_stage('30000000-0000-0000-0000-000000000001', 'interviewing')).status as new_status \gset
do $$ begin
  if (select status from public.job_applications where id = '30000000-0000-0000-0000-000000000001') <> 'interviewing' then raise exception 'stage not changed'; end if;
  if not exists (select 1 from public.employer_review_audit_log where event_type = 'stage_changed'
      and application_id = '30000000-0000-0000-0000-000000000001' and actor_user_id = '00000000-0000-0000-0000-0000000000e1'
      and details->>'from' = 'pending' and details->>'to' = 'interviewing') then raise exception 'stage change not audited'; end if;
  if (select count(*) from public.employer_review_audit_log where event_type in ('scorecard_saved', 'scorecard_submitted')) <> 4 then raise exception 'scorecard edits not audited'; end if;
  if (select count(*) from public.employer_review_audit_log where event_type = 'rubric_versioned') <> 1 then raise exception 'rubric version not audited'; end if;
  if (select status from public.job_applications where id = '30000000-0000-0000-0000-000000000002') <> 'shortlisted' then raise exception 'another applicant was moved'; end if;
end $$;
do $$ begin
  begin
    perform public.set_application_stage('30000000-0000-0000-0000-000000000002', 'rejected', '');
    raise exception 'rejection without reason accepted';
  exception when invalid_parameter_value then null;
  end;
end $$;
reset role;

-- Employer 2 cannot read or write employer 1's rubric, scorecards or audit log.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000e2');
do $$ begin
  if (select count(*) from public.evaluation_rubrics) <> 0 then raise exception 'employer 2 reads employer 1 rubrics'; end if;
  if (select count(*) from public.evaluation_criteria) <> 0 then raise exception 'employer 2 reads employer 1 criteria'; end if;
  if (select count(*) from public.evaluation_scorecards) <> 0 then raise exception 'employer 2 reads scorecards'; end if;
  if (select count(*) from public.evaluation_ratings) <> 0 then raise exception 'employer 2 reads ratings'; end if;
  if (select count(*) from public.employer_review_audit_log) <> 0 then raise exception 'employer 2 reads the audit log'; end if;
  begin
    perform public.get_application_evaluation('30000000-0000-0000-0000-000000000001');
    raise exception 'employer 2 read an evaluation';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.list_job_evaluation_summaries('20000000-0000-0000-0000-000000000001');
    raise exception 'employer 2 listed summaries';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.save_evaluation_rubric('20000000-0000-0000-0000-000000000001', '[{"name":"x"}]'::jsonb);
    raise exception 'employer 2 edited a rubric';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.save_evaluation_scorecard('30000000-0000-0000-0000-000000000002', (select id from public.evaluation_rubrics limit 1), '[]'::jsonb, '', true);
    raise exception 'employer 2 wrote a scorecard';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.set_application_stage('30000000-0000-0000-0000-000000000002', 'hired');
    raise exception 'employer 2 changed a stage';
  exception when insufficient_privilege then null;
  end;
end $$;
-- A rubric on employer 1's job cannot be used for employer 2's application.
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000e2');
insert into ids values ('rubric_other', public.save_evaluation_rubric('20000000-0000-0000-0000-000000000002', '[{"name":"Patient care","weight":2}]'::jsonb));
do $$ begin
  begin
    perform public.save_evaluation_scorecard('30000000-0000-0000-0000-000000000003', (select id from public.evaluation_rubrics where job_post_id = '20000000-0000-0000-0000-000000000001' limit 1), '[]'::jsonb, '', false);
    raise exception 'mismatched rubric accepted';
  exception when insufficient_privilege then null;
  end;
end $$;
-- Direct table writes are refused even for the owner.
do $$ begin
  begin
    insert into public.evaluation_rubrics (job_post_id, employer_id, version) values ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 9);
    raise exception 'direct rubric insert allowed';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- Candidates cannot read evaluations of their own applications.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
do $$ begin
  if (select count(*) from public.evaluation_scorecards) <> 0 then raise exception 'candidate reads scorecards'; end if;
  begin
    perform public.get_application_evaluation('30000000-0000-0000-0000-000000000001');
    raise exception 'candidate read an evaluation';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
\echo 'Employer evaluation checks passed.'

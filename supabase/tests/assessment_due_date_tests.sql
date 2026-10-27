-- Checks for 20261028120000_assessment_due_dates.sql. Runs after the earlier
-- assessment tests: applications ...0001 and ...0009 are pending at job EMP-1
-- (employer e1, candidate c1) and have no assessment yet.
\set ON_ERROR_STOP on
create or replace function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid, ''), false);
  set role authenticated;
end $$;
create temp table due_ids(key text primary key, value uuid);
grant all on due_ids to authenticated;

-- Assessments that were already waiting got a deadline from the migration.
do $$ begin
  if exists (select 1 from public.candidate_assessments where status = 'pending' and due_at is null) then
    raise exception 'a pending assessment has no deadline';
  end if;
end $$;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000e1');
select public.set_application_stage('30000000-0000-0000-0000-000000000001', 'shortlisted');
select public.set_application_stage('30000000-0000-0000-0000-000000000009', 'shortlisted');

-- The deadline must be a fair one.
do $$ begin
  begin
    perform public.send_candidate_assessment('30000000-0000-0000-0000-000000000001', now() + interval '2 hours');
    raise exception 'a 2 hour deadline was accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.send_candidate_assessment('30000000-0000-0000-0000-000000000001', now() + interval '100 days');
    raise exception 'a 100 day deadline was accepted';
  exception when invalid_parameter_value then null;
  end;
end $$;

-- Default: 7 days. Custom: whatever the employer chose.
insert into due_ids values ('default', public.send_candidate_assessment('30000000-0000-0000-0000-000000000001'));
insert into due_ids values ('custom', public.send_candidate_assessment('30000000-0000-0000-0000-000000000009', now() + interval '3 days'));
do $$ declare d timestamptz; begin
  select due_at into d from public.candidate_assessments where id = (select value from due_ids where key = 'default');
  if d < now() + interval '6 days 23 hours' or d > now() + interval '7 days 1 hour' then raise exception 'default deadline is not 7 days: %', d; end if;
  select due_at into d from public.candidate_assessments where id = (select value from due_ids where key = 'custom');
  if d < now() + interval '2 days 23 hours' or d > now() + interval '3 days 1 hour' then raise exception 'custom deadline was not kept: %', d; end if;
end $$;
reset role;

-- The candidate sees the deadline, and is told it in the notification.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
do $$ begin
  if (select count(*) from public.candidate_assessments where due_at is not null and status = 'pending'
      and application_id in ('30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000009')) <> 2 then
    raise exception 'candidate cannot read the deadline';
  end if;
  if not exists (select 1 from public.candidate_notifications where event_type = 'candidate_assessment'
      and application_id = '30000000-0000-0000-0000-000000000001' and message like '%Please submit it by %(Philippine time).') then
    raise exception 'the notification does not name the deadline';
  end if;
end $$;
reset role;

-- Before the deadline the employer cannot decline for not answering.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000e1');
do $$ begin
  begin
    perform public.set_application_stage('30000000-0000-0000-0000-000000000001', 'rejected', 'No response');
    raise exception 'declined before the deadline';
  exception when invalid_parameter_value then
    if sqlerrm not like 'The candidate has until %' then raise; end if;
  end;
  begin
    perform public.set_application_stage('30000000-0000-0000-0000-000000000001', 'interviewing');
    raise exception 'moved to interviewing without a reviewed assessment';
  exception when invalid_parameter_value then null;
  end;
end $$;
reset role;

-- After the deadline, with nothing submitted: the candidate can no longer
-- answer, and the employer can decline (but still cannot interview).
update public.candidate_assessments set sent_at = now() - interval '9 days', due_at = now() - interval '1 hour'
  where id in ((select value from due_ids where key = 'default'), (select value from due_ids where key = 'custom'));
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
do $$ begin
  begin
    perform public.save_candidate_assessment((select value from due_ids where key = 'default'), '[]'::jsonb, true);
    raise exception 'answered after the deadline';
  exception when invalid_parameter_value then
    if sqlerrm not like 'The deadline for this assessment has passed%' then raise; end if;
  end;
end $$;
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000e1');
do $$ begin
  begin
    perform public.set_application_stage('30000000-0000-0000-0000-000000000009', 'interviewing');
    raise exception 'interviewing without a reviewed assessment after the deadline';
  exception when invalid_parameter_value then null;
  end;
end $$;
select public.set_application_stage('30000000-0000-0000-0000-000000000001', 'rejected', 'No response by the deadline');
do $$ begin
  if (select status from public.job_applications where id = '30000000-0000-0000-0000-000000000001') <> 'rejected' then
    raise exception 'declining after the deadline failed';
  end if;
end $$;
reset role;

-- Extending: only the owning employer, only later, only while pending.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000e2');
do $$ begin
  begin
    perform public.extend_assessment_deadline((select value from due_ids where key = 'custom'), now() + interval '5 days');
    raise exception 'another employer extended the deadline';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000e1');
do $$ begin
  begin
    perform public.extend_assessment_deadline((select value from due_ids where key = 'custom'), now() + interval '2 hours');
    raise exception 'extended to under 24 hours';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.extend_assessment_deadline((select value from due_ids where key = 'custom'), now() - interval '2 days');
    raise exception 'moved the deadline earlier';
  exception when invalid_parameter_value then null;
  end;
end $$;
select public.extend_assessment_deadline((select value from due_ids where key = 'custom'), now() + interval '4 days');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
do $$ begin
  -- The candidate can answer again, and was told about the new deadline.
  perform public.save_candidate_assessment((select value from due_ids where key = 'custom'), '[]'::jsonb, false);
  if not exists (select 1 from public.candidate_notifications where title = 'More time for your Candidate Assessment' and application_id = '30000000-0000-0000-0000-000000000009') then
    raise exception 'the candidate was not told about the extension';
  end if;
end $$;
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000e1');
do $$ begin
  if (select count(*) from public.employer_review_audit_log where event_type = 'assessment_deadline_extended') <> 1 then raise exception 'extension not logged'; end if;
  -- A submitted assessment's deadline can no longer be changed.
  begin
    perform public.extend_assessment_deadline((select id from public.candidate_assessments where application_id = '30000000-0000-0000-0000-000000000002'), now() + interval '9 days');
    raise exception 'extended a submitted assessment';
  exception when invalid_parameter_value then null;
  end;
end $$;
reset role;
\echo 'Assessment due date checks passed.'

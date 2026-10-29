-- Candidate Assessments get a deadline.
--
-- Without one, an employer could not decide on an applicant who never
-- answered (a decision needs a reviewed assessment), and the candidate was
-- never told how long they had. Now:
--   * the employer sets due_at when sending (default 7 days, minimum 24 hours,
--     maximum 90 days) and the candidate sees it;
--   * the candidate can answer until due_at, and the employer can extend it;
--   * until due_at passes, the employer cannot decline the applicant for not
--     answering; after it passes without a submission, they can.
-- Nothing here changes a stage by itself: no job drops or marks anyone
-- incomplete. Safe to re-run.

alter table public.candidate_assessments add column if not exists due_at timestamptz;

-- Assessments already waiting for an answer get a week from now rather than
-- one counted from when they were sent, so none is overdue the moment this runs.
update public.candidate_assessments set due_at = now() + interval '7 days'
  where due_at is null and status = 'pending';

alter table public.candidate_assessments drop constraint if exists candidate_assessments_due_after_sent;
alter table public.candidate_assessments add constraint candidate_assessments_due_after_sent
  check (due_at is null or due_at > sent_at);

alter table public.employer_review_audit_log drop constraint if exists employer_review_audit_log_event_type_check;
alter table public.employer_review_audit_log add constraint employer_review_audit_log_event_type_check check
  (event_type in ('stage_changed','scorecard_saved','scorecard_submitted','rubric_saved','rubric_versioned',
    'assessment_sent','assessment_submitted','scorecard_reviewed','candidate_moved_to_interviewing','candidate_declined',
    'assessment_deadline_extended'));

-- A second argument means a second overload, which makes PostgREST calls
-- ambiguous, so the one-argument version is replaced rather than kept.
drop function if exists public.send_candidate_assessment(uuid);

create or replace function public.send_candidate_assessment(target_application_id uuid, requested_due_at timestamptz default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  target_job uuid;
  target_rubric uuid;
  target_candidate uuid;
  target_employer uuid;
  target_title text;
  assessment uuid;
  effective_due timestamptz := coalesce(requested_due_at, now() + interval '7 days');
begin
  target_job := public.owned_job_post_for_application(target_application_id);
  if target_job is null then raise exception 'This application does not belong to your employer account.' using errcode = '42501'; end if;
  if effective_due < now() + interval '24 hours' then
    raise exception 'Give the candidate at least 24 hours to respond.' using errcode = '22023';
  end if;
  if effective_due > now() + interval '90 days' then
    raise exception 'The deadline can be at most 90 days away.' using errcode = '22023';
  end if;
  select user_id, job_title into target_candidate, target_title from public.job_applications
    where id = target_application_id and lower(status) in ('shortlisted', 'interviewing') for update;
  if target_candidate is null then raise exception 'Only shortlisted or interviewing candidates can be sent an assessment.' using errcode = '22023'; end if;
  if exists(select 1 from public.candidate_assessments where application_id = target_application_id) then
    raise exception 'An assessment was already sent to this candidate.' using errcode = '23505';
  end if;
  select id into target_rubric from public.evaluation_rubrics where job_post_id = target_job order by version desc limit 1;
  if target_rubric is null or not exists(select 1 from public.evaluation_criteria where rubric_id = target_rubric) then
    raise exception 'Configure an assessment for this job first.' using errcode = '22023';
  end if;
  select employer_id into target_employer from public.employer_job_posts where id = target_job;
  insert into public.candidate_assessments(application_id, candidate_user_id, job_post_id, employer_id, rubric_id, due_at)
    values(target_application_id, target_candidate, target_job, target_employer, target_rubric, effective_due) returning id into assessment;
  insert into public.assessment_criterion_snapshots(assessment_id, source_criterion_id, name, description, question, is_required, weight, position)
    select assessment, id, name, coalesce(description, ''),
      coalesce(nullif(btrim(question), ''), nullif(btrim(prompts[1]), ''),
        'Tell us about your experience with ' || name || '. What did you do and what was the result?'),
      is_required, weight, position
    from public.evaluation_criteria where rubric_id = target_rubric;
  insert into public.candidate_notifications(recipient_user_id, event_type, application_id, event_version, title, message)
    values(target_candidate, 'candidate_assessment', target_application_id, assessment::text, 'Candidate Assessment received',
      'You have received a Candidate Assessment for ' || coalesce(target_title, 'your application')
        || '. Please submit it by ' || to_char(effective_due at time zone 'Asia/Manila', 'Mon FMDD, YYYY "at" FMHH12:MI AM') || ' (Philippine time).')
    on conflict do nothing;
  insert into public.employer_review_audit_log(application_id, job_post_id, actor_user_id, event_type, details)
    values(target_application_id, target_job, auth.uid(), 'assessment_sent', jsonb_build_object('assessment_id', assessment, 'due_at', effective_due));
  return assessment;
end $$;

revoke all on function public.send_candidate_assessment(uuid, timestamptz) from public, anon;
grant execute on function public.send_candidate_assessment(uuid, timestamptz) to authenticated;

-- Answers (and drafts) are accepted until the deadline; after it the employer
-- decides whether to extend it or decline.
create or replace function public.save_candidate_assessment(target_assessment_id uuid, answers jsonb, submit boolean default false)
returns text language plpgsql security definer set search_path = public as $$
declare
  a public.candidate_assessments%rowtype;
  item jsonb;
  snapshot_id uuid;
  missing_count integer;
begin
  if answers is null or jsonb_typeof(answers) <> 'array' or jsonb_array_length(answers) > 12 then
    raise exception 'Answers must be a list of at most 12 items.' using errcode = '22023';
  end if;
  select * into a from public.candidate_assessments where id = target_assessment_id for update;
  if not found or a.candidate_user_id <> auth.uid() then
    raise exception 'This assessment is not assigned to you.' using errcode = '42501';
  end if;
  if a.status <> 'pending' then raise exception 'Submitted responses are read-only.' using errcode = '22023'; end if;
  if a.due_at is not null and now() > a.due_at then
    raise exception 'The deadline for this assessment has passed. Ask the employer if they can give you more time.' using errcode = '22023';
  end if;
  for item in select value from jsonb_array_elements(answers) loop
    if jsonb_typeof(item) <> 'object' or item->>'criterion_snapshot_id' is null
      or jsonb_typeof(item->'response_text') <> 'string' then
      raise exception 'Each answer needs a criterion and response text.' using errcode = '22023';
    end if;
    snapshot_id := (item->>'criterion_snapshot_id')::uuid;
    if not exists(select 1 from public.assessment_criterion_snapshots where id = snapshot_id and assessment_id = a.id) then
      raise exception 'A question does not belong to this assessment.' using errcode = '22023';
    end if;
    if length(item->>'response_text') > 10000 then raise exception 'Answers must be at most 10000 characters.' using errcode = '22023'; end if;
    insert into public.candidate_assessment_responses(assessment_id, criterion_snapshot_id, response_text)
      values(a.id, snapshot_id, btrim(item->>'response_text'))
      on conflict(assessment_id, criterion_snapshot_id) do update set response_text = excluded.response_text, updated_at = now();
  end loop;
  if submit then
    select count(*) into missing_count from public.assessment_criterion_snapshots s
      left join public.candidate_assessment_responses r on r.assessment_id = s.assessment_id and r.criterion_snapshot_id = s.id
      where s.assessment_id = a.id and s.is_required and btrim(coalesce(r.response_text, '')) = '';
    if missing_count > 0 then raise exception 'Complete all required questions before submitting.' using errcode = '22023'; end if;
    update public.candidate_assessments set status = 'submitted', submitted_at = now(), updated_at = now() where id = a.id;
    insert into public.employer_review_audit_log(application_id, job_post_id, actor_user_id, event_type, details)
      values(a.application_id, a.job_post_id, auth.uid(), 'assessment_submitted', jsonb_build_object('assessment_id', a.id));
    insert into public.candidate_notifications(recipient_user_id, event_type, application_id, event_version, title, message)
      select employers.user_id, 'candidate_assessment_submitted', a.application_id, a.id::text,
        'Candidate Assessment submitted',
        coalesce((select candidates.public_id from public.candidate_profiles candidates where candidates.user_id = a.candidate_user_id), 'A candidate')
          || ' submitted their Candidate Assessment.'
      from public.employer_profiles employers where employers.id = a.employer_id
      on conflict do nothing;
  else
    update public.candidate_assessments set updated_at = now() where id = a.id;
  end if;
  return case when submit then 'submitted' else 'pending' end;
end $$;

revoke all on function public.save_candidate_assessment(uuid, jsonb, boolean) from public, anon;
grant execute on function public.save_candidate_assessment(uuid, jsonb, boolean) to authenticated;

-- Gives the candidate more time. A deadline only ever moves later, so an
-- employer cannot shorten the time a candidate was already promised.
create or replace function public.extend_assessment_deadline(target_assessment_id uuid, new_due_at timestamptz)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare
  a public.candidate_assessments%rowtype;
  job_title_text text;
begin
  if auth.uid() is null then raise exception 'Authentication is required.' using errcode = '28000'; end if;
  select * into a from public.candidate_assessments where id = target_assessment_id for update;
  if not found or not public.employer_owns_job_post(a.job_post_id) then
    raise exception 'This assessment does not belong to your employer account.' using errcode = '42501';
  end if;
  if a.status <> 'pending' then raise exception 'Only an assessment still waiting for an answer can be extended.' using errcode = '22023'; end if;
  if new_due_at < now() + interval '24 hours' then
    raise exception 'Give the candidate at least 24 hours from now.' using errcode = '22023';
  end if;
  if new_due_at > now() + interval '90 days' then
    raise exception 'The deadline can be at most 90 days away.' using errcode = '22023';
  end if;
  if a.due_at is not null and new_due_at <= a.due_at then
    raise exception 'The new deadline must be later than the current one.' using errcode = '22023';
  end if;
  update public.candidate_assessments set due_at = new_due_at, updated_at = now() where id = a.id;
  select job_title into job_title_text from public.job_applications where id = a.application_id;
  insert into public.candidate_notifications(recipient_user_id, event_type, application_id, event_version, title, message)
    values(a.candidate_user_id, 'candidate_assessment', a.application_id, a.id::text || ':due:' || extract(epoch from new_due_at)::bigint::text,
      'More time for your Candidate Assessment',
      'The deadline for your Candidate Assessment for ' || coalesce(job_title_text, 'your application')
        || ' is now ' || to_char(new_due_at at time zone 'Asia/Manila', 'Mon FMDD, YYYY "at" FMHH12:MI AM') || ' (Philippine time).')
    on conflict do nothing;
  insert into public.employer_review_audit_log(application_id, job_post_id, actor_user_id, event_type, details)
    values(a.application_id, a.job_post_id, auth.uid(), 'assessment_deadline_extended',
      jsonb_build_object('assessment_id', a.id, 'from', a.due_at, 'to', new_due_at));
  return new_due_at;
end $$;

revoke all on function public.extend_assessment_deadline(uuid, timestamptz) from public, anon;
grant execute on function public.extend_assessment_deadline(uuid, timestamptz) to authenticated;

-- A decision normally needs a reviewed assessment. Two cases are added:
-- while the candidate still has time, declining for not responding is refused
-- with the deadline named; once the deadline has passed with nothing
-- submitted, the employer can decline.
create or replace function public.set_application_stage(target_application_id uuid, next_status text, reason text default null)
returns public.job_applications
language plpgsql
security definer
set search_path = public
as $$
declare
  current_status text;
  updated public.job_applications%rowtype;
  open_assessment public.candidate_assessments%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication is required.' using errcode = '28000'; end if;
  if public.owned_job_post_for_application(target_application_id) is null then
    raise exception 'This application does not belong to your employer account.' using errcode = '42501';
  end if;
  if next_status not in ('shortlisted', 'interviewing', 'hired', 'rejected') then
    raise exception 'Invalid application status.' using errcode = '22023';
  end if;
  if next_status = 'rejected' and length(btrim(coalesce(reason, ''))) = 0 then
    raise exception 'A rejection reason is required.' using errcode = '22023';
  end if;
  select status into current_status from public.job_applications where id = target_application_id for update;
  if current_status in ('pending','shortlisted') and next_status in ('interviewing','rejected')
    and not exists(select 1 from public.candidate_assessments where application_id = target_application_id and status = 'reviewed') then
    select * into open_assessment from public.candidate_assessments
      where application_id = target_application_id and status = 'pending';
    if found and next_status = 'rejected' then
      if open_assessment.due_at is not null and now() <= open_assessment.due_at then
        raise exception 'The candidate has until % (Philippine time) to respond. Wait for the deadline or extend it before declining.',
          to_char(open_assessment.due_at at time zone 'Asia/Manila', 'Mon FMDD, YYYY "at" FMHH12:MI AM') using errcode = '22023';
      end if;
      -- Past the deadline with nothing submitted: the employer may decline.
    else
      raise exception 'Review the submitted assessment before making this decision.' using errcode = '22023';
    end if;
  end if;
  if current_status in ('hired', 'rejected', 'withdrawn') then
    raise exception 'This application is closed and cannot change stage.' using errcode = '22023';
  end if;
  update public.job_applications
    set status = next_status,
        rejection_reason = case when next_status = 'rejected' then btrim(reason) else rejection_reason end,
        updated_at = now()
    where id = target_application_id
    returning * into updated;
  return updated;
end;
$$;

revoke all on function public.set_application_stage(uuid, text, text) from public, anon;
grant execute on function public.set_application_stage(uuid, text, text) to authenticated;

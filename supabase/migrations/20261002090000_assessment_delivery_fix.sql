-- Candidate Assessments were not reaching candidates in two cases:
--
-- 1. Rubrics saved before assessments existed have criteria with an empty
--    question (the earlier backfill only copied prompts[1] when it existed).
--    send_candidate_assessment refused those rubrics, so nothing was sent.
--    The question now falls back to the first prompt, then to a question
--    built from the criterion name, instead of failing.
-- 2. Applicants moved to Interviewing before assessments existed could never
--    receive one: sending was limited to Shortlisted. Interviewing applicants
--    without an assessment can now be sent one too.
--
-- The frontend also sends the assessment automatically when an applicant is
-- shortlisted on a job with a rubric, so employers no longer have to find the
-- separate Send Assessment button.

create or replace function public.send_candidate_assessment(target_application_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  target_job uuid;
  target_rubric uuid;
  target_candidate uuid;
  target_employer uuid;
  target_title text;
  assessment uuid;
begin
  target_job := public.owned_job_post_for_application(target_application_id);
  if target_job is null then raise exception 'This application does not belong to your employer account.' using errcode = '42501'; end if;
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
  insert into public.candidate_assessments(application_id, candidate_user_id, job_post_id, employer_id, rubric_id)
    values(target_application_id, target_candidate, target_job, target_employer, target_rubric) returning id into assessment;
  insert into public.assessment_criterion_snapshots(assessment_id, source_criterion_id, name, description, question, is_required, weight, position)
    select assessment, id, name, coalesce(description, ''),
      coalesce(nullif(btrim(question), ''), nullif(btrim(prompts[1]), ''),
        'Tell us about your experience with ' || name || '. What did you do and what was the result?'),
      is_required, weight, position
    from public.evaluation_criteria where rubric_id = target_rubric;
  insert into public.candidate_notifications(recipient_user_id, event_type, application_id, event_version, title, message)
    values(target_candidate, 'candidate_assessment', target_application_id, assessment::text, 'Candidate Assessment received',
      'You have received a Candidate Assessment for ' || coalesce(target_title, 'your application') || '.')
    on conflict do nothing;
  insert into public.employer_review_audit_log(application_id, job_post_id, actor_user_id, event_type, details)
    values(target_application_id, target_job, auth.uid(), 'assessment_sent', jsonb_build_object('assessment_id', assessment));
  return assessment;
end $$;

revoke all on function public.send_candidate_assessment(uuid) from public, anon;
grant execute on function public.send_candidate_assessment(uuid) to authenticated;

-- Fill the empty questions on existing criteria the same way, so the rubric
-- editor and scorecards show the question candidates now receive.
update public.evaluation_criteria
  set question = coalesce(nullif(btrim(prompts[1]), ''),
    'Tell us about your experience with ' || name || '. What did you do and what was the result?')
  where btrim(question) = '';

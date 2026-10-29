-- Records when a reviewer opens a link a candidate put in an assessment answer,
-- so the team can see which links were actually looked at. It records the
-- click, not what the reviewer concluded. Safe to re-run.
--
-- The constraint lists every event type used so far, including ones from
-- migrations that may not be applied yet, so applying this never removes an
-- allowed value.
alter table public.employer_review_audit_log drop constraint if exists employer_review_audit_log_event_type_check;
alter table public.employer_review_audit_log add constraint employer_review_audit_log_event_type_check check
  (event_type in ('stage_changed','scorecard_saved','scorecard_submitted','rubric_saved','rubric_versioned',
    'assessment_sent','assessment_submitted','scorecard_reviewed','candidate_moved_to_interviewing','candidate_declined',
    'assessment_deadline_extended','ai_review_draft_generated','ai_review_draft_approved','assessment_link_opened'));

create or replace function public.log_assessment_link_opened(target_assessment_id uuid, opened_url text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.candidate_assessments%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication is required.' using errcode = '28000'; end if;
  select * into a from public.candidate_assessments where id = target_assessment_id;
  if not found or not public.employer_owns_job_post(a.job_post_id) then
    raise exception 'This assessment does not belong to your employer account.' using errcode = '42501';
  end if;
  if a.status not in ('submitted', 'reviewed') then
    raise exception 'The candidate has not submitted this assessment.' using errcode = '22023';
  end if;
  if opened_url is null or length(opened_url) > 500 or opened_url !~* '^https?://' then
    raise exception 'Only web links can be recorded.' using errcode = '22023';
  end if;
  -- Only a link that is really in the candidate's answers is recorded.
  if not exists (
    select 1 from public.candidate_assessment_responses
    where assessment_id = a.id and position(opened_url in response_text) > 0
  ) then
    raise exception 'That link is not in this candidate''s answers.' using errcode = '22023';
  end if;
  insert into public.employer_review_audit_log (application_id, job_post_id, actor_user_id, event_type, details)
    values (a.application_id, a.job_post_id, auth.uid(), 'assessment_link_opened',
      jsonb_build_object('assessment_id', a.id, 'url', opened_url));
end;
$$;

revoke all on function public.log_assessment_link_opened(uuid, text) from public, anon;
grant execute on function public.log_assessment_link_opened(uuid, text) to authenticated, service_role;

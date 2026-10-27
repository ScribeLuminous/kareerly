-- AI-drafted assessment reviews. The backend drafts ratings for a submitted
-- Candidate Assessment and stores the draft here; it never becomes a
-- scorecard on its own. A reviewer edits the draft in the normal scorecard
-- form and submits it, and only then is the draft marked approved. The draft,
-- who approved it and when stay on record.

create table if not exists public.assessment_ai_drafts (
  assessment_id uuid primary key references public.candidate_assessments(id) on delete cascade,
  job_post_id uuid not null references public.employer_job_posts(id) on delete cascade,
  generated_by uuid references auth.users(id) on delete set null,
  model text not null default '',
  -- [{criterion_id, rating (1-4 or null), evidence}]
  ratings jsonb not null default '[]'::jsonb check (jsonb_typeof(ratings) = 'array'),
  summary text not null default '' check (length(summary) <= 4000),
  -- Links found in the candidate's answers. They are listed for the reviewer;
  -- the drafting model does not open them.
  links jsonb not null default '[]'::jsonb check (jsonb_typeof(links) = 'array'),
  generated_at timestamptz not null default now(),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz
);

alter table public.assessment_ai_drafts enable row level security;

drop policy if exists "Employers read own assessment drafts" on public.assessment_ai_drafts;
create policy "Employers read own assessment drafts" on public.assessment_ai_drafts for select to authenticated
  using (public.employer_owns_job_post(job_post_id));

-- Drafts are written by the backend with the service role only.
revoke all on public.assessment_ai_drafts from anon, authenticated;
grant select on public.assessment_ai_drafts to authenticated;
grant all on public.assessment_ai_drafts to service_role;

alter table public.employer_review_audit_log drop constraint if exists employer_review_audit_log_event_type_check;
alter table public.employer_review_audit_log add constraint employer_review_audit_log_event_type_check check
  (event_type in ('stage_changed','scorecard_saved','scorecard_submitted','rubric_saved','rubric_versioned',
    'assessment_sent','assessment_submitted','scorecard_reviewed','candidate_moved_to_interviewing','candidate_declined',
    'ai_review_draft_generated','ai_review_draft_approved'));

-- Called after a reviewer submits their scorecard on an assessment that was
-- seeded from an AI draft. It records that a person reviewed and approved it,
-- and refuses unless the caller has really submitted a scorecard.
create or replace function public.approve_assessment_ai_draft(target_assessment_id uuid)
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
  if not exists (
    select 1 from public.evaluation_scorecards
    where application_id = a.application_id and reviewer_user_id = auth.uid() and status = 'submitted'
  ) then
    raise exception 'Submit your scorecard before approving the AI draft.' using errcode = '22023';
  end if;
  update public.assessment_ai_drafts
    set approved_by = auth.uid(), approved_at = now()
    where assessment_id = a.id and approved_at is null;
  if found then
    insert into public.employer_review_audit_log (application_id, job_post_id, actor_user_id, event_type, details)
      values (a.application_id, a.job_post_id, auth.uid(), 'ai_review_draft_approved', jsonb_build_object('assessment_id', a.id));
  end if;
end;
$$;

revoke all on function public.approve_assessment_ai_draft(uuid) from public, anon;
grant execute on function public.approve_assessment_ai_draft(uuid) to authenticated, service_role;

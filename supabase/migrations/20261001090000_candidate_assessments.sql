-- Candidate answers are separate from employer ratings. A sent assessment owns
-- immutable copies of the rubric criteria even if the job rubric changes.
-- The existing recipient notification table also serves employer users for this event.
grant select, update on public.candidate_notifications to authenticated;

alter table public.evaluation_criteria add column if not exists question text not null default '';
alter table public.evaluation_criteria add column if not exists created_at timestamptz not null default now();
alter table public.evaluation_criteria add column if not exists updated_at timestamptz not null default now();
update public.evaluation_criteria set question = prompts[1] where btrim(question) = '' and array_length(prompts, 1) > 0;

create table public.candidate_assessments (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null unique references public.job_applications(id) on delete cascade,
  candidate_user_id uuid not null references auth.users(id) on delete cascade,
  job_post_id uuid not null references public.employer_job_posts(id) on delete cascade,
  employer_id uuid not null references public.employer_profiles(id) on delete cascade,
  rubric_id uuid not null references public.evaluation_rubrics(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending','submitted','reviewed')),
  sent_at timestamptz not null default now(),
  submitted_at timestamptz,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index candidate_assessments_job_idx on public.candidate_assessments(job_post_id, status);

create table public.assessment_criterion_snapshots (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.candidate_assessments(id) on delete cascade,
  source_criterion_id uuid not null references public.evaluation_criteria(id) on delete restrict,
  name text not null,
  description text not null,
  question text not null,
  is_required boolean not null,
  weight integer not null check (weight between 1 and 5),
  position integer not null,
  unique(assessment_id, source_criterion_id),
  unique(assessment_id, id)
);
create index assessment_criterion_snapshots_order_idx on public.assessment_criterion_snapshots(assessment_id, position);

create table public.candidate_assessment_responses (
  assessment_id uuid not null references public.candidate_assessments(id) on delete cascade,
  criterion_snapshot_id uuid not null,
  response_text text not null default '' check (length(response_text) <= 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(assessment_id, criterion_snapshot_id),
  foreign key(assessment_id, criterion_snapshot_id) references public.assessment_criterion_snapshots(assessment_id, id) on delete cascade
);

alter table public.candidate_assessments enable row level security;
alter table public.assessment_criterion_snapshots enable row level security;
alter table public.candidate_assessment_responses enable row level security;
create policy "Participants read assessments" on public.candidate_assessments for select to authenticated
  using (candidate_user_id = auth.uid() or public.employer_owns_job_post(job_post_id));
create policy "Participants read assessment snapshots" on public.assessment_criterion_snapshots for select to authenticated
  using (exists (select 1 from public.candidate_assessments a where a.id = assessment_id));
create policy "Participants read candidate responses" on public.candidate_assessment_responses for select to authenticated
  using (exists (select 1 from public.candidate_assessments a where a.id = assessment_id));
grant select on public.candidate_assessments, public.assessment_criterion_snapshots, public.candidate_assessment_responses to authenticated;
revoke insert, update, delete on public.candidate_assessments, public.assessment_criterion_snapshots, public.candidate_assessment_responses from anon, authenticated;

alter table public.employer_review_audit_log drop constraint if exists employer_review_audit_log_event_type_check;
alter table public.employer_review_audit_log add constraint employer_review_audit_log_event_type_check check
  (event_type in ('stage_changed','scorecard_saved','scorecard_submitted','rubric_saved','rubric_versioned',
    'assessment_sent','assessment_submitted','scorecard_reviewed','candidate_moved_to_interviewing','candidate_declined'));

create function public.send_candidate_assessment(target_application_id uuid)
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
    where id = target_application_id and lower(status) = 'shortlisted' for update;
  if target_candidate is null then raise exception 'Only shortlisted candidates can be sent an assessment.' using errcode = '22023'; end if;
  if exists(select 1 from public.candidate_assessments where application_id = target_application_id) then
    raise exception 'An assessment was already sent to this candidate.' using errcode = '23505';
  end if;
  select id into target_rubric from public.evaluation_rubrics where job_post_id = target_job order by version desc limit 1;
  if target_rubric is null or not exists(select 1 from public.evaluation_criteria where rubric_id = target_rubric) then
    raise exception 'Configure an assessment for this job first.' using errcode = '22023';
  end if;
  if exists(select 1 from public.evaluation_criteria where rubric_id = target_rubric and btrim(question) = '') then
    raise exception 'Every assessment criterion needs a question.' using errcode = '22023';
  end if;
  select employer_id into target_employer from public.employer_job_posts where id = target_job;
  insert into public.candidate_assessments(application_id, candidate_user_id, job_post_id, employer_id, rubric_id)
    values(target_application_id, target_candidate, target_job, target_employer, target_rubric) returning id into assessment;
  insert into public.assessment_criterion_snapshots(assessment_id, source_criterion_id, name, description, question, is_required, weight, position)
    select assessment, id, name, description, question, is_required, weight, position
    from public.evaluation_criteria where rubric_id = target_rubric;
  insert into public.candidate_notifications(recipient_user_id, event_type, application_id, event_version, title, message)
    values(target_candidate, 'candidate_assessment', target_application_id, assessment::text, 'Candidate Assessment received',
      'You have received a Candidate Assessment for ' || coalesce(target_title, 'your application') || '.')
    on conflict do nothing;
  insert into public.employer_review_audit_log(application_id, job_post_id, actor_user_id, event_type, details)
    values(target_application_id, target_job, auth.uid(), 'assessment_sent', jsonb_build_object('assessment_id', assessment));
  return assessment;
end $$;

create function public.save_candidate_assessment(target_assessment_id uuid, answers jsonb, submit boolean default false)
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

grant execute on function public.send_candidate_assessment(uuid) to authenticated;
grant execute on function public.save_candidate_assessment(uuid, jsonb, boolean) to authenticated;
revoke all on function public.send_candidate_assessment(uuid) from public, anon;
revoke all on function public.save_candidate_assessment(uuid, jsonb, boolean) from public, anon;

-- Extend existing versioning, scorecard and stage functions without changing historical rows.
create or replace function public.save_evaluation_rubric(target_job_post_id uuid, criteria jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_employer uuid;
  current_rubric public.evaluation_rubrics%rowtype;
  target_rubric uuid;
  item jsonb;
  item_index integer := 0;
  in_use boolean := false;
  has_rubric boolean := false;
begin
  if auth.uid() is null then raise exception 'Authentication is required.' using errcode = '28000'; end if;
  select jobs.employer_id into owner_employer
  from public.employer_job_posts jobs
  join public.employer_profiles employers on employers.id = jobs.employer_id
  where jobs.id = target_job_post_id and employers.user_id = auth.uid();
  if owner_employer is null then raise exception 'This job does not belong to your employer account.' using errcode = '42501'; end if;

  if criteria is null or jsonb_typeof(criteria) <> 'array' or jsonb_array_length(criteria) = 0 then
    raise exception 'Add at least one criterion.' using errcode = '22023';
  end if;
  if jsonb_array_length(criteria) > 12 then raise exception 'Use at most 12 criteria.' using errcode = '22023'; end if;
  for item in select value from jsonb_array_elements(criteria) loop
    if length(btrim(coalesce(item->>'name', ''))) = 0 then raise exception 'Every criterion needs a name.' using errcode = '22023'; end if;
    if length(btrim(coalesce(item->>'question', item->'prompts'->>0, ''))) = 0 then raise exception 'Every criterion needs an assessment question.' using errcode = '22023'; end if;
    if length(coalesce(item->>'question', item->'prompts'->>0, '')) > 1000 then raise exception 'Questions must be at most 1000 characters.' using errcode = '22023'; end if;
    if coalesce((item->>'weight')::integer, 1) not between 1 and 5 then raise exception 'Weights must be between 1 and 5.' using errcode = '22023'; end if;
    if jsonb_typeof(coalesce(item->'anchors', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(item->'anchors', '[]'::jsonb)) not in (0, 4) then
      raise exception 'Give four rating anchors (1 to 4) or none.' using errcode = '22023';
    end if;
  end loop;

  select * into current_rubric from public.evaluation_rubrics
  where job_post_id = target_job_post_id order by version desc limit 1
  for update;
  has_rubric := found;

  if has_rubric then
    select exists (select 1 from public.evaluation_scorecards where rubric_id = current_rubric.id)
      or exists (select 1 from public.candidate_assessments where rubric_id = current_rubric.id) into in_use;
  end if;

  if has_rubric and not in_use then
    target_rubric := current_rubric.id;
    delete from public.evaluation_criteria where rubric_id = target_rubric;
    insert into public.employer_review_audit_log (job_post_id, actor_user_id, event_type, details)
      values (target_job_post_id, auth.uid(), 'rubric_saved', jsonb_build_object('rubric_id', target_rubric, 'version', current_rubric.version, 'criteria', criteria));
  else
    if current_rubric.id is not null then
      update public.evaluation_rubrics set superseded_at = now() where id = current_rubric.id;
    end if;
    insert into public.evaluation_rubrics (job_post_id, employer_id, version, created_by)
      values (target_job_post_id, owner_employer, coalesce(current_rubric.version, 0) + 1, auth.uid())
      returning id into target_rubric;
    insert into public.employer_review_audit_log (job_post_id, actor_user_id, event_type, details)
      values (target_job_post_id, auth.uid(), case when current_rubric.id is null then 'rubric_saved' else 'rubric_versioned' end,
        jsonb_build_object('rubric_id', target_rubric, 'version', coalesce(current_rubric.version, 0) + 1,
          'previous_rubric_id', current_rubric.id, 'criteria', criteria));
  end if;

  for item in select value from jsonb_array_elements(criteria) loop
    insert into public.evaluation_criteria (rubric_id, position, name, description, weight, is_required, anchors, prompts, question)
    values (
      target_rubric,
      item_index,
      btrim(item->>'name'),
      coalesce(item->>'description', ''),
      coalesce((item->>'weight')::integer, 1),
      coalesce((item->>'is_required')::boolean, true),
      coalesce(item->'anchors', '[]'::jsonb),
      coalesce(array(select btrim(p) from jsonb_array_elements_text(coalesce(item->'prompts', '[]'::jsonb)) p where btrim(p) <> ''), '{}'),
      btrim(coalesce(item->>'question', item->'prompts'->>0, ''))
    );
    item_index := item_index + 1;
  end loop;

  return target_rubric;
end;
$$;


create or replace function public.save_evaluation_scorecard(
  target_application_id uuid,
  target_rubric_id uuid,
  ratings jsonb,
  summary text default '',
  submit boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  job_post uuid;
  card public.evaluation_scorecards%rowtype;
  was_new boolean := false;
  before_ratings jsonb;
  item jsonb;
  rating_value smallint;
begin
  if auth.uid() is null then raise exception 'Authentication is required.' using errcode = '28000'; end if;
  job_post := public.owned_job_post_for_application(target_application_id);
  if job_post is null then raise exception 'This application does not belong to your employer account.' using errcode = '42501'; end if;
  if not exists (select 1 from public.evaluation_rubrics where id = target_rubric_id and job_post_id = job_post) then
    raise exception 'This rubric does not belong to the application''s job.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.evaluation_scorecards where application_id = target_application_id and rubric_id = target_rubric_id and reviewer_user_id = auth.uid())
    and not exists (select 1 from public.candidate_assessments where application_id = target_application_id and rubric_id = target_rubric_id and status in ('submitted','reviewed')) then
    raise exception 'A submitted candidate assessment is required before starting a scorecard.' using errcode = '22023';
  end if;
  if ratings is null or jsonb_typeof(ratings) <> 'array' then raise exception 'Ratings must be a list.' using errcode = '22023'; end if;

  select * into card from public.evaluation_scorecards
  where application_id = target_application_id and rubric_id = target_rubric_id and reviewer_user_id = auth.uid()
  for update;

  if not found then
    -- New scorecards always use the job's latest rubric version.
    if exists (select 1 from public.evaluation_rubrics where id = target_rubric_id and superseded_at is not null)
      and not exists (select 1 from public.candidate_assessments where application_id = target_application_id and rubric_id = target_rubric_id) then
      raise exception 'This rubric version has been replaced. Start a scorecard on the current version.' using errcode = '22023';
    end if;
    insert into public.evaluation_scorecards (application_id, rubric_id, reviewer_user_id)
      values (target_application_id, target_rubric_id, auth.uid())
      returning * into card;
    was_new := true;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('criterion_id', criterion_id, 'rating', rating, 'evidence', evidence) order by criterion_id), '[]'::jsonb)
    into before_ratings from public.evaluation_ratings where scorecard_id = card.id;

  for item in select value from jsonb_array_elements(ratings) loop
    if not exists (select 1 from public.evaluation_criteria where id = (item->>'criterion_id')::uuid and rubric_id = target_rubric_id) then
      raise exception 'A rated criterion is not part of this rubric version.' using errcode = '22023';
    end if;
    rating_value := nullif(item->>'rating', '')::smallint;
    if rating_value is not null and rating_value not between 1 and 4 then raise exception 'Ratings must be between 1 and 4.' using errcode = '22023'; end if;
    insert into public.evaluation_ratings (scorecard_id, criterion_id, rating, evidence, updated_at)
      values (card.id, (item->>'criterion_id')::uuid, rating_value, left(coalesce(item->>'evidence', ''), 2000), now())
      on conflict (scorecard_id, criterion_id) do update
        set rating = excluded.rating, evidence = excluded.evidence, updated_at = now();
  end loop;

  update public.evaluation_scorecards
    set summary_notes = left(coalesce(summary, ''), 4000),
        status = case when submit then 'submitted' else status end,
        submitted_at = case when submit and submitted_at is null then now() else submitted_at end,
        updated_at = now()
    where id = card.id;

  insert into public.employer_review_audit_log (application_id, job_post_id, actor_user_id, event_type, details)
  values (
    target_application_id, job_post, auth.uid(),
    case when submit and card.status = 'draft' then 'scorecard_submitted' else 'scorecard_saved' end,
    jsonb_build_object('scorecard_id', card.id, 'rubric_id', target_rubric_id, 'created', was_new,
      'previous_status', card.status, 'before', before_ratings, 'after', ratings)
  );

  if submit then
    update public.candidate_assessments set status = 'reviewed', reviewed_at = coalesce(reviewed_at, now()), updated_at = now()
      where application_id = target_application_id and rubric_id = target_rubric_id and status in ('submitted','reviewed');
    insert into public.employer_review_audit_log(application_id, job_post_id, actor_user_id, event_type, details)
      values(target_application_id, job_post, auth.uid(), 'scorecard_reviewed', jsonb_build_object('scorecard_id', card.id));
  end if;
  return card.id;
end;
$$;


create or replace function public.set_application_stage(target_application_id uuid, next_status text, reason text default null)
returns public.job_applications
language plpgsql
security definer
set search_path = public
as $$
declare
  current_status text;
  updated public.job_applications%rowtype;
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
    raise exception 'Review the submitted assessment before making this decision.' using errcode = '22023';
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

revoke all on function public.set_application_stage(uuid, text, text) from public;
grant execute on function public.set_application_stage(uuid, text, text) to authenticated;

-- Keep existing stage audit and add named decision events for the activity view.
create or replace function public.log_application_stage_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    insert into public.employer_review_audit_log (application_id, job_post_id, actor_user_id, event_type, details)
    values (
      new.id,
      (select jobs.id from public.employer_job_posts jobs where jobs.job_id = new.job_id and new.job_source = 'employer' limit 1),
      auth.uid(),
      'stage_changed',
      jsonb_build_object('from', old.status, 'to', new.status, 'rejection_reason', new.rejection_reason,
        'actor_is_candidate', auth.uid() is not null and auth.uid() = new.user_id)
    );
    if new.status in ('interviewing','rejected') then
      insert into public.employer_review_audit_log(application_id, job_post_id, actor_user_id, event_type, details)
      values(new.id, (select jobs.id from public.employer_job_posts jobs where jobs.job_id = new.job_id and new.job_source = 'employer' limit 1),
        auth.uid(), case when new.status = 'interviewing' then 'candidate_moved_to_interviewing' else 'candidate_declined' end,
        jsonb_build_object('from', old.status, 'to', new.status));
    end if;
  end if;
  return new;
end;
$$;

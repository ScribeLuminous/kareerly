-- Structured, job-specific applicant evaluation for employers.
--
-- Adds, per employer job post, a versioned evaluation rubric (criteria with
-- descriptions, rating anchors, relative weights, required flags and linked
-- interview prompts), reviewer scorecards with per-criterion ratings, evidence
-- and explicit "not assessed" values, and an audit log for scorecard edits,
-- rubric changes and hiring-stage changes.
--
-- The existing application-time profile match (job_applications.match_score,
-- matched_skills, missing_skills) is left untouched and stays a separate
-- measure. Nothing here changes an application's status; decisions stay with
-- people.
--
-- Reviewed evaluation formula (see public.evaluation_version_result):
--   ratings use a 1-4 anchored scale; "not assessed" is stored as no rating.
--   For one rubric version and one application, using submitted scorecards:
--     mean_c   = average rating for criterion c across reviewers who rated it
--     assessed = criteria with at least one rating
--     coverage = sum(weight of assessed criteria) / sum(weight of all criteria)
--     score    = 100 * sum(w_c * (mean_c - 1) / 3) / sum(w_c), over assessed c
--   The score is published (non-null) only when every required criterion is
--   assessed. Unassessed optional criteria are left out of the denominator,
--   never counted as zero. Results are computed per rubric version and are
--   never recalculated with another version's weights.
--
-- Safe to re-run.

-- ---------- Tables ----------

create table if not exists public.evaluation_rubrics (
  id uuid primary key default gen_random_uuid(),
  job_post_id uuid not null references public.employer_job_posts(id) on delete cascade,
  employer_id uuid not null references public.employer_profiles(id) on delete cascade,
  version integer not null check (version >= 1),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  -- Set when a newer version replaces this one; old versions stay readable.
  superseded_at timestamptz,
  unique (job_post_id, version)
);

create index if not exists evaluation_rubrics_job_idx on public.evaluation_rubrics (job_post_id, version desc);

create table if not exists public.evaluation_criteria (
  id uuid primary key default gen_random_uuid(),
  rubric_id uuid not null references public.evaluation_rubrics(id) on delete cascade,
  position integer not null default 0,
  name text not null check (length(btrim(name)) between 1 and 120),
  description text not null default '' check (length(description) <= 1000),
  weight integer not null default 1 check (weight between 1 and 5),
  is_required boolean not null default true,
  -- Four short anchor texts, lowest (1) to highest (4).
  anchors jsonb not null default '[]'::jsonb check (jsonb_typeof(anchors) = 'array'),
  -- Interview questions or prompts linked to this criterion.
  prompts text[] not null default '{}'
);

create index if not exists evaluation_criteria_rubric_idx on public.evaluation_criteria (rubric_id, position);

create table if not exists public.evaluation_scorecards (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.job_applications(id) on delete cascade,
  rubric_id uuid not null references public.evaluation_rubrics(id) on delete restrict,
  reviewer_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft', 'submitted')),
  summary_notes text not null default '' check (length(summary_notes) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz,
  unique (application_id, rubric_id, reviewer_user_id)
);

create index if not exists evaluation_scorecards_application_idx on public.evaluation_scorecards (application_id);

create table if not exists public.evaluation_ratings (
  scorecard_id uuid not null references public.evaluation_scorecards(id) on delete cascade,
  criterion_id uuid not null references public.evaluation_criteria(id) on delete restrict,
  -- null rating means "not assessed", which is never read as a low rating.
  rating smallint check (rating between 1 and 4),
  evidence text not null default '' check (length(evidence) <= 2000),
  updated_at timestamptz not null default now(),
  primary key (scorecard_id, criterion_id)
);

create table if not exists public.employer_review_audit_log (
  id bigint generated always as identity primary key,
  application_id uuid references public.job_applications(id) on delete cascade,
  job_post_id uuid references public.employer_job_posts(id) on delete cascade,
  actor_user_id uuid,
  event_type text not null check (event_type in ('stage_changed', 'scorecard_saved', 'scorecard_submitted', 'rubric_saved', 'rubric_versioned')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists employer_review_audit_application_idx on public.employer_review_audit_log (application_id, created_at desc);
create index if not exists employer_review_audit_job_idx on public.employer_review_audit_log (job_post_id, created_at desc);

-- ---------- Ownership helpers ----------

create or replace function public.employer_owns_job_post(target_job_post_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.employer_job_posts jobs
    join public.employer_profiles employers on employers.id = jobs.employer_id
    where jobs.id = target_job_post_id
      and employers.user_id = auth.uid()
  );
$$;

-- The employer job post an application belongs to, when the caller owns it.
create or replace function public.owned_job_post_for_application(target_application_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select jobs.id
  from public.job_applications applications
  join public.employer_job_posts jobs on jobs.job_id = applications.job_id
  join public.employer_profiles employers on employers.id = jobs.employer_id
  where applications.id = target_application_id
    and applications.job_source = 'employer'
    and employers.user_id = auth.uid()
  limit 1;
$$;

revoke all on function public.employer_owns_job_post(uuid) from public;
revoke all on function public.owned_job_post_for_application(uuid) from public;
grant execute on function public.employer_owns_job_post(uuid) to authenticated;
grant execute on function public.owned_job_post_for_application(uuid) to authenticated;

-- ---------- Row-level security: read own, write through functions ----------

alter table public.evaluation_rubrics enable row level security;
alter table public.evaluation_criteria enable row level security;
alter table public.evaluation_scorecards enable row level security;
alter table public.evaluation_ratings enable row level security;
alter table public.employer_review_audit_log enable row level security;

drop policy if exists "Employers read own rubrics" on public.evaluation_rubrics;
create policy "Employers read own rubrics" on public.evaluation_rubrics
  for select using (public.employer_owns_job_post(job_post_id));

drop policy if exists "Employers read own rubric criteria" on public.evaluation_criteria;
create policy "Employers read own rubric criteria" on public.evaluation_criteria
  for select using (exists (
    select 1 from public.evaluation_rubrics rubrics
    where rubrics.id = evaluation_criteria.rubric_id
      and public.employer_owns_job_post(rubrics.job_post_id)
  ));

drop policy if exists "Employers read scorecards on own jobs" on public.evaluation_scorecards;
create policy "Employers read scorecards on own jobs" on public.evaluation_scorecards
  for select using (public.owned_job_post_for_application(application_id) is not null);

drop policy if exists "Employers read ratings on own jobs" on public.evaluation_ratings;
create policy "Employers read ratings on own jobs" on public.evaluation_ratings
  for select using (exists (
    select 1 from public.evaluation_scorecards cards
    where cards.id = evaluation_ratings.scorecard_id
      and public.owned_job_post_for_application(cards.application_id) is not null
  ));

drop policy if exists "Employers read own review audit log" on public.employer_review_audit_log;
create policy "Employers read own review audit log" on public.employer_review_audit_log
  for select using (job_post_id is not null and public.employer_owns_job_post(job_post_id));

-- Writes go through the security-definer functions below, which enforce
-- ownership, versioning and auditing together.
revoke insert, update, delete on public.evaluation_rubrics from anon, authenticated;
revoke insert, update, delete on public.evaluation_criteria from anon, authenticated;
revoke insert, update, delete on public.evaluation_scorecards from anon, authenticated;
revoke insert, update, delete on public.evaluation_ratings from anon, authenticated;
revoke insert, update, delete on public.employer_review_audit_log from anon, authenticated;
grant select on public.evaluation_rubrics, public.evaluation_criteria, public.evaluation_scorecards,
  public.evaluation_ratings, public.employer_review_audit_log to authenticated;

-- ---------- Rubric save with versioning ----------

-- criteria: [{name, description, weight, is_required, anchors: [4 texts], prompts: [texts]}]
-- Edits the latest version in place while no scorecard uses it; once any
-- scorecard exists, saves a new version and keeps the old one intact.
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
    select exists (select 1 from public.evaluation_scorecards where rubric_id = current_rubric.id) into in_use;
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
    insert into public.evaluation_criteria (rubric_id, position, name, description, weight, is_required, anchors, prompts)
    values (
      target_rubric,
      item_index,
      btrim(item->>'name'),
      coalesce(item->>'description', ''),
      coalesce((item->>'weight')::integer, 1),
      coalesce((item->>'is_required')::boolean, true),
      coalesce(item->'anchors', '[]'::jsonb),
      coalesce(array(select btrim(p) from jsonb_array_elements_text(coalesce(item->'prompts', '[]'::jsonb)) p where btrim(p) <> ''), '{}')
    );
    item_index := item_index + 1;
  end loop;

  return target_rubric;
end;
$$;

-- ---------- Scorecard save ----------

-- ratings: [{criterion_id, rating (1-4 or null for not assessed), evidence}]
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
  if ratings is null or jsonb_typeof(ratings) <> 'array' then raise exception 'Ratings must be a list.' using errcode = '22023'; end if;

  select * into card from public.evaluation_scorecards
  where application_id = target_application_id and rubric_id = target_rubric_id and reviewer_user_id = auth.uid()
  for update;

  if not found then
    -- New scorecards always use the job's latest rubric version.
    if exists (select 1 from public.evaluation_rubrics where id = target_rubric_id and superseded_at is not null) then
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

  return card.id;
end;
$$;

-- ---------- Deterministic result per rubric version ----------

-- Pure calculation over one application and one rubric version. Callers
-- must check ownership first; the public entry points below do.
create or replace function public.evaluation_version_result(target_application_id uuid, target_rubric_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with submitted as (
    select id from public.evaluation_scorecards
    where application_id = target_application_id and rubric_id = target_rubric_id and status = 'submitted'
  ),
  per_criterion as (
    select
      criteria.id, criteria.name, criteria.position, criteria.weight, criteria.is_required,
      count(ratings.rating) as rating_count,
      count(ratings.scorecard_id) filter (where ratings.rating is null) as not_assessed_count,
      avg(ratings.rating)::numeric as mean_rating,
      max(ratings.rating) - min(ratings.rating) as spread
    from public.evaluation_criteria criteria
    left join public.evaluation_ratings ratings
      on ratings.criterion_id = criteria.id and ratings.scorecard_id in (select id from submitted)
    where criteria.rubric_id = target_rubric_id
    group by criteria.id
  ),
  totals as (
    select
      coalesce(sum(weight), 0) as total_weight,
      coalesce(sum(weight) filter (where rating_count > 0), 0) as assessed_weight,
      count(*) as criteria_count,
      count(*) filter (where rating_count > 0) as assessed_count,
      count(*) filter (where is_required) as required_count,
      count(*) filter (where is_required and rating_count > 0) as required_assessed,
      sum(weight * (mean_rating - 1) / 3) filter (where rating_count > 0) as weighted_points
    from per_criterion
  )
  select jsonb_build_object(
    'rubric_id', target_rubric_id,
    'rubric_version', (select version from public.evaluation_rubrics where id = target_rubric_id),
    'submitted_scorecards', (select count(*) from submitted),
    'criteria_count', totals.criteria_count,
    'assessed_count', totals.assessed_count,
    'required_count', totals.required_count,
    'required_assessed', totals.required_assessed,
    'coverage_percent', case when totals.total_weight > 0 then round(100.0 * totals.assessed_weight / totals.total_weight) else 0 end,
    'is_complete', totals.criteria_count > 0 and totals.required_assessed = totals.required_count and (select count(*) from submitted) > 0,
    -- Published only when every required criterion has at least one rating.
    'score', case
      when totals.criteria_count > 0 and totals.required_assessed = totals.required_count and totals.assessed_weight > 0
        then round(100 * totals.weighted_points / totals.assessed_weight)
      else null end,
    'criteria', coalesce((
      select jsonb_agg(jsonb_build_object(
        'criterion_id', id, 'name', name, 'weight', weight, 'is_required', is_required,
        'rating_count', rating_count, 'not_assessed_count', not_assessed_count,
        'mean_rating', round(mean_rating, 2), 'spread', spread
      ) order by position)
      from per_criterion
    ), '[]'::jsonb)
  )
  from totals;
$$;

revoke all on function public.evaluation_version_result(uuid, uuid) from public, anon, authenticated;

-- Results for one application, one entry per rubric version that has
-- scorecards, newest first. Plus the job's current rubric id.
create or replace function public.get_application_evaluation(target_application_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  job_post uuid;
begin
  job_post := public.owned_job_post_for_application(target_application_id);
  if job_post is null then raise exception 'This application does not belong to your employer account.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'application_id', target_application_id,
    'current_rubric_id', (select id from public.evaluation_rubrics where job_post_id = job_post order by version desc limit 1),
    'versions', coalesce((
      select jsonb_agg(public.evaluation_version_result(target_application_id, rubrics.id) order by rubrics.version desc)
      from public.evaluation_rubrics rubrics
      where rubrics.job_post_id = job_post
        and exists (select 1 from public.evaluation_scorecards cards where cards.rubric_id = rubrics.id and cards.application_id = target_application_id)
    ), '[]'::jsonb)
  );
end;
$$;

drop function if exists public.list_job_evaluation_summaries(uuid);

-- Summaries for every application to one job, on the job's current rubric
-- version only, so applicants are compared on the same criteria and weights.
create or replace function public.list_job_evaluation_summaries(target_job_post_id uuid)
returns table (application_id uuid, result jsonb, my_scorecard_status text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_rubric uuid;
begin
  if not public.employer_owns_job_post(target_job_post_id) then
    raise exception 'This job does not belong to your employer account.' using errcode = '42501';
  end if;
  select id into current_rubric from public.evaluation_rubrics where job_post_id = target_job_post_id order by version desc limit 1;
  if current_rubric is null then return; end if;
  return query
    select applications.id, public.evaluation_version_result(applications.id, current_rubric),
      (select cards.status from public.evaluation_scorecards cards
        where cards.application_id = applications.id and cards.rubric_id = current_rubric and cards.reviewer_user_id = auth.uid())
    from public.job_applications applications
    join public.employer_job_posts jobs on jobs.job_id = applications.job_id
    where jobs.id = target_job_post_id and applications.job_source = 'employer';
end;
$$;

revoke all on function public.save_evaluation_rubric(uuid, jsonb) from public;
revoke all on function public.save_evaluation_scorecard(uuid, uuid, jsonb, text, boolean) from public;
revoke all on function public.get_application_evaluation(uuid) from public;
revoke all on function public.list_job_evaluation_summaries(uuid) from public;
grant execute on function public.save_evaluation_rubric(uuid, jsonb) to authenticated;
grant execute on function public.save_evaluation_scorecard(uuid, uuid, jsonb, text, boolean) to authenticated;
grant execute on function public.get_application_evaluation(uuid) to authenticated;
grant execute on function public.list_job_evaluation_summaries(uuid) to authenticated;

-- ---------- Hiring-stage audit trail ----------

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
  end if;
  return new;
end;
$$;

drop trigger if exists job_applications_stage_audit on public.job_applications;
create trigger job_applications_stage_audit
  after update of status on public.job_applications
  for each row execute function public.log_application_stage_change();

-- Employer stage change as the signed-in employer, so the audit row records
-- who made the decision. Scores are never consulted here.
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

-- Every job assessment is kept in Assessment templates automatically, so
-- employers never have to save one by hand and can open the template a job
-- uses at any time.
--
-- Saving a job's assessment (save_job_assessment) links the job's rubric to:
--   1. an existing template with exactly the same questions, if there is one
--      (for example the template it was loaded from, unchanged); otherwise
--   2. the job's own template (source_job_post_id), updated to the new
--      questions; otherwise
--   3. a new template named "<job title> assessment".
-- Templates are still copied into each job, so changing a template never
-- changes an assessment that was already sent or scored.

alter table public.assessment_templates add column if not exists source_job_post_id uuid
  references public.employer_job_posts(id) on delete set null;
create index if not exists assessment_templates_source_job_post_idx
  on public.assessment_templates(source_job_post_id) where source_job_post_id is not null;

-- A rubric's questions in the same shape the app stores in assessment_templates.criteria.
create or replace function public.rubric_template_criteria(target_rubric_id uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'name', c.name,
      'description', coalesce(c.description, ''),
      'weight', c.weight,
      'is_required', c.is_required,
      'anchors', coalesce(c.anchors, '[]'::jsonb),
      'prompts', to_jsonb(coalesce(c.prompts, '{}'::text[])),
      'question', coalesce(c.question, '')
    ) order by c.position), '[]'::jsonb)
  from public.evaluation_criteria c
  where c.rubric_id = target_rubric_id;
$$;

-- Links a rubric to a template holding the same questions, creating or
-- updating the job's own template when needed. Internal: called only from the
-- functions below and this migration's backfill.
create or replace function public.link_rubric_to_template(target_rubric_id uuid)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  rubric public.evaluation_rubrics%rowtype;
  rubric_criteria jsonb;
  title text;
  found_template uuid;
  base_name text;
  candidate_name text;
  suffix integer := 1;
begin
  select * into rubric from public.evaluation_rubrics where id = target_rubric_id;
  if not found then return null; end if;
  rubric_criteria := public.rubric_template_criteria(rubric.id);
  if jsonb_array_length(rubric_criteria) = 0 then return null; end if;

  -- 1. A template with exactly these questions; prefer the job's own.
  select t.id into found_template from public.assessment_templates t
  where t.employer_id = rubric.employer_id and t.criteria = rubric_criteria
  order by (t.source_job_post_id is not distinct from rubric.job_post_id) desc, t.updated_at desc
  limit 1;

  -- 2. The job's own template, brought up to date.
  if found_template is null then
    select t.id into found_template from public.assessment_templates t
    where t.employer_id = rubric.employer_id and t.source_job_post_id = rubric.job_post_id
    order by t.updated_at desc
    limit 1;
    if found_template is not null then
      update public.assessment_templates set criteria = rubric_criteria, updated_at = now() where id = found_template;
    end if;
  end if;

  -- 3. A new template named after the job, numbered if the name is taken.
  if found_template is null then
    select coalesce(nullif(btrim(j.job_title), ''), 'Job') into title
    from public.employer_job_posts j where j.id = rubric.job_post_id;
    base_name := left(coalesce(title, 'Job'), 100) || ' assessment';
    candidate_name := base_name;
    while exists (select 1 from public.assessment_templates t
                  where t.employer_id = rubric.employer_id and lower(btrim(t.name)) = lower(btrim(candidate_name))) loop
      suffix := suffix + 1;
      candidate_name := base_name || ' (' || suffix || ')';
    end loop;
    insert into public.assessment_templates (employer_id, name, description, criteria, created_by, source_job_post_id)
      values (rubric.employer_id, candidate_name, left('Saved automatically from ' || coalesce(title, 'a job') || '.', 1000),
        rubric_criteria, coalesce(auth.uid(), rubric.created_by), rubric.job_post_id)
      returning id into found_template;
  end if;

  update public.evaluation_rubrics set template_id = found_template where id = rubric.id;
  return found_template;
end;
$$;

revoke all on function public.rubric_template_criteria(uuid) from public, anon, authenticated;
revoke all on function public.link_rubric_to_template(uuid) from public, anon, authenticated;

-- Saves a job's assessment (as save_evaluation_rubric does) and keeps it in
-- Assessment templates. Returns the rubric and template ids.
create or replace function public.save_job_assessment(target_job_post_id uuid, criteria jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  rubric uuid;
  template uuid;
begin
  -- save_evaluation_rubric checks sign-in and job ownership, and validates every criterion.
  rubric := public.save_evaluation_rubric(target_job_post_id, criteria);
  template := public.link_rubric_to_template(rubric);
  return jsonb_build_object('rubric_id', rubric, 'template_id', template);
end;
$$;

revoke all on function public.save_job_assessment(uuid, jsonb) from public, anon;
grant execute on function public.save_job_assessment(uuid, jsonb) to authenticated, service_role;

-- Jobs that already have an assessment but no template get one now.
do $$
declare
  latest record;
begin
  for latest in
    select distinct on (r.job_post_id) r.id, r.template_id
    from public.evaluation_rubrics r
    order by r.job_post_id, r.version desc
  loop
    if latest.template_id is null then
      perform public.link_rubric_to_template(latest.id);
    end if;
  end loop;
end $$;

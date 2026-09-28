-- Reusable Candidate Assessments. An employer saves a set of criteria and
-- questions once as a template and applies it to any of their jobs. Applying
-- goes through save_evaluation_rubric, so each job still gets its own
-- versioned rubric: editing a template later never changes an assessment that
-- was already sent or scored.

create table if not exists public.assessment_templates (
  id uuid primary key default gen_random_uuid(),
  employer_id uuid not null references public.employer_profiles(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  description text not null default '' check (length(description) <= 1000),
  criteria jsonb not null check (jsonb_typeof(criteria) = 'array' and jsonb_array_length(criteria) between 1 and 12),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists assessment_templates_employer_name_key
  on public.assessment_templates(employer_id, lower(btrim(name)));

alter table public.assessment_templates enable row level security;
drop policy if exists "Employers manage own assessment templates" on public.assessment_templates;
create policy "Employers manage own assessment templates" on public.assessment_templates for all to authenticated
  using (exists (select 1 from public.employer_profiles e where e.id = employer_id and e.user_id = auth.uid()))
  with check (exists (select 1 from public.employer_profiles e where e.id = employer_id and e.user_id = auth.uid()));
grant select, insert, update, delete on public.assessment_templates to authenticated;
revoke all on public.assessment_templates from anon;

-- Which template a rubric version came from, for "Uses template X" labels.
alter table public.evaluation_rubrics add column if not exists template_id uuid
  references public.assessment_templates(id) on delete set null;

-- Applies one template to several of the caller's jobs in one transaction.
-- Returns how many jobs received it; any job the caller doesn't own fails the
-- whole call, so nothing is half-applied.
create or replace function public.apply_assessment_template(target_template_id uuid, target_job_post_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  template public.assessment_templates%rowtype;
  job_post uuid;
  rubric uuid;
  applied integer := 0;
begin
  if auth.uid() is null then raise exception 'Authentication is required.' using errcode = '28000'; end if;
  select t.* into template from public.assessment_templates t
    join public.employer_profiles e on e.id = t.employer_id
    where t.id = target_template_id and e.user_id = auth.uid();
  if not found then raise exception 'This assessment template does not belong to your employer account.' using errcode = '42501'; end if;
  if target_job_post_ids is null or cardinality(target_job_post_ids) = 0 then
    raise exception 'Choose at least one job.' using errcode = '22023';
  end if;
  foreach job_post in array (select array_agg(distinct j) from unnest(target_job_post_ids) j) loop
    -- save_evaluation_rubric checks ownership and validates every criterion.
    rubric := public.save_evaluation_rubric(job_post, template.criteria);
    update public.evaluation_rubrics set template_id = template.id where id = rubric;
    applied := applied + 1;
  end loop;
  return applied;
end;
$$;

revoke all on function public.apply_assessment_template(uuid, uuid[]) from public, anon;
grant execute on function public.apply_assessment_template(uuid, uuid[]) to authenticated;

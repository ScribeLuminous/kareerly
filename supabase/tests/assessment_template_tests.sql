\set ON_ERROR_STOP on
create or replace function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid, ''), false);
  set role authenticated;
end $$;
create temp table template_ids(key text primary key, value uuid);
grant all on template_ids to authenticated;

insert into public.employer_job_posts (id, job_id, employer_id, job_title) values
  ('20000000-0000-0000-0000-000000000011', 'EMP-11', '10000000-0000-0000-0000-000000000001', 'Support Lead'),
  ('20000000-0000-0000-0000-000000000012', 'EMP-12', '10000000-0000-0000-0000-000000000001', 'Support Agent');

-- An employer saves a template and applies it to two jobs at once.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000e1');
with saved as (
  insert into public.assessment_templates (employer_id, name, criteria) values ('10000000-0000-0000-0000-000000000001', 'Support basics',
    '[{"name":"Customer Service","question":"Tell us about a hard customer.","weight":3,"is_required":true}]'::jsonb)
  returning id
) insert into template_ids select 'template', id from saved;
do $$ begin
  if public.apply_assessment_template((select value from template_ids where key = 'template'),
    array['20000000-0000-0000-0000-000000000011', '20000000-0000-0000-0000-000000000012']::uuid[]) <> 2 then raise exception 'template not applied to both jobs'; end if;
  if (select count(*) from public.evaluation_rubrics r join public.evaluation_criteria c on c.rubric_id = r.id
      where r.job_post_id in ('20000000-0000-0000-0000-000000000011', '20000000-0000-0000-0000-000000000012')
        and r.template_id = (select value from template_ids where key = 'template') and c.question = 'Tell us about a hard customer.') <> 2 then
    raise exception 'jobs did not get the template criteria';
  end if;
end $$;
-- Editing the template later leaves the jobs' rubrics as they were.
update public.assessment_templates set criteria = '[{"name":"Changed","question":"Changed?","weight":1,"is_required":true}]'::jsonb
  where id = (select value from template_ids where key = 'template');
do $$ begin
  if exists (select 1 from public.evaluation_criteria c join public.evaluation_rubrics r on r.id = c.rubric_id
      where r.job_post_id = '20000000-0000-0000-0000-000000000011' and c.name = 'Changed') then raise exception 'template edit changed a job rubric'; end if;
  -- A job the caller doesn't own fails the whole call.
  begin
    perform public.apply_assessment_template((select value from template_ids where key = 'template'),
      array['20000000-0000-0000-0000-000000000011', '20000000-0000-0000-0000-000000000002']::uuid[]);
    raise exception 'applied to another employer''s job';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- Another employer can't see, change or apply the template.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000e2');
do $$ begin
  if exists (select 1 from public.assessment_templates) then raise exception 'other employer read template'; end if;
  begin
    perform public.apply_assessment_template((select value from template_ids where key = 'template'), array['20000000-0000-0000-0000-000000000002']::uuid[]);
    raise exception 'other employer applied template';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.assessment_templates (employer_id, name, criteria) values ('10000000-0000-0000-0000-000000000001', 'Sneaky', '[{"name":"x"}]'::jsonb);
    raise exception 'other employer wrote template';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
\echo 'Assessment template checks passed.'

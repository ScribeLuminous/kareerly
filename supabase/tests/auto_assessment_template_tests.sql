\set ON_ERROR_STOP on
create or replace function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid, ''), false);
  set role authenticated;
end $$;
create temp table auto_ids(key text primary key, value uuid);
grant all on auto_ids to authenticated;

-- The backfill gave every job that already had an assessment a template.
do $$ begin
  if exists (select 1 from (select distinct on (job_post_id) template_id from public.evaluation_rubrics order by job_post_id, version desc) latest
      where latest.template_id is null) then
    raise exception 'a job assessment was left without a template';
  end if;
end $$;

insert into public.employer_job_posts (id, job_id, employer_id, job_title) values
  ('20000000-0000-0000-0000-000000000021', 'EMP-21', '10000000-0000-0000-0000-000000000001', 'Barista'),
  ('20000000-0000-0000-0000-000000000022', 'EMP-22', '10000000-0000-0000-0000-000000000001', 'Barista'),
  ('20000000-0000-0000-0000-000000000023', 'EMP-23', '10000000-0000-0000-0000-000000000001', 'Cashier');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000e1');
-- Saving a job's assessment saves it as a template named after the job.
insert into auto_ids select 'first', (public.save_job_assessment('20000000-0000-0000-0000-000000000021',
  '[{"name":"Coffee","question":"How do you pull a good shot?","weight":3,"is_required":true}]'::jsonb)->>'template_id')::uuid;
do $$
declare t public.assessment_templates%rowtype;
begin
  select * into t from public.assessment_templates where id = (select value from auto_ids where key = 'first');
  if t.name <> 'Barista assessment' or t.source_job_post_id <> '20000000-0000-0000-0000-000000000021' then raise exception 'auto template not named after the job: %', t.name; end if;
  if t.criteria->0->>'question' <> 'How do you pull a good shot?' then raise exception 'auto template missing the questions'; end if;
  if (select template_id from public.evaluation_rubrics where job_post_id = '20000000-0000-0000-0000-000000000021' order by version desc limit 1) <> t.id then
    raise exception 'rubric not linked to its template';
  end if;
end $$;

-- Editing the job's questions updates the same template instead of adding another.
do $$ begin
  if (public.save_job_assessment('20000000-0000-0000-0000-000000000021',
      '[{"name":"Coffee","question":"Walk us through a busy morning.","weight":2,"is_required":true}]'::jsonb)->>'template_id')::uuid
      <> (select value from auto_ids where key = 'first') then raise exception 'edit created a new template'; end if;
  if (select count(*) from public.assessment_templates where source_job_post_id = '20000000-0000-0000-0000-000000000021') <> 1 then raise exception 'duplicate templates for one job'; end if;
  if (select criteria->0->>'question' from public.assessment_templates where id = (select value from auto_ids where key = 'first')) <> 'Walk us through a busy morning.' then
    raise exception 'template not updated with the edited questions';
  end if;
end $$;

-- Another job with the same title and different questions gets a numbered name.
do $$ begin
  if (select name from public.assessment_templates where id = (public.save_job_assessment('20000000-0000-0000-0000-000000000022',
      '[{"name":"Latte art","question":"Show us your best pour.","weight":1,"is_required":false}]'::jsonb)->>'template_id')::uuid) <> 'Barista assessment (2)' then
    raise exception 'same-titled job did not get a numbered template';
  end if;
end $$;

-- Identical questions reuse the existing template rather than duplicating it.
do $$ begin
  if (public.save_job_assessment('20000000-0000-0000-0000-000000000023',
      '[{"name":"Coffee","question":"Walk us through a busy morning.","weight":2,"is_required":true}]'::jsonb)->>'template_id')::uuid
      <> (select value from auto_ids where key = 'first') then raise exception 'identical questions made a duplicate template'; end if;
  if exists (select 1 from public.assessment_templates where source_job_post_id = '20000000-0000-0000-0000-000000000023') then
    raise exception 'duplicate template created';
  end if;
end $$;

-- The helpers are internal.
do $$ begin
  begin
    perform public.link_rubric_to_template((select id from public.evaluation_rubrics limit 1));
    raise exception 'employer called the internal helper';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- Another employer can't save an assessment on this employer's job.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000e2');
do $$ begin
  begin
    perform public.save_job_assessment('20000000-0000-0000-0000-000000000021', '[{"name":"x","question":"y?"}]'::jsonb);
    raise exception 'other employer saved an assessment';
  exception when insufficient_privilege then null;
  end;
  if exists (select 1 from public.assessment_templates where employer_id = '10000000-0000-0000-0000-000000000001') then raise exception 'other employer read auto templates'; end if;
end $$;
reset role;

set role anon;
do $$ begin
  begin
    perform public.save_job_assessment('20000000-0000-0000-0000-000000000021', '[{"name":"x","question":"y?"}]'::jsonb);
    raise exception 'anon saved an assessment';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
\echo 'Auto assessment template checks passed.'

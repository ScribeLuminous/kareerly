-- Checks for 20261028100000_assessment_ai_review_drafts.sql. Runs after the
-- assessment workflow tests, which leave application ...0002 with a reviewed
-- assessment and a scorecard submitted by employer e1.
\set ON_ERROR_STOP on
create or replace function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid, ''), false);
  set role authenticated;
end $$;

-- The backend writes the draft (as the service role, which bypasses RLS).
insert into public.assessment_ai_drafts(assessment_id, job_post_id, generated_by, model, ratings, summary, links)
  select a.id, a.job_post_id, '00000000-0000-0000-0000-0000000000e1', 'test-model',
    '[{"criterion_id":null,"rating":3,"evidence":"Gave a concrete example."}]'::jsonb, 'Solid answer.', '["https://example.com/work"]'::jsonb
  from public.candidate_assessments a where a.application_id = '30000000-0000-0000-0000-000000000002';

-- Only the owning employer reads it; candidates, other employers and anon cannot.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000e1');
do $$ begin
  if (select count(*) from public.assessment_ai_drafts) <> 1 then raise exception 'owner cannot read the draft'; end if;
  begin
    insert into public.assessment_ai_drafts(assessment_id, job_post_id) select assessment_id, job_post_id from public.assessment_ai_drafts;
    raise exception 'employer wrote a draft directly';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.assessment_ai_drafts set approved_at = now();
    raise exception 'employer approved a draft by updating the table';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000e2');
do $$ begin
  if exists (select 1 from public.assessment_ai_drafts) then raise exception 'other employer read the draft'; end if;
  begin
    perform public.approve_assessment_ai_draft((select id from public.candidate_assessments where application_id = '30000000-0000-0000-0000-000000000002'));
    raise exception 'other employer approved the draft';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c2');
do $$ begin
  if exists (select 1 from public.assessment_ai_drafts) then raise exception 'candidate read the draft'; end if;
end $$;
reset role;
set role anon;
do $$ begin
  begin
    perform 1 from public.assessment_ai_drafts;
    raise exception 'anon read the draft';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- A reviewer who has not submitted a scorecard cannot approve; one who has, can, once.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000e1');
do $$
declare target uuid := (select id from public.candidate_assessments where application_id = '30000000-0000-0000-0000-000000000002');
begin
  perform public.approve_assessment_ai_draft(target);
  perform public.approve_assessment_ai_draft(target);
  if (select approved_by from public.assessment_ai_drafts where assessment_id = target) <> '00000000-0000-0000-0000-0000000000e1' then
    raise exception 'approval not recorded';
  end if;
  if (select count(*) from public.employer_review_audit_log where event_type = 'ai_review_draft_approved' and application_id = '30000000-0000-0000-0000-000000000002') <> 1 then
    raise exception 'approval should be logged exactly once';
  end if;
end $$;
reset role;
\echo 'Assessment AI draft checks passed.'

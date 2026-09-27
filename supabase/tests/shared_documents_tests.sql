-- Checks for 20260930090000_job_post_screening_and_shared_documents.sql:
-- candidates own their shared documents, employers can't read them directly,
-- and applicant counts expose only numbers. Any failed check raises and stops.
\set ON_ERROR_STOP on
create table if not exists public.resumes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade
);
insert into public.resumes (id, user_id) values
  ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c1'),
  ('40000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000c2')
  on conflict do nothing;
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on public.profiles, public.employer_profiles, public.employer_job_posts, public.job_applications, public.resumes, public.application_shared_documents to authenticated;

create or replace function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid, ''), false);
  set role authenticated;
end $$;

-- New columns default to empty lists on existing rows.
do $$ begin
  if (select screening_questions from public.employer_job_posts where job_id = 'EMP-1') <> '[]'::jsonb then raise exception 'screening default'; end if;
  if (select screening_answers from public.job_applications where id = '30000000-0000-0000-0000-000000000001') <> '[]'::jsonb then raise exception 'answers default'; end if;
end $$;

-- Candidate 1 shares a resume on their own application.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
insert into public.application_shared_documents (application_id, user_id, resume_id, share_resume, portfolio_url)
values ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c1', '40000000-0000-0000-0000-000000000001', true, 'https://example.com/me');

-- ...but not on someone else's application, nor with someone else's resume.
do $$ begin
  begin
    insert into public.application_shared_documents (application_id, user_id, share_resume)
    values ('30000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000c1', true);
    raise exception 'shared on another candidate''s application';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.application_shared_documents (application_id, user_id, resume_id, share_resume)
    values ('30000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000c1', '40000000-0000-0000-0000-000000000002', true);
    raise exception 'shared another candidate''s resume';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.application_shared_documents set portfolio_url = 'javascript:alert(1)'
    where application_id = '30000000-0000-0000-0000-000000000001';
    raise exception 'accepted a non-http portfolio link';
  exception when check_violation then null;
  end;
end $$;
reset role;

-- Candidate 2 and the employer see nothing.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c2');
do $$ begin
  if (select count(*) from public.application_shared_documents) <> 0 then raise exception 'other candidate read documents'; end if;
end $$;
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000e1');
do $$ begin
  if (select count(*) from public.application_shared_documents) <> 0 then raise exception 'employer read documents directly'; end if;
end $$;
reset role;

-- Applicant counts: open posts only, withdrawn excluded.
update public.job_applications set status = 'withdrawn' where id = '30000000-0000-0000-0000-000000000002';
update public.employer_job_posts set posting_status = 'closed' where job_id = 'EMP-2';
set role anon;
do $$ begin
  if (select applicant_count from public.get_job_applicant_counts(array['EMP-1','EMP-2'])) <> 1 then raise exception 'wrong applicant count'; end if;
  if (select count(*) from public.get_job_applicant_counts(array['EMP-1','EMP-2'])) <> 1 then raise exception 'closed post counted'; end if;
end $$;
reset role;

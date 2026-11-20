-- Checks for 20261117100000_employer_test_postings.sql. Runs after
-- employer_job_posts_public_read_tests.sql in the same database. Any failed
-- check raises and stops.
\set ON_ERROR_STOP on

-- The backfill marked only the "(Test ...)" company's post.
do $$ begin
  if not (select is_test_posting from public.employer_job_posts where job_id = 'EMP-TEST-LABEL') then
    raise exception 'a "(Test ...)" company post was not marked';
  end if;
  if exists (select 1 from public.employer_job_posts where is_test_posting and job_id <> 'EMP-TEST-LABEL') then
    raise exception 'a real post was marked as a test';
  end if;
end $$;

-- The public key no longer sees it, and still sees the real open posts.
set role anon;
do $$
declare seen text[];
begin
  select array_agg(job_id order by job_id) into seen from public.employer_job_posts;
  if 'EMP-TEST-LABEL' = any (seen) then
    raise exception 'anon can read a test posting';
  end if;
  if not ('EMP-OTHER' = any (seen)) then
    raise exception 'anon lost a real open post: %', seen;
  end if;
end $$;
reset role;

-- A candidate (another signed-in user) does not see it either; its owner does.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', false);
do $$ begin
  if exists (select 1 from public.employer_job_posts where job_id = 'EMP-TEST-LABEL') then
    raise exception 'another signed-in user can read a test posting';
  end if;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
do $$ begin
  if not exists (select 1 from public.employer_job_posts where job_id = 'EMP-TEST-LABEL') then
    raise exception 'the owner cannot see their own test posting';
  end if;
end $$;
reset role;

-- Clearing the mark shows the post again.
update public.employer_job_posts set is_test_posting = false where job_id = 'EMP-TEST-LABEL';
set role anon;
do $$ begin
  if not exists (select 1 from public.employer_job_posts where job_id = 'EMP-TEST-LABEL') then
    raise exception 'an unmarked post stays hidden';
  end if;
end $$;
reset role;

select 'Employer test posting checks passed.';

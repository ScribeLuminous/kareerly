-- Checks for 20261119090000_keep_applied_job_posts.sql. Runs after
-- server_scored_applications_tests.sql in the same database (EMP-1 and EMP-2
-- have applications; EMP-3 and EMP-4 have none). Any failed check raises and stops.
\set ON_ERROR_STOP on

create or replace function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid, ''), false);
  set role authenticated;
end $$;

-- The owning employer cannot delete a post that has applicants...
select pg_temp.act_as('00000000-0000-0000-0000-0000000000e1');
do $$ begin
  begin
    delete from public.employer_job_posts where job_id = 'EMP-1';
    raise exception 'a post with applicants was deleted';
  exception when raise_exception then
    if sqlerrm not like '%Close or archive it instead%' then raise; end if;
  end;
  -- ...and a bulk delete that includes one deletes nothing.
  begin
    delete from public.employer_job_posts where job_id in ('EMP-1', 'EMP-3');
    raise exception 'a bulk delete removed a post with applicants';
  exception when raise_exception then null;
  end;
end $$;
reset role;

do $$ begin
  if (select count(*) from public.employer_job_posts where job_id in ('EMP-1', 'EMP-3')) <> 2 then
    raise exception 'posts went missing';
  end if;
end $$;

-- Closing it still works, and a post without applicants still deletes.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000e1');
update public.employer_job_posts set posting_status = 'closed' where job_id = 'EMP-1';
delete from public.employer_job_posts where job_id = 'EMP-3';
reset role;
do $$ begin
  if (select posting_status from public.employer_job_posts where job_id = 'EMP-1') <> 'closed' then
    raise exception 'closing a post with applicants failed';
  end if;
  if exists (select 1 from public.employer_job_posts where job_id = 'EMP-3') then
    raise exception 'a post without applicants could not be deleted';
  end if;
end $$;

-- The backend's service role is held to the same rule.
set role service_role;
do $$ begin
  begin
    delete from public.employer_job_posts where job_id = 'EMP-2';
    raise exception 'the service role deleted a post with applicants';
  exception when raise_exception then null;
  end;
end $$;
reset role;

do $$ begin
  if has_function_privilege('authenticated', 'public.refuse_deleting_applied_job_post()', 'execute') then
    raise exception 'the trigger function is callable';
  end if;
end $$;

select 'Applied job post checks passed.';

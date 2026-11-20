-- A job post that has applications cannot be deleted (audit DATA-06).
--
-- job_applications.job_id is text, not a foreign key, so deleting a post left
-- its applications, message threads and evaluations pointing at a job that no
-- longer exists: candidates saw an application with no job, and the employer
-- lost the record of who applied. A post with applications can still be
-- closed or archived, which stops new applications and hides it from
-- candidates. Posts without applications delete as before.
--
-- Applications that already point at a deleted post are left as they are; to
-- list them:
--   select a.id, a.job_id, a.status from public.job_applications a
--   where a.job_source = 'employer'
--     and not exists (select 1 from public.employer_job_posts p where p.job_id = a.job_id);
-- Safe to re-run.

create or replace function public.refuse_deleting_applied_job_post()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.job_applications
    where job_source = 'employer' and job_id = old.job_id
  ) then
    raise exception 'This job has applicants, so it cannot be deleted. Close or archive it instead.'
      using errcode = 'P0001';
  end if;
  return old;
end;
$$;

revoke all on function public.refuse_deleting_applied_job_post() from public, anon, authenticated;

drop trigger if exists employer_job_posts_keep_applied on public.employer_job_posts;
create trigger employer_job_posts_keep_applied
  before delete on public.employer_job_posts
  for each row execute function public.refuse_deleting_applied_job_post();

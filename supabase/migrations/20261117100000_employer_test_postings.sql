-- Test postings stay out of the public job list and matching (audit DATA-01).
--
-- Accounts used to try the employer workflow posted live jobs, for example
-- "Hotel Front Desk Agent" at "Lakeside Web Studio (TEST Luz)", and candidates
-- were matched with them. A post marked is_test_posting is now visible only to
-- the employer who owns it.
--
-- The backfill marks posts whose company name carries a "(Test ...)" label,
-- which is how the test accounts were named. It hides them; it deletes
-- nothing. To show a post again:
--   update public.employer_job_posts set is_test_posting = false where job_id = '...';
-- Safe to re-run.

alter table public.employer_job_posts add column if not exists is_test_posting boolean not null default false;

comment on column public.employer_job_posts.is_test_posting is
  'True for posts made while testing. Only the owning employer can read them; the public job list and matching never see them.';

update public.employer_job_posts
  set is_test_posting = true
  where not is_test_posting
    and company_name ~* '\(\s*test\M';

drop policy if exists "Anyone can read active employer job posts" on public.employer_job_posts;
create policy "Anyone can read active employer job posts" on public.employer_job_posts for select using (
  posting_status = 'active'
  and not is_test_posting
  and (application_deadline is null or application_deadline > (now() at time zone 'Asia/Manila')::date)
);

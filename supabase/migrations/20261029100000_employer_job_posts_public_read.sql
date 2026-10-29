-- Lets the public job list read open employer job posts again.
--
-- 20261028090000_revoke_anon_table_access.sql removed anon's access to
-- employer_profiles. The "Employers can manage own job posts" policy had no
-- role, so Postgres also checked it for anon reads of employer_job_posts. Its
-- employer_profiles lookup then failed with "permission denied for table
-- employer_profiles", and every anon read of employer_job_posts failed with it.
--
-- The policy only ever matches a signed-in employer, so it is limited to the
-- authenticated role. Anon keeps "Anyone can read active employer job posts".
-- Safe to re-run.

drop policy if exists "Employers can manage own job posts" on public.employer_job_posts;
create policy "Employers can manage own job posts" on public.employer_job_posts
for all to authenticated
using (
  exists (
    select 1
    from public.employer_profiles
    where employer_profiles.id = employer_job_posts.employer_id
      and employer_profiles.user_id = auth.uid()
  )
) with check (
  exists (
    select 1
    from public.employer_profiles
    where employer_profiles.id = employer_job_posts.employer_id
      and employer_profiles.user_id = auth.uid()
  )
);

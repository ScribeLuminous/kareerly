-- Checks for 20261029100000_employer_job_posts_public_read.sql. Any failed
-- check raises and stops.
\set ON_ERROR_STOP on

insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000a1'), ('00000000-0000-0000-0000-0000000000a2');
insert into public.profiles (id) values
  ('00000000-0000-0000-0000-0000000000a1'), ('00000000-0000-0000-0000-0000000000a2');
insert into public.employer_profiles (id, user_id, company_name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', 'Owner Co'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000a2', 'Other Co');
insert into public.employer_job_posts (job_id, employer_id, job_title, posting_status, application_deadline) values
  ('EMP-OPEN', '00000000-0000-0000-0000-0000000000e1', 'Open role', 'active', null),
  ('EMP-EXPIRED', '00000000-0000-0000-0000-0000000000e1', 'Expired role', 'active', date '2000-01-01'),
  ('EMP-DRAFT', '00000000-0000-0000-0000-0000000000e1', 'Draft role', 'draft', null),
  ('EMP-OTHER', '00000000-0000-0000-0000-0000000000e2', 'Other role', 'active', null);

-- The public key reads open posts, and still cannot read employer accounts.
set role anon;
do $$
declare
  seen text[];
  refused boolean := false;
begin
  select array_agg(job_id order by job_id) into seen from public.employer_job_posts;
  if seen is distinct from array['EMP-OPEN', 'EMP-OTHER'] then
    raise exception 'anon should see only open posts, saw %', seen;
  end if;
  begin
    perform 1 from public.employer_profiles limit 1;
  exception when insufficient_privilege then
    refused := true;
  end;
  if not refused then
    raise exception 'anon can read employer_profiles';
  end if;
end $$;
reset role;

-- A signed-in employer still manages only their own posts.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
do $$
declare
  changed integer;
begin
  if not exists (select 1 from public.employer_job_posts where job_id = 'EMP-DRAFT') then
    raise exception 'employer cannot see their own draft';
  end if;
  update public.employer_job_posts set job_title = 'Renamed' where job_id = 'EMP-OPEN';
  get diagnostics changed = row_count;
  if changed <> 1 then
    raise exception 'employer cannot update their own post';
  end if;
  update public.employer_job_posts set job_title = 'Hijacked' where job_id = 'EMP-OTHER';
  get diagnostics changed = row_count;
  if changed <> 0 then
    raise exception 'employer updated another employer''s post';
  end if;
end $$;
select set_config('request.jwt.claim.sub', '', false);
reset role;

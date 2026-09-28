-- Checks for 20261004090000_security_hardening.sql. Any failed check raises
-- and stops.
\set ON_ERROR_STOP on

-- Nothing SECURITY DEFINER in public is callable without signing in, and no
-- trigger function is callable through the API at all.
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature, p.prorettype = 'trigger'::regtype as is_trigger
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef
  loop
    if has_function_privilege('anon', fn.signature, 'execute') then
      raise exception 'anon can execute %', fn.signature;
    end if;
    if fn.is_trigger and has_function_privilege('authenticated', fn.signature, 'execute') then
      raise exception 'authenticated can execute trigger function %', fn.signature;
    end if;
  end loop;
end $$;

do $$ begin
  -- Signed-in RPCs keep working.
  if not has_function_privilege('authenticated', 'public.save_evaluation_rubric(uuid, jsonb)', 'execute') then
    raise exception 'authenticated lost save_evaluation_rubric';
  end if;
  if not has_function_privilege('authenticated', 'public.employer_owns_job_post(uuid)', 'execute') then
    raise exception 'authenticated lost the RLS ownership helper';
  end if;
  if not has_function_privilege('authenticated', 'public.unlisted_definer_helper()', 'execute') then
    raise exception 'unlisted signed-in function was locked out';
  end if;
  -- Backend-only functions.
  if has_function_privilege('authenticated', 'public.get_job_applicant_counts(text[])', 'execute')
     or not has_function_privilege('service_role', 'public.get_job_applicant_counts(text[])', 'execute') then
    raise exception 'get_job_applicant_counts should be service_role only';
  end if;
  if has_function_privilege('authenticated', 'public.evaluation_version_result(uuid, uuid)', 'execute') then
    raise exception 'evaluation_version_result is callable by clients';
  end if;
  -- pg_trgm left public and its index still works.
  if (select extnamespace::regnamespace::text from pg_extension where extname = 'pg_trgm') <> 'extensions' then
    raise exception 'pg_trgm is still in public';
  end if;
  if not exists (select 1 from pg_indexes where indexname = 'employer_job_posts_title_trgm_idx') then
    raise exception 'trigram index lost';
  end if;
end $$;

create or replace function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid, ''), false);
  set role authenticated;
end $$;

-- Existing workflows still fire their (now non-callable) trigger functions.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000e1');
select public.set_application_stage('30000000-0000-0000-0000-000000000001', 'shortlisted', null);
reset role;
do $$ begin
  if not exists (
    select 1 from public.employer_review_audit_log
    where application_id = '30000000-0000-0000-0000-000000000001' and event_type = 'stage_changed'
  ) then raise exception 'stage audit trigger did not fire'; end if;
end $$;

-- Sign-up cannot request admin; employer and candidate sign-ups still work.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'wants-admin@example.com', '{"role":"admin"}'),
  ('00000000-0000-0000-0000-0000000000a2', 'new-employer@example.com', '{"role":"employer","company_name":"Acme"}'),
  ('00000000-0000-0000-0000-0000000000a3', 'new-candidate@example.com', '{}');
do $$ begin
  if (select role::text from public.profiles where id = '00000000-0000-0000-0000-0000000000a1') <> 'candidate' then
    raise exception 'sign-up metadata granted admin';
  end if;
  if (select role::text from public.profiles where id = '00000000-0000-0000-0000-0000000000a2') <> 'employer'
     or not exists (select 1 from public.employer_profiles where user_id = '00000000-0000-0000-0000-0000000000a2') then
    raise exception 'employer sign-up broke';
  end if;
  if not exists (select 1 from public.candidate_profiles where user_id = '00000000-0000-0000-0000-0000000000a3') then
    raise exception 'candidate sign-up broke';
  end if;
end $$;

-- A signed-in user can rename themselves but not change role or email.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
update public.profiles set first_name = 'Renamed' where id = '00000000-0000-0000-0000-0000000000c1';
do $$ begin
  begin
    update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000c1';
    raise exception 'candidate promoted themselves to admin';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.profiles set email = 'employer1@example.com' where id = '00000000-0000-0000-0000-0000000000c1';
    raise exception 'candidate changed their profile email';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.profiles (id, role, email) values ('00000000-0000-0000-0000-0000000000c1', 'admin', 'x@example.com');
    raise exception 'client inserted a profile';
  exception when insufficient_privilege then null;
  end;
  -- A candidate cannot give themselves an employer workspace.
  begin
    insert into public.employer_profiles (user_id, company_name) values ('00000000-0000-0000-0000-0000000000c1', 'Fake Co');
    raise exception 'candidate created an employer profile';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$ begin
  if (select first_name from public.profiles where id = '00000000-0000-0000-0000-0000000000c1') <> 'Renamed' then
    raise exception 'name edit was blocked';
  end if;
  if (select role::text from public.profiles where id = '00000000-0000-0000-0000-0000000000c1') <> 'candidate' then
    raise exception 'role changed';
  end if;
end $$;

-- Employers can still edit their own employer profile.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000e1');
update public.employer_profiles set company_name = 'Employer One Inc' where user_id = '00000000-0000-0000-0000-0000000000e1';
reset role;
do $$ begin
  if (select company_name from public.employer_profiles where user_id = '00000000-0000-0000-0000-0000000000e1') <> 'Employer One Inc' then
    raise exception 'employer profile edit was blocked';
  end if;
end $$;

-- Anonymous callers read no evaluation data and no profiles.
set role anon;
do $$ begin
  begin
    perform 1 from public.evaluation_scorecards;
    raise exception 'anon can read scorecards';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.profiles;
    raise exception 'anon can read profiles';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.get_employer_applicant_public_ids();
    raise exception 'anon can call get_employer_applicant_public_ids';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

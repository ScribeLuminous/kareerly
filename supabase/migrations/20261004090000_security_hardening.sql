-- Security hardening for the Supabase security advisor findings of 2026-09-28,
-- plus a privilege-escalation fix found while reviewing them.
--
-- 1. SECURITY DEFINER functions were executable by `anon` (and trigger
--    functions by `authenticated`) through /rest/v1/rpc. `revoke ... from
--    public` alone does not help on Supabase, because the platform's default
--    privileges also grant EXECUTE to anon and authenticated directly. Each
--    function now has an explicit grant list:
--      * trigger and scheduled-job functions: nobody (triggers and pg_cron do
--        not need EXECUTE to fire them);
--      * signed-in RPCs and RLS ownership helpers: authenticated only (each one
--        checks auth.uid() and ownership itself);
--      * get_job_applicant_counts: service_role only (the backend reads it).
--    Functions created later in public are no longer executable by anon or
--    authenticated unless a migration grants it.
-- 2. pg_trgm moves from public to the extensions schema.
-- 3. profiles.role decided admin access, and signed-in users could set it on
--    their own row (update policy) or at sign-up (user metadata). Clients may
--    now change only their name, sign-up can only pick candidate or employer,
--    and only employer accounts can create an employer profile.
-- 4. Evaluation tables are not readable by anon at all.
--
-- Leaked password protection (HaveIBeenPwned) is an Auth setting, not SQL:
-- Dashboard > Authentication > Sign In / Providers > Email > "Prevent use of
-- leaked passwords". See docs/security.md.
--
-- Safe to re-run, and skips objects that are not deployed.

-- ---------- 1. Function execute privileges ----------

do $$
declare
  fn record;
  sig text;
  authenticated_rpcs text[] := array[
    'public.employer_owns_job_post(uuid)',
    'public.owned_job_post_for_application(uuid)',
    'public.get_employer_applicant_public_ids()',
    'public.get_application_evaluation(uuid)',
    'public.list_job_evaluation_summaries(uuid)',
    'public.save_evaluation_rubric(uuid, jsonb)',
    'public.save_evaluation_scorecard(uuid, uuid, jsonb, text, boolean)',
    'public.set_application_stage(uuid, text, text)',
    'public.send_candidate_assessment(uuid)',
    'public.save_candidate_assessment(uuid, jsonb, boolean)',
    'public.apply_assessment_template(uuid, uuid[])'
  ];
  service_only text[] := array[
    'public.get_job_applicant_counts(text[])',
    'public.evaluation_version_result(uuid, uuid)',
    'public.next_skill_addition_id()',
    'public.close_expired_employer_job_posts()',
    'public.handle_new_auth_user()',
    'public.create_candidate_application_notification()',
    'public.enforce_candidate_external_job_match_limit()',
    'public.guard_match_feedback_write()',
    'public.log_application_stage_change()'
  ];
begin
  -- Every SECURITY DEFINER function in public: never callable without signing
  -- in. Trigger functions are not callable by anyone. Other functions not
  -- listed below keep working for signed-in users.
  for fn in
    select p.oid::regprocedure as signature, p.prorettype = 'trigger'::regtype as is_trigger
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prosecdef
  loop
    execute format('revoke all on function %s from public, anon', fn.signature);
    if fn.is_trigger then
      execute format('revoke all on function %s from authenticated', fn.signature);
    else
      execute format('grant execute on function %s to authenticated', fn.signature);
    end if;
    execute format('grant execute on function %s to service_role', fn.signature);
  end loop;

  foreach sig in array service_only loop
    if to_regprocedure(sig) is not null then
      execute format('revoke all on function %s from public, anon, authenticated', sig);
      execute format('grant execute on function %s to service_role', sig);
    end if;
  end loop;

  foreach sig in array authenticated_rpcs loop
    if to_regprocedure(sig) is not null then
      execute format('revoke all on function %s from public, anon', sig);
      execute format('grant execute on function %s to authenticated, service_role', sig);
    end if;
  end loop;
end;
$$;

-- New functions in public start private; grant EXECUTE explicitly.
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon, authenticated;

-- ---------- 2. pg_trgm out of the exposed schema ----------

create schema if not exists extensions;

do $$
begin
  if exists (
    select 1 from pg_extension
    where extname = 'pg_trgm' and extnamespace = 'public'::regnamespace
  ) then
    -- Existing trigram indexes reference the operator classes by OID and keep working.
    alter extension pg_trgm set schema extensions;
  end if;
end;
$$;

-- ---------- 3. Account role cannot be chosen or changed by the client ----------

-- Sign-up metadata is written by the client, so it may only choose between
-- the two self-service account types. Admins are promoted by an operator.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_role user_role := case
    when lower(coalesce(new.raw_user_meta_data ->> 'role', '')) = 'employer' then 'employer'::user_role
    else 'candidate'::user_role
  end;
  first_name_value text := coalesce(nullif(new.raw_user_meta_data ->> 'first_name', ''), split_part(new.email, '@', 1));
  last_name_value text := coalesce(new.raw_user_meta_data ->> 'last_name', '');
begin
  insert into public.profiles (id, role, first_name, last_name, email)
  values (new.id, requested_role, first_name_value, last_name_value, new.email)
  on conflict (id) do nothing;

  if requested_role = 'employer' then
    insert into public.employer_profiles (
      user_id,
      company_name,
      company_size,
      industry,
      business_email
    )
    values (
      new.id,
      coalesce(nullif(new.raw_user_meta_data ->> 'company_name', ''), 'Employer Workspace'),
      new.raw_user_meta_data ->> 'company_size',
      new.raw_user_meta_data ->> 'industry',
      new.email
    )
    on conflict (user_id) do nothing;
  else
    insert into public.candidate_profiles (user_id)
    values (new.id)
    on conflict (user_id) do nothing;
  end if;

  return new;
end;
$$;

revoke all on function public.handle_new_auth_user() from public, anon, authenticated;

-- Profiles are created by the sign-up trigger and changed by the backend with
-- the service role. Clients may edit only their own name. role and email stay
-- server-owned (email is kept in step with Supabase Auth).
revoke all on public.profiles from anon;
revoke insert, update, delete on public.profiles from authenticated;
grant select on public.profiles to authenticated;
grant update (first_name, last_name, updated_at) on public.profiles to authenticated;

drop policy if exists "Users can insert own profile" on public.profiles;

-- Only employer accounts can hold an employer profile (which is what lets an
-- account post jobs and read applicants).
drop policy if exists "Users can manage own employer profile" on public.employer_profiles;
create policy "Users can manage own employer profile" on public.employer_profiles
  for all
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role::text = 'employer'
    )
  );

-- ---------- 4. Evaluation data is never anonymous ----------

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'evaluation_rubrics', 'evaluation_criteria', 'evaluation_scorecards', 'evaluation_ratings',
    'employer_review_audit_log', 'candidate_assessments', 'assessment_criterion_snapshots',
    'candidate_assessment_responses', 'assessment_templates', 'application_shared_documents',
    'candidate_notifications', 'message_moderation_actions', 'account_deletion_requests'
  ] loop
    if to_regclass('public.' || table_name) is not null then
      execute format('revoke all on public.%I from anon', table_name);
    end if;
  end loop;
end;
$$;

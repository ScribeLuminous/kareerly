-- Row-level security checks for 20261013090000_resume_summary_feedback.sql.
-- Run by run_rls_tests.sh; any failed check raises and stops the script.
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned
grant usage on schema public to anon, authenticated, service_role;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a@example.com'),
  ('00000000-0000-0000-0000-0000000000b1', 'b@example.com');

create or replace function pg_temp.act_as(uid text, role_name text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid, ''), false);
  execute format('set role %I', role_name);
end $$;

-- A answers, changes the answer, and answers again for a newer resume.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1', 'authenticated');
insert into public.resume_summary_feedback (user_id, resume_version, summary_version, rating)
  values ('00000000-0000-0000-0000-0000000000a1', 'sha256:old', 'v1', 'yes');
insert into public.resume_summary_feedback (user_id, resume_version, summary_version, rating, reasons, comment)
  values ('00000000-0000-0000-0000-0000000000a1', 'sha256:old', 'v1', 'not_quite', '{wrong_roles}', 'More admin roles')
  on conflict (user_id, resume_version) do update
  set rating = excluded.rating, reasons = excluded.reasons, comment = excluded.comment;
insert into public.resume_summary_feedback (user_id, resume_version, summary_version, rating)
  values ('00000000-0000-0000-0000-0000000000a1', 'sha256:new', 'v1', 'yes');
do $$ begin
  if (select count(*) from public.resume_summary_feedback) <> 2 then raise exception 'one answer per resume version expected'; end if;
  if (select rating from public.resume_summary_feedback where resume_version = 'sha256:old') <> 'not_quite' then
    raise exception 'changing the answer should update the row';
  end if;
  if (select rating from public.resume_summary_feedback where resume_version = 'sha256:new') <> 'yes' then
    raise exception 'the old answer must not carry over to a newer resume';
  end if;
end $$;

-- Reasons are a fixed list, and only explain a "Not quite".
do $$ begin
  begin
    insert into public.resume_summary_feedback (user_id, resume_version, summary_version, rating, reasons)
      values ('00000000-0000-0000-0000-0000000000a1', 'sha256:x', 'v1', 'not_quite', '{bad_reason}');
    raise exception 'unknown reason accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.resume_summary_feedback (user_id, resume_version, summary_version, rating, reasons)
      values ('00000000-0000-0000-0000-0000000000a1', 'sha256:y', 'v1', 'yes', '{wrong_roles}');
    raise exception 'reasons accepted on a yes';
  exception when check_violation then null;
  end;
end $$;

-- A cannot write B's answer.
do $$ begin
  begin
    insert into public.resume_summary_feedback (user_id, resume_version, summary_version, rating)
      values ('00000000-0000-0000-0000-0000000000b1', 'sha256:b', 'v1', 'yes');
    raise exception 'insert for another user was allowed';
  exception when insufficient_privilege then null;
  end;
end $$;

-- B sees none of A's answers; anon has no access at all.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1', 'authenticated');
do $$ begin
  if (select count(*) from public.resume_summary_feedback) <> 0 then raise exception 'B can read A''s answers'; end if;
  update public.resume_summary_feedback set rating = 'yes';
  if found then raise exception 'B changed A''s answer'; end if;
end $$;
reset role;
select pg_temp.act_as('', 'anon');
do $$ begin
  begin
    perform count(*) from public.resume_summary_feedback;
    raise exception 'anon can read answers';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

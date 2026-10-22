-- Row-level security checks for 20261022090000_candidate_progress_sync.sql.
-- Run by run_rls_tests.sh; any failed check raises and stops the script.
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned
grant usage on schema public to anon, authenticated, service_role;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a@example.com'),
  ('00000000-0000-0000-0000-0000000000b1', 'b@example.com');
insert into public.profiles (id) values
  ('00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000b1');

-- A row the backend wrote on resume upload, before skill_key existed.
insert into public.candidate_skill_progress (candidate_id, skill_id, skill_name, status)
  values ('00000000-0000-0000-0000-0000000000a1', 'SK100', 'Excel', 'missing');

create or replace function pg_temp.act_as(uid text, role_name text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid, ''), false);
  execute format('set role %I', role_name);
end $$;

-- A saves progress, a claim and a course, then changes them (upserts, as the dashboard does).
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1', 'authenticated');
insert into public.candidate_skill_progress (candidate_id, skill_key, skill_id, skill_name, status, progress_percent)
  values ('00000000-0000-0000-0000-0000000000a1', 'SK200', 'SK200', 'SQL', 'in_progress', 35);
insert into public.candidate_skill_progress (candidate_id, skill_key, skill_id, skill_name, status, progress_percent)
  values ('00000000-0000-0000-0000-0000000000a1', 'SK200', 'SK200', 'SQL', 'completed', 70)
  on conflict (candidate_id, skill_key) do update
  set status = excluded.status, progress_percent = excluded.progress_percent;
insert into public.candidate_claimed_skills (user_id, skill_key, skill_id, skill_name)
  values ('00000000-0000-0000-0000-0000000000a1', 'SK300', 'SK300', 'Python');
insert into public.candidate_claimed_skills (user_id, skill_key, skill_id, skill_name)
  values ('00000000-0000-0000-0000-0000000000a1', 'SK300', 'SK300', 'Python 3')
  on conflict (user_id, skill_key) do update set skill_name = excluded.skill_name;
insert into public.candidate_course_completions (user_id, resource_id, status)
  values ('00000000-0000-0000-0000-0000000000a1', 'course-1', 'completed');
insert into public.candidate_course_completions (user_id, resource_id, status, evidence_id)
  values ('00000000-0000-0000-0000-0000000000a1', 'course-1', 'evidenced', 'evidence-1')
  on conflict (user_id, resource_id) do update set status = excluded.status, evidence_id = excluded.evidence_id;
do $$ begin
  if (select count(*) from public.candidate_skill_progress) <> 2 then raise exception 'A should see the backend row and one keyed row'; end if;
  if (select status from public.candidate_skill_progress where skill_key = 'SK200') <> 'completed' then
    raise exception 'upserting progress should update the row';
  end if;
  if (select count(*) from public.candidate_claimed_skills) <> 1 then raise exception 'one claim per skill key expected'; end if;
  if (select skill_name from public.candidate_claimed_skills) <> 'Python 3' then raise exception 'claim upsert did not update'; end if;
  if (select status || ':' || evidence_id from public.candidate_course_completions) <> 'evidenced:evidence-1' then
    raise exception 'course completion upsert did not update';
  end if;
end $$;

-- Statuses are a fixed list; the owner cannot be moved to someone else.
do $$ begin
  begin
    insert into public.candidate_course_completions (user_id, resource_id, status)
      values ('00000000-0000-0000-0000-0000000000a1', 'course-2', 'started');
    raise exception 'unknown course status accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.candidate_skill_progress (candidate_id, skill_key, skill_name, status)
      values ('00000000-0000-0000-0000-0000000000a1', 'SK400', 'Tableau', 'done');
    raise exception 'unknown progress status accepted';
  exception when check_violation then null;
  end;
  update public.candidate_claimed_skills set user_id = '00000000-0000-0000-0000-0000000000b1';
  if (select count(*) from public.candidate_claimed_skills where user_id = '00000000-0000-0000-0000-0000000000a1') <> 1 then
    raise exception 'a claim was moved to another user';
  end if;
end $$;

-- A cannot write rows for B.
do $$ begin
  begin
    insert into public.candidate_skill_progress (candidate_id, skill_key, skill_name, status)
      values ('00000000-0000-0000-0000-0000000000b1', 'SK200', 'SQL', 'completed');
    raise exception 'progress insert for another user was allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.candidate_claimed_skills (user_id, skill_key, skill_name)
      values ('00000000-0000-0000-0000-0000000000b1', 'SK300', 'Python');
    raise exception 'claim insert for another user was allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.candidate_course_completions (user_id, resource_id, status)
      values ('00000000-0000-0000-0000-0000000000b1', 'course-1', 'completed');
    raise exception 'course completion insert for another user was allowed';
  exception when insufficient_privilege then null;
  end;
end $$;

-- B sees, changes and deletes none of A's rows.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1', 'authenticated');
do $$ begin
  if (select count(*) from public.candidate_skill_progress) <> 0 then raise exception 'B can read A''s progress'; end if;
  if (select count(*) from public.candidate_claimed_skills) <> 0 then raise exception 'B can read A''s claims'; end if;
  if (select count(*) from public.candidate_course_completions) <> 0 then raise exception 'B can read A''s courses'; end if;
  update public.candidate_skill_progress set status = 'missing';
  if found then raise exception 'B changed A''s progress'; end if;
  delete from public.candidate_claimed_skills;
  if found then raise exception 'B deleted A''s claims'; end if;
  delete from public.candidate_course_completions;
  if found then raise exception 'B deleted A''s courses'; end if;
end $$;

-- B keeps their own rows under the same keys as A.
insert into public.candidate_claimed_skills (user_id, skill_key, skill_name)
  values ('00000000-0000-0000-0000-0000000000b1', 'SK300', 'Python');
reset role;
do $$ begin
  if (select count(*) from public.candidate_claimed_skills) <> 2 then raise exception 'claims should be per user'; end if;
end $$;

-- A can remove their own claim (unclaim) and course (not taken).
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1', 'authenticated');
delete from public.candidate_claimed_skills where skill_key = 'SK300';
delete from public.candidate_course_completions where resource_id = 'course-1';
do $$ begin
  if (select count(*) from public.candidate_claimed_skills) <> 0 then raise exception 'A could not delete own claim'; end if;
  if (select count(*) from public.candidate_course_completions) <> 0 then raise exception 'A could not delete own course'; end if;
end $$;
reset role;

-- anon has no access at all.
select pg_temp.act_as('', 'anon');
do $$ begin
  begin
    perform count(*) from public.candidate_claimed_skills;
    raise exception 'anon can read claims';
  exception when insufficient_privilege then null;
  end;
  begin
    perform count(*) from public.candidate_course_completions;
    raise exception 'anon can read courses';
  exception when insufficient_privilege then null;
  end;
  begin
    perform count(*) from public.candidate_skill_progress;
    raise exception 'anon can read progress';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

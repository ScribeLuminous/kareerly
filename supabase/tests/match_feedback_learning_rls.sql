-- Row-level security checks for 20260925090000_match_feedback_learning.sql.
-- Run by run_rls_tests.sh; any failed check raises and stops the script.
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to anon, authenticated, service_role;
grant usage, select on all sequences in schema public to service_role;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.com');

create or replace function pg_temp.act_as(uid text, role_name text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid, ''), false);
  execute format('set role %I', role_name);
end $$;

-- A can insert, read, change and delete their own vote.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a', 'authenticated');
insert into public.match_feedback (user_id, job_id, job_source, vote, match_category, match_score)
  values ('00000000-0000-0000-0000-00000000000a', 'JOB-1', 'internal', 1, 'Fit-Now', 0.8);
insert into public.match_feedback (user_id, job_id, job_source, vote, match_category, match_score)
  values ('00000000-0000-0000-0000-00000000000a', 'JOB-1', 'internal', -1, 'Fit-Now', 0.8)
  on conflict (user_id, job_id, job_source) do update set vote = excluded.vote;
do $$ begin
  if (select count(*) from public.match_feedback) <> 1 then raise exception 'A should see exactly one current vote'; end if;
  if (select vote from public.match_feedback) <> -1 then raise exception 'upsert should change the vote'; end if;
end $$;

-- A cannot write a vote owned by B.
do $$ begin
  begin
    insert into public.match_feedback (user_id, job_id, vote, match_category)
      values ('00000000-0000-0000-0000-00000000000b', 'JOB-2', 1, 'Fit-Now');
    raise exception 'insert for another user was allowed';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- B sees none of A's votes and cannot change or delete them.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b', 'authenticated');
do $$ begin
  if (select count(*) from public.match_feedback) <> 0 then raise exception 'B can read A''s votes'; end if;
end $$;
update public.match_feedback set vote = 1;
delete from public.match_feedback;
reset role;
do $$ begin
  if (select vote from public.match_feedback where job_id = 'JOB-1') <> -1 then raise exception 'B changed A''s vote'; end if;
end $$;

-- A cannot move their row to B through an update.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a', 'authenticated');
update public.match_feedback set user_id = '00000000-0000-0000-0000-00000000000b';
reset role;
do $$ begin
  if (select user_id from public.match_feedback where job_id = 'JOB-1') <> '00000000-0000-0000-0000-00000000000a' then
    raise exception 'update reassigned ownership';
  end if;
end $$;

-- Anonymous callers see no votes.
select pg_temp.act_as(null, 'anon');
do $$ begin
  if (select count(*) from public.match_feedback) <> 0 then raise exception 'anon can read votes'; end if;
end $$;
reset role;

-- Invalid votes and categories are rejected by constraints.
do $$ begin
  begin
    insert into public.match_feedback (user_id, job_id, vote, match_category)
      values ('00000000-0000-0000-0000-00000000000a', 'JOB-3', 5, 'Fit-Now');
    raise exception 'vote 5 accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.match_feedback (user_id, job_id, vote, match_category)
      values ('00000000-0000-0000-0000-00000000000a', 'JOB-3', 1, 'Low Match');
    raise exception 'Low Match category accepted';
  exception when check_violation then null;
  end;
end $$;

-- Rate limit: the 121st change within an hour is refused.
do $$ begin
  for i in 1..119 loop
    insert into public.match_feedback (user_id, job_id, vote, match_category)
      values ('00000000-0000-0000-0000-00000000000a', 'RATE-' || i, 1, 'Fit-Now');
  end loop;
  begin
    insert into public.match_feedback (user_id, job_id, vote, match_category)
      values ('00000000-0000-0000-0000-00000000000a', 'RATE-OVER', 1, 'Fit-Now');
    raise exception 'rate limit not enforced';
  exception when check_violation then null;
  end;
end $$;

-- Models: only the active one is public; runs and proposals are service-role only.
insert into public.ranking_models (version, status, params) values ('v-old', 'retired', '{}'), ('v-new', 'active', '{}');
do $$ begin
  begin
    insert into public.ranking_models (version, status, params) values ('v-two', 'active', '{}');
    raise exception 'two active models allowed';
  exception when unique_violation then null;
  end;
end $$;
insert into public.ranking_training_runs (outcome) values ('insufficient_data');
insert into public.skill_candidates (normalized_label, display_label) values ('terraform', 'Terraform');
insert into public.skill_taxonomy_additions (kind, skill_id, label, normalized_label, status)
  values ('skill', 'SK5001', 'Terraform', 'terraform', 'active'), ('alias', 'SK001', 'Py', 'py', 'retired');

select pg_temp.act_as(null, 'anon');
do $$ begin
  if (select count(*) from public.ranking_models) <> 1 then raise exception 'anon should see only the active model'; end if;
  if (select count(*) from public.ranking_training_runs) <> 0 then raise exception 'anon can read training runs'; end if;
  if (select count(*) from public.skill_candidates) <> 0 then raise exception 'anon can read skill proposals'; end if;
  if (select count(*) from public.skill_candidate_evidence) <> 0 then raise exception 'anon can read skill evidence'; end if;
  if (select count(*) from public.skill_taxonomy_additions) <> 1 then raise exception 'anon should see only active additions'; end if;
end $$;
do $$ begin
  begin
    insert into public.skill_taxonomy_additions (kind, skill_id, label, normalized_label) values ('skill', 'SK9999', 'Hack', 'hack');
    raise exception 'anon inserted a taxonomy addition';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.next_skill_addition_id();
    raise exception 'anon allocated a skill id';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-00000000000a', 'authenticated');
do $$ begin
  if (select count(*) from public.skill_candidates) <> 0 then raise exception 'users can read skill proposals'; end if;
  update public.ranking_models set status = 'retired';
end $$;
reset role;
do $$ begin
  if (select status from public.ranking_models where version = 'v-new') <> 'active' then raise exception 'a user changed the active model'; end if;
end $$;

-- The service role allocates IDs and bypasses RLS for the batch jobs.
set role service_role;
do $$ begin
  if public.next_skill_addition_id() !~ '^SK[0-9]+$' then raise exception 'bad skill id'; end if;
  if (select count(*) from public.match_feedback) < 1 then raise exception 'service role cannot read votes'; end if;
end $$;
reset role;

-- Deleting an account removes its votes.
delete from auth.users where id = '00000000-0000-0000-0000-00000000000a';
do $$ begin
  if (select count(*) from public.match_feedback) <> 0 then raise exception 'votes survived account deletion'; end if;
end $$;

select 'match_feedback_learning RLS checks passed' as result;

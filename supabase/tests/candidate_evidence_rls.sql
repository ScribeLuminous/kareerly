-- Row-level security checks for 20261028150000_candidate_evidence.sql.
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

-- A saves a link-only badge (no file), then updates it as the dashboard does.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1', 'authenticated');
insert into public.candidate_evidence (id, user_id, title, credential_url, credential_provider, credential_status, badge_name)
  values ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000a1', 'Artificial Intelligence',
          'https://www.credly.com/badges/d6edaf38-1ed2-418c-9ecd-f6913acdc0f2', 'Credly', 'verified', 'AI Fundamentals');
insert into public.candidate_evidence (id, user_id, title, status)
  values ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000a1', 'Artificial Intelligence', 'Verified')
  on conflict (id) do update set status = excluded.status;
do $$ begin
  if (select count(*) from public.candidate_evidence) <> 1 then raise exception 'A should have one record'; end if;
  if (select status from public.candidate_evidence) <> 'Verified' then raise exception 'upsert did not update'; end if;
end $$;

-- Values outside the lists are refused; the owner cannot be changed.
do $$ begin
  begin
    insert into public.candidate_evidence (id, user_id, title, status)
      values (gen_random_uuid(), '00000000-0000-0000-0000-0000000000a1', 'x', 'Approved');
    raise exception 'unknown status accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.candidate_evidence (id, user_id, title, credential_status)
      values (gen_random_uuid(), '00000000-0000-0000-0000-0000000000a1', 'x', 'not_found');
    raise exception 'a refused link was accepted';
  exception when check_violation then null;
  end;
  update public.candidate_evidence set user_id = '00000000-0000-0000-0000-0000000000b1';
  if (select count(*) from public.candidate_evidence where user_id = '00000000-0000-0000-0000-0000000000a1') <> 1 then
    raise exception 'a record was moved to another user';
  end if;
  begin
    insert into public.candidate_evidence (id, user_id, title)
      values (gen_random_uuid(), '00000000-0000-0000-0000-0000000000b1', 'x');
    raise exception 'insert for another user was allowed';
  exception when insufficient_privilege then null;
  end;
end $$;

-- B sees, changes and deletes none of A's records.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1', 'authenticated');
do $$ begin
  if (select count(*) from public.candidate_evidence) <> 0 then raise exception 'B can read A''s evidence'; end if;
  update public.candidate_evidence set title = 'hijacked';
  if found then raise exception 'B changed A''s evidence'; end if;
  delete from public.candidate_evidence;
  if found then raise exception 'B deleted A''s evidence'; end if;
end $$;

-- Anonymous requests are refused.
select pg_temp.act_as(null, 'anon');
do $$ begin
  begin
    perform 1 from public.candidate_evidence;
    raise exception 'anon could read evidence';
  exception when insufficient_privilege then null;
  end;
end $$;

-- A can delete their own record.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1', 'authenticated');
delete from public.candidate_evidence;
do $$ begin
  if (select count(*) from public.candidate_evidence) <> 0 then raise exception 'A could not delete their record'; end if;
end $$;
reset role;

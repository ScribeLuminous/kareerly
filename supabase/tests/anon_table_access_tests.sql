-- Checks for 20261028090000_revoke_anon_table_access.sql. Any failed check
-- raises and stops.
\set ON_ERROR_STOP on

do $$
declare
  public_read_tables constant text[] := array[
    'internal_jobs', 'employer_job_posts', 'learning_resources',
    'skill_taxonomy_additions', 'reference_datasets', 'psoc_groups',
    'esco_occupations', 'esco_skills', 'esco_occupation_skills',
    'psoc_esco_occupation_links', 'kareerly_skill_esco_links'
  ];
  tbl record;
begin
  for tbl in
    select c.relname from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
  loop
    if tbl.relname = any (public_read_tables) then
      if not has_table_privilege('anon', format('public.%I', tbl.relname), 'select') then
        raise exception 'anon lost SELECT on public catalog %', tbl.relname;
      end if;
      if has_table_privilege('anon', format('public.%I', tbl.relname), 'insert, update, delete') then
        raise exception 'anon can write to public catalog %', tbl.relname;
      end if;
    elsif has_any_column_privilege('anon', format('public.%I', tbl.relname), 'select, insert, update, references') then
      raise exception 'anon can still reach user-data table %', tbl.relname;
    end if;
  end loop;
end $$;

-- A table created after the migration starts private.
create table public.anon_access_probe (id uuid primary key default gen_random_uuid());
do $$ begin
  if has_table_privilege('anon', 'public.anon_access_probe', 'select') then
    raise exception 'new tables are readable by anon';
  end if;
end $$;
drop table public.anon_access_probe;

-- What the REST API does for the anon key: a read of user data is refused,
-- not answered with an empty list.
set role anon;
do $$
declare
  t text;
  refused boolean;
begin
  foreach t in array array[
    'user_skills', 'saved_jobs', 'job_applications', 'skill_candidates',
    'employer_profiles', 'message_blocks', 'resumes', 'profiles'
  ] loop
    continue when to_regclass('public.' || t) is null;
    refused := false;
    begin
      execute format('select 1 from public.%I limit 1', t);
    exception when insufficient_privilege then
      refused := true;
    end;
    if not refused then
      raise exception 'anon SELECT on % was not refused', t;
    end if;
  end loop;
end $$;
reset role;

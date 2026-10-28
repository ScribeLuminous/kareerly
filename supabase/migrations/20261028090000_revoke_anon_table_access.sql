-- Anonymous clients must not reach user-data tables at all.
--
-- Supabase grants SELECT (and more) on every public table to `anon` by
-- default. Row-level security already hid the rows from them, but the grant
-- still let the REST API answer HTTP 200 with an empty list, which exposes the
-- table names and means one missing or loosened policy would leak every row.
-- This revokes the grant itself, so anon requests fail with 401/403.
--
-- Only tables that are public by design stay readable by anon, and only for
-- SELECT. Safe to re-run.

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
    select c.relname, c.relkind
    from pg_class c
    where c.relnamespace = 'public'::regnamespace
      and c.relkind in ('r', 'p', 'v', 'm', 'f')
  loop
    execute format('revoke all on public.%I from anon', tbl.relname);
    if tbl.relname = any (public_read_tables) then
      execute format('grant select on public.%I to anon', tbl.relname);
    end if;
  end loop;
end;
$$;

revoke all on all sequences in schema public from anon;

-- Tables and sequences created later start without anon access; a migration
-- that needs a public table grants SELECT explicitly (and adds it to the list
-- above and to supabase/tests/anon_table_access_tests.sql).
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;

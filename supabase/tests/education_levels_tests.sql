-- Checks for 20261028110000_education_levels.sql. Same cases as
-- backend/tests/test_education.py and frontend/tests/education.test.mjs.
\set ON_ERROR_STOP on
\ir ../migrations/20261028110000_education_levels.sql

do $$
declare
  c record;
begin
  for c in select * from (values
    ('Bachelor', 'Bachelor''s Degree'),
    ('bachelor', 'Bachelor''s Degree'),
    ('Bachelor''s Degree', 'Bachelor''s Degree'),
    ('Bachelor’s deg.', 'Bachelor''s Degree'),
    ('BS Computer Science', 'Bachelor''s Degree'),
    ('College graduate', 'Bachelor''s Degree'),
    ('Master''s in Education', 'Master''s Degree'),
    ('MBA', 'Master''s Degree'),
    ('PhD', 'Doctorate Degree'),
    ('Doctor of Medicine', 'Doctorate Degree'),
    ('Associate in Hotel Management', 'Associate Degree'),
    ('TESDA NC II', 'Vocational / Technical'),
    ('Vocational course', 'Vocational / Technical'),
    ('some college', 'Some College'),
    ('Undergraduate', 'Some College'),
    ('Senior High School', 'High School'),
    ('high school graduate', 'High School'),
    ('Vocational / Technical', 'Vocational / Technical'),
    ('', ''),
    ('Elementary', ''),
    ('n/a', '')
  ) as v(input, expected) loop
    if public.normalize_education_level(c.input) is distinct from c.expected then
      raise exception 'normalize_education_level(%) = %, expected %', c.input, public.normalize_education_level(c.input), c.expected;
    end if;
  end loop;
  if public.normalize_education_level(null) <> '' then raise exception 'null should normalize to empty'; end if;
end $$;

-- Existing account metadata is rewritten when the migration runs again (it is
-- safe to re-run); unrecognised text is kept as legacy.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000f1', 'edu1@example.com', '{"highest_educational_attainment":"bachelor"}'),
  ('00000000-0000-0000-0000-0000000000f2', 'edu2@example.com', '{"highest_educational_attainment":"Elementary"}'),
  ('00000000-0000-0000-0000-0000000000f3', 'edu3@example.com', '{"highest_educational_attainment":"Master''s Degree"}'),
  ('00000000-0000-0000-0000-0000000000f4', 'edu4@example.com', '{}');
\ir ../migrations/20261028110000_education_levels.sql
do $$ begin
  if (select raw_user_meta_data ->> 'highest_educational_attainment' from auth.users where id = '00000000-0000-0000-0000-0000000000f1') <> 'Bachelor''s Degree' then
    raise exception 'free text was not normalized';
  end if;
  if (select raw_user_meta_data ->> 'highest_educational_attainment' from auth.users where id = '00000000-0000-0000-0000-0000000000f2') <> ''
     or (select raw_user_meta_data ->> 'highest_educational_attainment_legacy' from auth.users where id = '00000000-0000-0000-0000-0000000000f2') <> 'Elementary' then
    raise exception 'unrecognised text was not kept as legacy';
  end if;
  if (select raw_user_meta_data ->> 'highest_educational_attainment' from auth.users where id = '00000000-0000-0000-0000-0000000000f3') <> 'Master''s Degree' then
    raise exception 'a valid value changed';
  end if;
  if (select raw_user_meta_data ? 'highest_educational_attainment' from auth.users where id = '00000000-0000-0000-0000-0000000000f4') then
    raise exception 'an account without a value gained one';
  end if;
end $$;
\echo 'Education level checks passed.'

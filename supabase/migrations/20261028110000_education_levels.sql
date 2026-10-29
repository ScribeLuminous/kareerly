-- Highest educational attainment becomes one fixed list (High School,
-- Vocational / Technical, Some College, Associate Degree, Bachelor's Degree,
-- Master's Degree, Doctorate Degree). Free text such as "bachelor" and
-- "Bachelor's deg." made counts by education level unreliable.
--
-- public.normalize_education_level is the SQL copy of the rules in
-- backend/app/services/education.py and frontend/src/lib/education.ts; all
-- three are tested against the same cases. It returns '' for text that names
-- no level. Safe to re-run.

create or replace function public.normalize_education_level(raw text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  t text;
begin
  t := lower(coalesce(raw, ''));
  t := replace(t, chr(8217), '''');
  t := regexp_replace(t, '[''.]', '', 'g');
  t := btrim(regexp_replace(t, '[^a-z0-9]+', ' ', 'g'));
  if t = '' then return ''; end if;

  if t = 'high school' then return 'High School'; end if;
  if t = 'vocational technical' then return 'Vocational / Technical'; end if;
  if t = 'some college' then return 'Some College'; end if;
  if t = 'associate degree' then return 'Associate Degree'; end if;
  if t = 'bachelors degree' then return 'Bachelor''s Degree'; end if;
  if t = 'masters degree' then return 'Master''s Degree'; end if;
  if t = 'doctorate degree' then return 'Doctorate Degree'; end if;

  if t ~ '\y(doctor|doctorate|doctoral|phd|edd|dba)\y' then return 'Doctorate Degree'; end if;
  if t ~ '\y(master|masters|mba|msc|ms|ma|postgrad|postgraduate|post graduate)\y' then return 'Master''s Degree'; end if;
  if t ~ '\y(bachelor|bachelors|baccalaureate|college graduate|bs|bsc|ba|ab|bse|bsed|beed|undergraduate degree)\y' then return 'Bachelor''s Degree'; end if;
  if t ~ '\y(associate|associates|aas)\y' then return 'Associate Degree'; end if;
  if t ~ '\y(vocational|technical|tesda|trade|nc ii|nc iii|nc iv)\y' then return 'Vocational / Technical'; end if;
  if t ~ '\y(some college|college level|undergraduate|undergrad|currently enrolled|ongoing)\y' then return 'Some College'; end if;
  if t ~ '\y(high school|highschool|senior high|junior high|shs|secondary|k 12|k12)\y' then return 'High School'; end if;
  return '';
end;
$$;

revoke all on function public.normalize_education_level(text) from public, anon;
grant execute on function public.normalize_education_level(text) to authenticated, service_role;

-- Existing accounts: the attainment lives in the account's user metadata. Text
-- that names a level is rewritten to it; text that names none is blanked, with
-- the original kept under highest_educational_attainment_legacy so nothing is lost.
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'raw_user_meta_data') then
    update auth.users
    set raw_user_meta_data = raw_user_meta_data
      || jsonb_build_object('highest_educational_attainment', public.normalize_education_level(raw_user_meta_data ->> 'highest_educational_attainment'))
      || case
           when public.normalize_education_level(raw_user_meta_data ->> 'highest_educational_attainment') = ''
             then jsonb_build_object('highest_educational_attainment_legacy', raw_user_meta_data ->> 'highest_educational_attainment')
           else '{}'::jsonb
         end
    where coalesce(raw_user_meta_data ->> 'highest_educational_attainment', '') <> ''
      and (raw_user_meta_data ->> 'highest_educational_attainment')
          is distinct from public.normalize_education_level(raw_user_meta_data ->> 'highest_educational_attainment');
  end if;
end;
$$;

-- Older education details kept on the candidate profile, as one object or a list of them.
do $$
begin
  if to_regclass('public.candidate_profiles') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'candidate_profiles' and column_name = 'education_json') then
    update public.candidate_profiles
    set education_json = case jsonb_typeof(education_json)
      when 'object' then education_json
        || jsonb_build_object('highest_educational_attainment', public.normalize_education_level(education_json ->> 'highest_educational_attainment'))
      else (
        select coalesce(jsonb_agg(
          case when jsonb_typeof(item) = 'object' and item ? 'highest_educational_attainment'
            then item || jsonb_build_object('highest_educational_attainment', public.normalize_education_level(item ->> 'highest_educational_attainment'))
            else item end
          order by ordinality), '[]'::jsonb)
        from jsonb_array_elements(education_json) with ordinality as t(item, ordinality)
      )
    end
    where education_json is not null
      and jsonb_typeof(education_json) in ('object', 'array')
      and education_json::text like '%highest_educational_attainment%';
  end if;
end;
$$;

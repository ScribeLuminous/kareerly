alter table public.candidate_profiles
add column if not exists education_json jsonb;

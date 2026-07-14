alter table public.candidate_profiles add column if not exists birthday date;
alter table public.candidate_profiles add column if not exists education_json jsonb;
alter table public.candidate_profiles add column if not exists certifications_json jsonb;

comment on column public.candidate_profiles.education_json is
  'Candidate education and legacy personal-detail fields retained for backward compatibility.';

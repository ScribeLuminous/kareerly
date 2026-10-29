-- Employment type preference for job recommendations (Step 3 and the
-- Preferences page): 'full-time', 'part-time', 'contract', 'temporary',
-- 'internship' or 'any' (no preference). A job of another type keeps its
-- Fit-Now or Aspiration place; the job detail marks the mismatch.
-- Safe to re-run.
alter table public.candidate_profiles add column if not exists preferred_employment_type text;

alter table public.candidate_profiles drop constraint if exists candidate_profiles_preferred_employment_type_check;
alter table public.candidate_profiles add constraint candidate_profiles_preferred_employment_type_check
  check (preferred_employment_type is null
    or preferred_employment_type in ('full-time', 'part-time', 'contract', 'temporary', 'internship', 'any'));

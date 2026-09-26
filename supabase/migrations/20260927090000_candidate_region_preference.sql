-- Region preference for job recommendations, kept separate from the work setup
-- preference. preferred_location_scope is 'anywhere', 'current' or 'region';
-- preferred_region is a region code from backend/app/services/ph_regions.py
-- (e.g. 'NCR', 'IV-A'), set when the scope is 'current' or 'region'.
alter table public.candidate_profiles add column if not exists preferred_location_scope text;
alter table public.candidate_profiles add column if not exists preferred_region text;

alter table public.candidate_profiles drop constraint if exists candidate_profiles_preferred_location_scope_check;
alter table public.candidate_profiles add constraint candidate_profiles_preferred_location_scope_check
  check (preferred_location_scope is null or preferred_location_scope in ('anywhere', 'current', 'region'));

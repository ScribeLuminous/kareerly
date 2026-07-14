alter table public.employer_profiles add column if not exists company_location text;
alter table public.employer_profiles add column if not exists company_website text;
alter table public.employer_profiles add column if not exists company_description text;
alter table public.employer_profiles add column if not exists contact_person_name text;
alter table public.employer_profiles add column if not exists contact_role text;
alter table public.employer_profiles add column if not exists contact_number text;

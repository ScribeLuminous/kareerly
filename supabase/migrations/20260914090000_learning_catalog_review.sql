-- No existing records are promoted to verified. Populate only after catalog review.
alter table public.learning_resources
  add column if not exists review_status text,
  add column if not exists reviewer text,
  add column if not exists source_evidence text,
  add column if not exists last_verified_at date,
  add column if not exists catalog_version text,
  add column if not exists credential_review_status text,
  add column if not exists credential_conditions text,
  add column if not exists credential_evidence text,
  add column if not exists certificate_cost text,
  add column if not exists prerequisites text;

-- Distinguish a credential from a plain course.
--
-- resource_type is uniformly 'Course/Certification' across the whole catalog and
-- therefore carries no information. Without this column the dashboard had no
-- honest basis for its "Certificate available" badge and fell back to the
-- ranking score, which is always positive -- so every resource claimed one.
--
-- Values are INFERRED from the resource title by
-- backend/app/services/credential_types.py, not supplied by the providers.
-- Re-run backend/scripts/backfill_credential_type.py after correcting titles.

alter table public.learning_resources
  add column if not exists credential_type text not null default 'course';

alter table public.learning_resources
  drop constraint if exists learning_resources_credential_type_check;

alter table public.learning_resources
  add constraint learning_resources_credential_type_check
  check (credential_type in (
    'exam_review',
    'professional_certificate',
    'industry_certification',
    'certificate_course',
    'course'
  ));

comment on column public.learning_resources.credential_type is
  'Inferred credential class. Only exam_review, professional_certificate, '
  'industry_certification and certificate_course award something a candidate '
  'can show an employer; course does not.';

create index if not exists learning_resources_credential_type_idx
  on public.learning_resources (credential_type);

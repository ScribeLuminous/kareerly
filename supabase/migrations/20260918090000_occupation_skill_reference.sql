-- Occupation and skill reference data: PSOC (PSA) occupations, ESCO skills and
-- occupations, and Kareerly's links between them.
--
-- Complete reference data is not the same as validated connections: every link
-- table carries review_status, and only 'reviewed' links should drive skill-gap
-- recommendations. Rows are loaded by backend/scripts/import_reference_data.py.

create extension if not exists pg_trgm;

create table if not exists public.reference_datasets (
  dataset_id text primary key,               -- e.g. 'psoc-2012', 'esco-v1.2.0'
  name text not null,
  version text not null,
  source_url text,
  retrieved_at timestamptz,
  source_sha256 text,                        -- hash of the raw download or API responses
  license_note text,
  notes text
);

create table if not exists public.psoc_groups (
  psoc_code text primary key,                -- 1 to 4 digits; the hierarchy is in the code
  level text not null check (level in ('major', 'sub_major', 'minor', 'unit')),
  title text not null,
  description text,
  parent_code text references public.psoc_groups (psoc_code),
  dataset_id text not null references public.reference_datasets (dataset_id)
);

create table if not exists public.esco_occupations (
  concept_uri text primary key,
  preferred_label text not null,
  alt_labels text,                           -- newline-separated, as ESCO publishes them
  isco_group text,                           -- ISCO-08 unit group, the bridge to PSOC
  esco_code text,
  description text,
  dataset_id text not null references public.reference_datasets (dataset_id)
);

create table if not exists public.esco_skills (
  concept_uri text primary key,
  preferred_label text not null,
  alt_labels text,
  skill_type text,                           -- 'skill/competence' or 'knowledge'
  reuse_level text,
  description text,
  dataset_id text not null references public.reference_datasets (dataset_id)
);

create table if not exists public.esco_occupation_skills (
  occupation_uri text not null references public.esco_occupations (concept_uri),
  skill_uri text not null references public.esco_skills (concept_uri),
  relation_type text not null check (relation_type in ('essential', 'optional')),
  dataset_id text not null references public.reference_datasets (dataset_id),
  primary key (occupation_uri, skill_uri)
);

create table if not exists public.psoc_esco_occupation_links (
  psoc_code text not null references public.psoc_groups (psoc_code),
  occupation_uri text not null references public.esco_occupations (concept_uri),
  method text not null,                      -- 'isco_code_match' or 'manual'
  evidence text,
  title_similarity numeric,
  review_status text not null default 'proposed' check (review_status in ('proposed', 'reviewed', 'rejected')),
  reviewer text,
  reviewed_at timestamptz,
  primary key (psoc_code, occupation_uri)
);

create table if not exists public.kareerly_skill_esco_links (
  skill_id text not null,                    -- Kareerly SK id from skills_reference.csv
  skill_uri text not null references public.esco_skills (concept_uri),
  method text not null,                      -- 'taxonomy_esco_uri', 'exact_label' or 'manual'
  evidence text,
  confidence numeric,
  review_status text not null default 'proposed' check (review_status in ('proposed', 'reviewed', 'rejected')),
  reviewer text,
  reviewed_at timestamptz,
  primary key (skill_id, skill_uri)
);

create index if not exists psoc_groups_parent_idx on public.psoc_groups (parent_code);
create index if not exists psoc_groups_title_trgm_idx on public.psoc_groups using gin (title gin_trgm_ops);
create index if not exists esco_occupations_isco_idx on public.esco_occupations (isco_group);
create index if not exists esco_occupations_label_trgm_idx on public.esco_occupations using gin (preferred_label gin_trgm_ops);
create index if not exists esco_skills_label_trgm_idx on public.esco_skills using gin (preferred_label gin_trgm_ops);
create index if not exists esco_occupation_skills_skill_idx on public.esco_occupation_skills (skill_uri);
create index if not exists psoc_esco_links_uri_idx on public.psoc_esco_occupation_links (occupation_uri);
create index if not exists kareerly_skill_esco_links_uri_idx on public.kareerly_skill_esco_links (skill_uri);

-- Public reference data: anyone can read, only the service role writes.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'reference_datasets', 'psoc_groups', 'esco_occupations', 'esco_skills',
    'esco_occupation_skills', 'psoc_esco_occupation_links', 'kareerly_skill_esco_links'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists "Anyone can read %s" on public.%I', table_name, table_name);
    execute format('create policy "Anyone can read %s" on public.%I for select using (true)', table_name, table_name);
  end loop;
end $$;

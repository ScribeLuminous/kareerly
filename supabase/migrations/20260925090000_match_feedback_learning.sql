-- Match feedback, versioned ranking models and reviewed skill discovery.
--
-- Candidates rate job matches (good/bad). A scheduled batch job
-- (backend/app/learning/jobs.py) reads the votes with the service role, fits a
-- small re-ranking model, evaluates it against the baseline and only promotes it
-- when it wins. Skill discovery proposes new skills and aliases; nothing enters
-- the runtime taxonomy until it is approved. See docs/feedback-learning.md.

-- ---------------------------------------------------------------------------
-- 1. One current vote per user and job.
-- ---------------------------------------------------------------------------
-- Context columns are the numeric signals the matcher showed, copied by the
-- backend from the user's own saved match history. No resume text, skill names
-- or contact details are stored here.
create table if not exists public.match_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id text not null check (char_length(job_id) between 1 and 200),
  job_source text not null default 'internal' check (job_source in ('internal', 'employer')),
  vote smallint not null check (vote in (-1, 1)),
  match_history_id uuid references public.match_history(id) on delete set null,
  match_category text not null check (match_category in ('Fit-Now', 'Aspiration')),
  rank_position integer check (rank_position between 1 and 1000),
  match_score numeric(6,4) check (match_score between 0 and 1),
  semantic_similarity numeric(6,4) check (semantic_similarity between 0 and 1),
  required_skill_coverage numeric(6,4) check (required_skill_coverage between 0 and 1),
  preferred_skill_coverage numeric(6,4) check (preferred_skill_coverage between 0 and 1),
  preference_alignment numeric(6,4) check (preference_alignment between 0 and 1),
  learning_readiness numeric(6,4) check (learning_readiness between 0 and 1),
  critical_missing_count integer check (critical_missing_count between 0 and 50),
  in_preferred_career_area boolean,
  job_category_id text,
  model_version text,
  ranker_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, job_id, job_source)
);

create index if not exists match_feedback_updated_idx on public.match_feedback(updated_at desc);
create index if not exists match_feedback_user_updated_idx on public.match_feedback(user_id, updated_at desc);

alter table public.match_feedback enable row level security;

drop policy if exists "Users can read own match feedback" on public.match_feedback;
create policy "Users can read own match feedback"
  on public.match_feedback for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own match feedback" on public.match_feedback;
create policy "Users can insert own match feedback"
  on public.match_feedback for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own match feedback" on public.match_feedback;
create policy "Users can update own match feedback"
  on public.match_feedback for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own match feedback" on public.match_feedback;
create policy "Users can delete own match feedback"
  on public.match_feedback for delete
  using (auth.uid() = user_id);

-- created_at is server-owned; updated_at always reflects the latest change, and
-- a burst of changes from one account is refused (training also caps each
-- account's influence, see backend/app/learning/ranking_training.py).
create or replace function public.guard_match_feedback_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    new.created_at := old.created_at;
    new.user_id := old.user_id;
  else
    new.created_at := now();
  end if;
  new.updated_at := now();
  if (
    select count(*) from public.match_feedback
    where user_id = new.user_id and updated_at > now() - interval '1 hour'
  ) >= 120 then
    raise exception 'MATCH_FEEDBACK_RATE_LIMIT' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists match_feedback_guard on public.match_feedback;
create trigger match_feedback_guard
  before insert or update on public.match_feedback
  for each row execute function public.guard_match_feedback_write();

-- ---------------------------------------------------------------------------
-- 2. Versioned ranking models and the log of every training run.
-- ---------------------------------------------------------------------------
-- No active row means the baseline composite ranking. Parameters are public
-- (feature weights only), so the matcher reads the active row with the anon key.
create table if not exists public.ranking_models (
  version text primary key,
  status text not null default 'candidate' check (status in ('candidate', 'active', 'rejected', 'retired')),
  model_type text not null default 'feedback_rerank_logistic_v1',
  params jsonb not null,
  metrics jsonb not null default '{}'::jsonb,
  training_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  retired_at timestamptz,
  created_by text not null default 'scheduled_job',
  notes text
);

create unique index if not exists ranking_models_single_active
  on public.ranking_models ((status)) where status = 'active';

create table if not exists public.ranking_training_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  trigger text not null default 'scheduled',
  outcome text not null check (outcome in ('promoted', 'kept_current', 'insufficient_data', 'failed', 'rolled_back')),
  reason text,
  candidate_version text,
  active_version_after text,
  metrics jsonb not null default '{}'::jsonb
);

create index if not exists ranking_training_runs_started_idx on public.ranking_training_runs(started_at desc);

alter table public.ranking_models enable row level security;
alter table public.ranking_training_runs enable row level security;

drop policy if exists "Anyone can read the active ranking model" on public.ranking_models;
create policy "Anyone can read the active ranking model"
  on public.ranking_models for select
  using (status = 'active');
-- ranking_training_runs has no client policies: service role only.

-- ---------------------------------------------------------------------------
-- 3. Skill discovery: proposals, their evidence, and approved additions.
-- ---------------------------------------------------------------------------
create table if not exists public.skill_candidates (
  id uuid primary key default gen_random_uuid(),
  normalized_label text not null unique,
  display_label text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  suggested_action text not null default 'review' check (suggested_action in ('new_skill', 'alias', 'review')),
  suggested_skill_id text,
  suggestion_similarity numeric(5,4),
  confidence numeric(5,4) not null default 0 check (confidence between 0 and 1),
  job_source_count integer not null default 0,
  profile_source_count integer not null default 0,
  company_count integer not null default 0,
  review_reasons text[] not null default '{}',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_skill_id text,
  reviewer uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text
);

create index if not exists skill_candidates_status_confidence_idx on public.skill_candidates(status, confidence desc);

-- Provenance. Job evidence keeps a short snippet of the public job text.
-- Profile evidence keeps only a salted hash of the account, never the text.
create table if not exists public.skill_candidate_evidence (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.skill_candidates(id) on delete cascade,
  source_type text not null check (source_type in ('job_structured', 'job_description', 'user_profile')),
  source_ref text not null,
  company_key text,
  extraction_method text not null,
  snippet text check (snippet is null or char_length(snippet) <= 240),
  seen_at timestamptz not null default now(),
  unique (candidate_id, source_type, source_ref)
);

create sequence if not exists public.skill_addition_id_seq start with 5001;

-- Approved additions are merged with backend/data/skills_reference.csv at
-- runtime. kind = 'skill' creates a new canonical skill (SK5001, ...);
-- kind = 'alias' adds another name for an existing skill.
create table if not exists public.skill_taxonomy_additions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('skill', 'alias')),
  skill_id text not null check (skill_id ~ '^SK[0-9]+$'),
  label text not null check (char_length(label) between 2 and 80),
  normalized_label text not null,
  category_id text,
  skill_category text,
  status text not null default 'active' check (status in ('active', 'retired')),
  source_candidate_id uuid references public.skill_candidates(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz not null default now(),
  retired_at timestamptz
);

create unique index if not exists skill_taxonomy_additions_active_label
  on public.skill_taxonomy_additions(normalized_label) where status = 'active';

alter table public.skill_candidates enable row level security;
alter table public.skill_candidate_evidence enable row level security;
alter table public.skill_taxonomy_additions enable row level security;

-- The approved taxonomy is public, like skills_reference.csv. Proposals and
-- their evidence are service-role only and reviewed through admin endpoints.
drop policy if exists "Anyone can read active taxonomy additions" on public.skill_taxonomy_additions;
create policy "Anyone can read active taxonomy additions"
  on public.skill_taxonomy_additions for select
  using (status = 'active');

-- Allocates the next new-skill ID for the backend's approval endpoint.
create or replace function public.next_skill_addition_id()
returns text
language sql
security definer
set search_path = public
as $$
  select 'SK' || nextval('public.skill_addition_id_seq')::text;
$$;

revoke all on function public.next_skill_addition_id() from public, anon, authenticated;
grant execute on function public.next_skill_addition_id() to service_role;

-- Candidate progress that used to live only in browser localStorage, so it
-- follows the candidate to every device and reaches the backend:
--
-- * Skill progress (Not started / In progress / Done) reuses
--   candidate_skill_progress, which resume uploads already write
--   (backend/app/main.py). skill_key is the key the dashboard stores a skill
--   under (taxonomy id, else the normalized name, upper-cased); rows the backend
--   writes leave it empty and the dashboard derives it from skill_id/skill_name.
-- * candidate_claimed_skills: gap skills the candidate says they already have
--   ("I already have this"). Self-reported, not verified.
-- * candidate_course_completions: courses the candidate marked as taken, and
--   whether proof was uploaded.
--
-- All three are owner-only: a candidate reads and writes only their own rows.

-- Skill progress -------------------------------------------------------------

alter table public.candidate_skill_progress add column if not exists skill_key text;
alter table public.candidate_skill_progress drop constraint if exists candidate_skill_progress_skill_key_check;
alter table public.candidate_skill_progress add constraint candidate_skill_progress_skill_key_check
  check (skill_key is null or char_length(skill_key) between 1 and 200);

-- One row per candidate and key, so the dashboard can upsert. Rows without a
-- key (written by the backend) are not constrained.
create unique index if not exists candidate_skill_progress_candidate_skill_key_idx
  on public.candidate_skill_progress(candidate_id, skill_key);

alter table public.candidate_skill_progress enable row level security;

drop policy if exists "Users can manage own candidate skill progress" on public.candidate_skill_progress;

drop policy if exists "Users can read own skill progress" on public.candidate_skill_progress;
create policy "Users can read own skill progress"
  on public.candidate_skill_progress for select
  using (auth.uid() = candidate_id);

drop policy if exists "Users can insert own skill progress" on public.candidate_skill_progress;
create policy "Users can insert own skill progress"
  on public.candidate_skill_progress for insert
  with check (auth.uid() = candidate_id);

drop policy if exists "Users can update own skill progress" on public.candidate_skill_progress;
create policy "Users can update own skill progress"
  on public.candidate_skill_progress for update
  using (auth.uid() = candidate_id)
  with check (auth.uid() = candidate_id);

drop policy if exists "Users can delete own skill progress" on public.candidate_skill_progress;
create policy "Users can delete own skill progress"
  on public.candidate_skill_progress for delete
  using (auth.uid() = candidate_id);

grant select, insert, update, delete on public.candidate_skill_progress to authenticated;
revoke all on public.candidate_skill_progress from anon;

-- Claimed skills -------------------------------------------------------------

create table if not exists public.candidate_claimed_skills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  skill_key text not null check (char_length(skill_key) between 1 and 200),
  skill_id text check (skill_id is null or char_length(skill_id) between 1 and 100),
  skill_name text not null check (char_length(skill_name) between 1 and 200),
  claimed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, skill_key)
);

alter table public.candidate_claimed_skills enable row level security;

drop policy if exists "Users can read own claimed skills" on public.candidate_claimed_skills;
create policy "Users can read own claimed skills"
  on public.candidate_claimed_skills for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own claimed skills" on public.candidate_claimed_skills;
create policy "Users can insert own claimed skills"
  on public.candidate_claimed_skills for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own claimed skills" on public.candidate_claimed_skills;
create policy "Users can update own claimed skills"
  on public.candidate_claimed_skills for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own claimed skills" on public.candidate_claimed_skills;
create policy "Users can delete own claimed skills"
  on public.candidate_claimed_skills for delete
  using (auth.uid() = user_id);

grant select, insert, update, delete on public.candidate_claimed_skills to authenticated;
revoke all on public.candidate_claimed_skills from anon;

-- Course completions ---------------------------------------------------------

create table if not exists public.candidate_course_completions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  resource_id text not null check (char_length(resource_id) between 1 and 200),
  status text not null check (status in ('completed', 'evidenced')),
  marked_at timestamptz not null default now(),
  -- The evidence upload that proves it, when status is evidenced.
  evidence_id text check (evidence_id is null or char_length(evidence_id) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, resource_id)
);

alter table public.candidate_course_completions enable row level security;

drop policy if exists "Users can read own course completions" on public.candidate_course_completions;
create policy "Users can read own course completions"
  on public.candidate_course_completions for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own course completions" on public.candidate_course_completions;
create policy "Users can insert own course completions"
  on public.candidate_course_completions for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own course completions" on public.candidate_course_completions;
create policy "Users can update own course completions"
  on public.candidate_course_completions for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own course completions" on public.candidate_course_completions;
create policy "Users can delete own course completions"
  on public.candidate_course_completions for delete
  using (auth.uid() = user_id);

grant select, insert, update, delete on public.candidate_course_completions to authenticated;
revoke all on public.candidate_course_completions from anon;

-- Server-owned columns -------------------------------------------------------

-- The owner and created_at never change; updated_at is the time of the last write.
create or replace function public.guard_candidate_progress_write()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    new.created_at := old.created_at;
    if tg_table_name = 'candidate_skill_progress' then
      new.candidate_id := old.candidate_id;
    else
      new.user_id := old.user_id;
    end if;
  else
    new.created_at := now();
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists candidate_skill_progress_guard on public.candidate_skill_progress;
create trigger candidate_skill_progress_guard
  before insert or update on public.candidate_skill_progress
  for each row execute function public.guard_candidate_progress_write();

drop trigger if exists candidate_claimed_skills_guard on public.candidate_claimed_skills;
create trigger candidate_claimed_skills_guard
  before insert or update on public.candidate_claimed_skills
  for each row execute function public.guard_candidate_progress_write();

drop trigger if exists candidate_course_completions_guard on public.candidate_course_completions;
create trigger candidate_course_completions_guard
  before insert or update on public.candidate_course_completions
  for each row execute function public.guard_candidate_progress_write();

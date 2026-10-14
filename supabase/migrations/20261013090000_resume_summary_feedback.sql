-- "Does this sound like you?" feedback on the "Your resume at a glance" card.
--
-- One current answer per user and resume version. resume_version identifies
-- the resume text the summary described (backend/app/services/resume_summary.py),
-- so an answer about one resume never counts for a newer one. Changing the
-- answer updates the row; updated_at is when the current answer was given.
-- The summary itself is filled in from fixed templates and is not stored.

create table if not exists public.resume_summary_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  resume_id uuid references public.resumes(id) on delete set null,
  resume_version text not null check (char_length(resume_version) between 1 and 100),
  summary_version text not null check (char_length(summary_version) between 1 and 100),
  rating text not null check (rating in ('yes', 'not_quite')),
  reasons text[] not null default '{}' check (
    reasons <@ array['missing_skills', 'wrong_experience_level', 'wrong_roles', 'not_like_me', 'something_else']::text[]
  ),
  comment text check (char_length(comment) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, resume_version),
  -- Reasons only explain a "Not quite".
  check (rating = 'not_quite' or (cardinality(reasons) = 0 and comment is null))
);

create index if not exists resume_summary_feedback_updated_idx on public.resume_summary_feedback(updated_at desc);

alter table public.resume_summary_feedback enable row level security;

drop policy if exists "Users can read own resume summary feedback" on public.resume_summary_feedback;
create policy "Users can read own resume summary feedback"
  on public.resume_summary_feedback for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own resume summary feedback" on public.resume_summary_feedback;
create policy "Users can insert own resume summary feedback"
  on public.resume_summary_feedback for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own resume summary feedback" on public.resume_summary_feedback;
create policy "Users can update own resume summary feedback"
  on public.resume_summary_feedback for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own resume summary feedback" on public.resume_summary_feedback;
create policy "Users can delete own resume summary feedback"
  on public.resume_summary_feedback for delete
  using (auth.uid() = user_id);

grant select, insert, update, delete on public.resume_summary_feedback to authenticated;
revoke all on public.resume_summary_feedback from anon;

-- created_at and the owner are server-owned; updated_at always reflects the latest answer.
create or replace function public.guard_resume_summary_feedback_write()
returns trigger
language plpgsql
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
  return new;
end;
$$;

drop trigger if exists resume_summary_feedback_guard on public.resume_summary_feedback;
create trigger resume_summary_feedback_guard
  before insert or update on public.resume_summary_feedback
  for each row execute function public.guard_resume_summary_feedback_write();

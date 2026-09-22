create table if not exists public.candidate_external_job_matches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_title text not null,
  company_name text,
  match_percentage numeric(5,2) not null default 0,
  result_json jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists candidate_external_job_matches_user_created_idx
  on public.candidate_external_job_matches(user_id, created_at desc);

alter table public.candidate_external_job_matches enable row level security;

drop policy if exists "Users can manage own external job matches" on public.candidate_external_job_matches;
create policy "Users can manage own external job matches"
  on public.candidate_external_job_matches
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function public.enforce_candidate_external_job_match_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Serialize inserts per user so concurrent requests cannot exceed the five-row cap.
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 0));
  if (
    select count(*)
    from public.candidate_external_job_matches
    where user_id = new.user_id
  ) >= 5 then
    raise exception 'MAX_EXTERNAL_JOB_MATCHES_REACHED'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists candidate_external_job_matches_limit on public.candidate_external_job_matches;
create trigger candidate_external_job_matches_limit
  before insert on public.candidate_external_job_matches
  for each row execute function public.enforce_candidate_external_job_match_limit();

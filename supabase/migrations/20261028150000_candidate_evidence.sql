-- Certificates and proof a candidate adds (a Credly badge link, a PDF's
-- details). They used to live only in the dashboard's memory, so a reload
-- emptied the list. Owner-only: a candidate reads and writes only their own rows.
--
-- The PDF file itself is not stored here (file_name only); a link is the whole
-- record. The id is made by the dashboard, and course_completions.evidence_id
-- refers to it.
create table if not exists public.candidate_evidence (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 300),
  evidence_type text not null default 'Certificate' check (char_length(evidence_type) between 1 and 50),
  related_skill text not null default '' check (char_length(related_skill) <= 500),
  category text not null default 'Other' check (char_length(category) <= 200),
  notes text not null default '' check (char_length(notes) <= 2000),
  file_name text check (file_name is null or char_length(file_name) <= 300),
  credential_url text check (credential_url is null or char_length(credential_url) <= 500),
  credential_provider text check (credential_provider is null or char_length(credential_provider) <= 100),
  credential_status text check (credential_status is null or credential_status in ('verified', 'unreachable', 'not_checked')),
  badge_name text check (badge_name is null or char_length(badge_name) <= 200),
  issuer text check (issuer is null or char_length(issuer) <= 200),
  status text not null default 'Pending Verification' check (status in ('Pending Verification', 'Verified')),
  uploaded_at date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists candidate_evidence_user_idx on public.candidate_evidence(user_id, uploaded_at desc);

alter table public.candidate_evidence enable row level security;

drop policy if exists "Users can read own evidence" on public.candidate_evidence;
create policy "Users can read own evidence"
  on public.candidate_evidence for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own evidence" on public.candidate_evidence;
create policy "Users can insert own evidence"
  on public.candidate_evidence for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own evidence" on public.candidate_evidence;
create policy "Users can update own evidence"
  on public.candidate_evidence for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own evidence" on public.candidate_evidence;
create policy "Users can delete own evidence"
  on public.candidate_evidence for delete
  using (auth.uid() = user_id);

grant select, insert, update, delete on public.candidate_evidence to authenticated;
revoke all on public.candidate_evidence from anon;

-- The owner and created_at never change; updated_at is the time of the last write.
create or replace function public.guard_candidate_evidence_write()
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

drop trigger if exists candidate_evidence_guard on public.candidate_evidence;
create trigger candidate_evidence_guard
  before insert or update on public.candidate_evidence
  for each row execute function public.guard_candidate_evidence_write();

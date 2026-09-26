-- Admin moderation: review state for message reports, and account deletion
-- requests that an administrator approves before the account is removed.
-- Both tables are written by the FastAPI backend with the service role after it
-- verifies the caller; clients only read their own deletion requests.

-- ---------------------------------------------------------------------------
-- 1. Review state for reports filed from message threads.
-- ---------------------------------------------------------------------------
alter table public.message_moderation_actions
  add column if not exists review_status text not null default 'open';
alter table public.message_moderation_actions
  drop constraint if exists message_moderation_actions_review_status_check;
alter table public.message_moderation_actions
  add constraint message_moderation_actions_review_status_check
  check (review_status in ('open', 'resolved', 'dismissed'));
alter table public.message_moderation_actions add column if not exists reviewed_at timestamptz;
alter table public.message_moderation_actions add column if not exists reviewed_by uuid references auth.users(id) on delete set null;
alter table public.message_moderation_actions add column if not exists admin_note text;

create index if not exists message_moderation_actions_reports_idx
  on public.message_moderation_actions(review_status, created_at desc)
  where action = 'report';

-- ---------------------------------------------------------------------------
-- 2. Account deletion requests.
-- ---------------------------------------------------------------------------
-- user_id is set to null once the account is deleted; the email and role
-- snapshots keep the approved request readable as an audit record.
create table if not exists public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  user_email text not null,
  user_role text not null check (user_role in ('candidate', 'employer')),
  reason text check (reason is null or char_length(reason) <= 2000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  admin_note text
);

create unique index if not exists account_deletion_requests_one_pending
  on public.account_deletion_requests(user_id) where status = 'pending';
create index if not exists account_deletion_requests_status_idx
  on public.account_deletion_requests(status, requested_at desc);

alter table public.account_deletion_requests enable row level security;

drop policy if exists "Users can read own deletion requests" on public.account_deletion_requests;
create policy "Users can read own deletion requests"
  on public.account_deletion_requests for select
  using (auth.uid() = user_id);

-- Report and block actions on application message threads. Rows are written by
-- the FastAPI backend with the service role after it verifies the caller is a
-- participant of the thread; clients never write here directly.
create table if not exists public.message_moderation_actions (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.job_applications(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  actor_role text not null check (actor_role in ('candidate', 'employer')),
  action text not null check (action in ('report', 'block', 'unblock')),
  reason text,
  details text,
  created_at timestamptz not null default now()
);

create index if not exists message_moderation_actions_application_idx
  on public.message_moderation_actions(application_id, created_at desc);

alter table public.message_moderation_actions enable row level security;

drop policy if exists "Participants can read own moderation actions" on public.message_moderation_actions;
create policy "Participants can read own moderation actions"
  on public.message_moderation_actions for select
  using (auth.uid() = actor_user_id);

-- Saved external analyses are profile-owned already. Add a durable identity so
-- retries and repeated clicks return one saved result instead of creating copies.
alter table public.candidate_external_job_matches
  add column if not exists analysis_fingerprint text;

create unique index if not exists candidate_external_job_matches_user_fingerprint_key
  on public.candidate_external_job_matches(user_id, analysis_fingerprint)
  where analysis_fingerprint is not null;

-- Candidate notifications are events, not a projection recreated by the UI.
create table if not exists public.candidate_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  application_id uuid references public.job_applications(id) on delete cascade,
  event_version text not null,
  title text not null,
  message text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique(recipient_user_id, event_type, application_id, event_version)
);

create index if not exists candidate_notifications_recipient_created_idx
  on public.candidate_notifications(recipient_user_id, created_at desc);

create index if not exists candidate_notifications_recipient_unread_idx
  on public.candidate_notifications(recipient_user_id, created_at desc)
  where read_at is null;

alter table public.candidate_notifications enable row level security;

drop policy if exists "Candidates can read own notifications" on public.candidate_notifications;
create policy "Candidates can read own notifications"
  on public.candidate_notifications for select
  using (auth.uid() = recipient_user_id);

drop policy if exists "Candidates can update own notifications" on public.candidate_notifications;
create policy "Candidates can update own notifications"
  on public.candidate_notifications for update
  using (auth.uid() = recipient_user_id)
  with check (auth.uid() = recipient_user_id);

-- Application state transitions create one durable event. The unique key makes
-- the trigger idempotent even if an update is retried with the same state.
create or replace function public.create_candidate_application_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_status text := lower(coalesce(new.status, ''));
  notification_title text;
  notification_message text;
begin
  if tg_op = 'UPDATE'
     and new.status is distinct from old.status
     and normalized_status in ('shortlisted', 'interviewing', 'hired', 'rejected') then
    notification_title := case normalized_status
      when 'shortlisted' then 'Application shortlisted'
      when 'interviewing' then 'Interview stage update'
      when 'hired' then 'Application successful'
      when 'rejected' then 'Application update'
    end;
    notification_message := coalesce(new.job_title, 'Your application')
      || case when nullif(new.company_name, '') is not null then ' at ' || new.company_name else '' end
      || case normalized_status
        when 'shortlisted' then ' was shortlisted.'
        when 'interviewing' then ' moved to interviewing.'
        when 'hired' then ' was marked hired.'
        when 'rejected' then ' was not selected.'
      end;

    insert into public.candidate_notifications (
      recipient_user_id, event_type, application_id, event_version, title, message, created_at
    ) values (
      new.user_id, 'application_status', new.id, normalized_status,
      notification_title, notification_message, coalesce(new.updated_at, now())
    ) on conflict (recipient_user_id, event_type, application_id, event_version) do nothing;
  end if;

  if tg_op = 'UPDATE'
     and new.message_request_state is distinct from old.message_request_state
     and lower(coalesce(new.message_request_state, '')) = 'pending' then
    insert into public.candidate_notifications (
      recipient_user_id, event_type, application_id, event_version, title, message, created_at
    ) values (
      new.user_id, 'message_request', new.id, 'pending', 'Pending message request',
      coalesce(new.company_name, 'An employer') || ' sent a message request for '
        || coalesce(new.job_title, 'your application') || '.',
      coalesce(new.updated_at, now())
    ) on conflict (recipient_user_id, event_type, application_id, event_version) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists job_application_candidate_notifications on public.job_applications;
create trigger job_application_candidate_notifications
  after update of status, message_request_state on public.job_applications
  for each row execute function public.create_candidate_application_notification();

-- Preserve the notifications candidates already see at migration time exactly
-- once; future page loads only read these rows.
insert into public.candidate_notifications (
  recipient_user_id, event_type, application_id, event_version, title, message, created_at
)
select
  app.user_id,
  'application_status',
  app.id,
  lower(app.status),
  case lower(app.status)
    when 'shortlisted' then 'Application shortlisted'
    when 'interviewing' then 'Interview stage update'
    when 'hired' then 'Application successful'
    else 'Application update'
  end,
  coalesce(app.job_title, 'Your application')
    || case when nullif(app.company_name, '') is not null then ' at ' || app.company_name else '' end
    || case lower(app.status)
      when 'shortlisted' then ' was shortlisted.'
      when 'interviewing' then ' moved to interviewing.'
      when 'hired' then ' was marked hired.'
      else ' was not selected.'
    end,
  coalesce(app.updated_at, app.applied_at, app.created_at, now())
from public.job_applications app
where lower(coalesce(app.status, '')) in ('shortlisted', 'interviewing', 'hired', 'rejected')
on conflict (recipient_user_id, event_type, application_id, event_version) do nothing;

insert into public.candidate_notifications (
  recipient_user_id, event_type, application_id, event_version, title, message, created_at
)
select
  app.user_id,
  'message_request',
  app.id,
  'pending',
  'Pending message request',
  coalesce(app.company_name, 'An employer') || ' sent a message request for '
    || coalesce(app.job_title, 'your application') || '.',
  coalesce(app.updated_at, app.applied_at, app.created_at, now())
from public.job_applications app
where lower(coalesce(app.message_request_state, '')) = 'pending'
on conflict (recipient_user_id, event_type, application_id, event_version) do nothing;

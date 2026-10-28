-- Employers can turn AI-drafted assessment reviews off for a job. It is on by
-- default; when off, the backend refuses to send any answer for that job to a
-- model and the review screen hides the button. Safe to re-run.
alter table public.employer_job_posts add column if not exists ai_review_enabled boolean not null default true;

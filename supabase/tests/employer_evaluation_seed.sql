-- Records that exist before the evaluation migration runs; the tests check
-- that they come through unchanged.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'employer1@example.com'),
  ('00000000-0000-0000-0000-0000000000e2', 'employer2@example.com'),
  ('00000000-0000-0000-0000-0000000000c1', 'candidate1@example.com'),
  ('00000000-0000-0000-0000-0000000000c2', 'candidate2@example.com')
  on conflict do nothing;
insert into public.profiles (id, role, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'employer', 'employer1@example.com'),
  ('00000000-0000-0000-0000-0000000000e2', 'employer', 'employer2@example.com'),
  ('00000000-0000-0000-0000-0000000000c1', 'candidate', 'candidate1@example.com'),
  ('00000000-0000-0000-0000-0000000000c2', 'candidate', 'candidate2@example.com')
  on conflict do nothing;
insert into public.employer_profiles (id, user_id, company_name) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000e1', 'Employer One'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000e2', 'Employer Two')
  on conflict do nothing;
insert into public.employer_job_posts (id, job_id, employer_id, job_title) values
  ('20000000-0000-0000-0000-000000000001', 'EMP-1', '10000000-0000-0000-0000-000000000001', 'Data Analyst'),
  ('20000000-0000-0000-0000-000000000002', 'EMP-2', '10000000-0000-0000-0000-000000000002', 'Nurse')
  on conflict do nothing;
insert into public.job_applications (id, user_id, job_id, status, match_score, matched_skills, missing_skills, message_request_state) values
  ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c1', 'EMP-1', 'pending', 57, '{SQL,Excel,Python,Tableau,Statistics}', '{R}', 'none'),
  ('30000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000c2', 'EMP-1', 'shortlisted', 81, '{SQL}', '{}', 'none'),
  ('30000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000c1', 'EMP-2', 'interviewing', null, '{}', '{}', 'accepted')
  on conflict do nothing;

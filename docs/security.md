# Security

## Supabase security advisor

`supabase/migrations/20261004090000_security_hardening.sql` addresses the
findings in the security advisor export of 2026-09-28. Apply it with the other
migrations, then re-run the advisor (Dashboard > Advisors > Security Advisor).

| Finding | What changed |
| --- | --- |
| `extension_in_public` (pg_trgm) | Moved to the `extensions` schema. The trigram indexes keep working. |
| `anon_security_definer_function_executable` (14 functions) | No SECURITY DEFINER function in `public` can be called with the anon key. Supabase grants EXECUTE to `anon` directly, so `revoke ... from public` was not enough on its own. |
| `authenticated_security_definer_function_executable`, trigger functions | `handle_new_auth_user`, `create_candidate_application_notification`, `enforce_candidate_external_job_match_limit`, `guard_match_feedback_write` and `log_application_stage_change` cannot be called through `/rest/v1/rpc` by anyone. Triggers still fire. |
| `get_job_applicant_counts` | Callable by `service_role` only. The backend reads it with the service key. |
| `auth_leaked_password_protection` | Dashboard setting, see below. |

Future functions in `public` are not executable by `anon` or `authenticated`
unless a migration grants it (`alter default privileges`). Every RPC the app
calls grants `authenticated` explicitly.

### Findings that stay on purpose

The advisor will keep reporting these signed-in RPCs under
`authenticated_security_definer_function_executable`. The app calls them, and
each checks `auth.uid()` and ownership before doing anything:

- `save_evaluation_rubric`, `save_evaluation_scorecard`, `get_application_evaluation`,
  `list_job_evaluation_summaries`, `set_application_stage`, `apply_assessment_template`,
  `send_candidate_assessment`, `get_employer_applicant_public_ids`: employer
  owns the job or application.
- `save_candidate_assessment`: candidate owns the assessment.
- `employer_owns_job_post`, `owned_job_post_for_application`: used inside RLS
  policies, so signed-in users must be able to execute them. They only answer
  about the caller's own jobs.

### Leaked password protection (manual)

1. Supabase Dashboard > Authentication > Sign In / Providers > Email.
2. Turn on **Prevent use of leaked passwords**.
3. Set the minimum password length to at least 8 and require letters and digits.

This checks new passwords against HaveIBeenPwned. It is available on the Pro
plan and above.

## Account roles

`profiles.role` decides who is an admin (`_require_admin_user` in
`backend/app/main.py`). Before this migration a signed-in user could:

- set `role = 'admin'` on their own profile through the REST API (the update
  policy allowed any column), or
- sign up with `role: "admin"` in user metadata, which the sign-up trigger
  copied into the profile.

Now clients can update only `first_name`, `last_name` and `updated_at` on their
profile, cannot insert profiles, and sign-up only accepts `candidate` or
`employer`. Only accounts whose role is `employer` can create an employer
profile. Admins are promoted with the service role.

After applying the migration, check that every admin is expected:

```sql
select id, email, created_at, updated_at from public.profiles where role = 'admin';
```

Demote any account that should not be there, and review
`employer_profiles` rows whose owner is not an employer:

```sql
select e.id, e.user_id, p.role from public.employer_profiles e
join public.profiles p on p.id = e.user_id where p.role <> 'employer';
```

## Personal data

- The repository has no real email addresses, passwords or keys. Test and
  seed data use reserved domains (`example.com`, `example.net`,
  `example.org`, `.test`). Resumes under `test-data/` are synthetic.
- `.env` files are ignored by git and none were ever committed. Only the
  `.env.example` templates are tracked, and they are empty.
- The backend's Supabase error responses no longer include constraint values
  such as `Key (email)=(...) already exists`, which could expose another
  user's email.
- `backend/app/services/supabase_jobs.py` and `supabase_learning_resources.py`
  fall back to the project URL and its publishable (anon) key when the
  environment does not set them. That key is public by design and ships in the
  frontend bundle; it grants only what RLS allows `anon`. Never put the
  service-role key, `MESSAGE_ENCRYPTION_KEY` or API tokens in code.

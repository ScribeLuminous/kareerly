# Match feedback learning and skill discovery

Kareerly improves in two ways as it gets more users and jobs:

1. **Ranking from feedback.** Candidates rate job matches *Good match* or *Bad match*. A scheduled
   job retrains a small re-ranking model from those ratings and activates it only if it beats the
   current ranking on recent ratings.
2. **Skill discovery.** A scheduled scan proposes new skills and aliases found in job posts and
   candidates' custom skills. An admin approves them, and approved skills work immediately with no
   code change.

This is a modest system with safeguards. It does not retrain the bi-encoder, and one rating never
changes what other candidates see.

## What runs automatically and what needs a person

| When | What happens | Automatic? |
| --- | --- | --- |
| A candidate selects *Good match* / *Bad match* | The backend saves one current vote per candidate and job, with context copied from that candidate's saved match history. Nothing else changes. | Yes |
| Every matching request | The matcher reads the active ranking model (cached for 5 minutes) and reorders jobs **within** Fit-Now and Aspiration. With no model, or on any error, it uses the baseline order. | Yes |
| Daily at 18:43 UTC (02:43 Manila), via GitHub Actions | **Ranking run:** filter and weight votes, fit a candidate model, compare it with the baseline and the current model on the newest votes, then promote it, keep the current one, or retire a current model that is now worse than the baseline. Every run is logged. | Yes, once the schedule's secrets are set |
| Same schedule | **Skill discovery scan:** extract phrases, remove anything already in the taxonomy, and store *pending* proposals with confidence and provenance. | Yes |
| Admin → *Learning & Skills* | Approve a proposal as a new skill or as an alias, or reject it. | **Needs review** |
| Admin → *Learning & Skills*, CLI, or env var | Roll back to the baseline or to an earlier model version. | **Manual** (automatic demotion is described above) |
| One-time setup | Apply the migration, set the secrets, and optionally configure an alternative scheduler. | **Manual** |

Optional auto-approval of skills is **off** by default (`KAREERLY_SKILL_AUTO_APPROVE=1` turns it on). Even
when it is on, it only covers new skills seen in at least 5 job posts from at least 3 employers, with
confidence ≥ 0.85, no near-match to an existing skill, and no review flags. Anything that comes only
from candidate profiles always needs a reviewer.

## Ranking from feedback

### What the model can and cannot change

- **Eligibility is unchanged.** `match_scoring.classify` still decides Fit-Now, Aspiration and Low
  Match. The ranker only reorders jobs inside each list and never moves a job between lists.
- **Percentages are unchanged.** `match_percentage` is still the composite skills/semantic score, not
  a hiring probability. The dashboard says so above the job matches.
- **The adjustment is bounded.** It is added to each list's existing primary sort key (match score for
  Fit-Now, preference alignment for Aspiration). The limit is ±0.10 as trained and ±0.15 at most,
  enforced when a model is loaded whatever the stored parameters say. A job 0.02 behind can move up;
  a job 0.40 behind cannot.
- **The dashboard keeps the backend order within each list.** It used to re-sort every match by
  percentage, which also overrode Aspiration's preference-alignment order. It now follows each
  match's `rank_position`. Saved results from before this change have no rank positions and keep the
  old order.
- Each response includes `metadata.ranker_version`, `metadata.ranking_signal` and
  `metadata.ranker_fallback_reason`. Each match includes `rank_position` and `ranking_adjustment`.

### Cold start

There is no active model until enough feedback exists, so the order is exactly the pre-feedback order.
The regression test `test_cold_start_order_is_the_previous_baseline_sort` checks this. A run reports
`insufficient_data` and writes no model unless the data has all of the following:

- votes from ≥ 10 candidate accounts (`KAREERLY_LEARN_MIN_USERS`)
- ≥ 100 *effective* votes after weighting (`KAREERLY_LEARN_MIN_VOTES`)
- ≥ 20 effective good votes and ≥ 20 effective bad votes
- an evaluation window with ≥ 30 votes from ≥ 5 accounts, with both good and bad votes

Even with enough data, the size of the adjustment grows gradually: it scales with `n / (n + 200)`
effective votes.

### Protection against noisy or manipulated votes

| Risk | Safeguard |
| --- | --- |
| One vote tipping the model | Saving a vote never touches models. Models change only in a batch run that passes the volume and evaluation gates. |
| One account voting a lot | Each account counts as at most 20 votes, and no account decides more than 10% of the evaluation. |
| One job attracting many votes | Each job counts as at most 10 votes. |
| Click-through voting (all good or all bad) | Accounts with ≥ 15 votes that are all the same are ignored. |
| Rapid flip-flopping | Votes changed in the last 60 minutes wait for the next run. |
| Bursts from one account | The database refuses more than 120 vote changes per account per hour (HTTP 429). |
| Votes on jobs never shown | A vote is accepted only for a job in the account's 5 most recent saved match histories, and the context is taken from there, not from the request body. |
| Employer/admin accounts | Only accounts with the `candidate` role are used for training. |
| Lucky evaluation | Promotion needs a mean AUC gain ≥ 0.01 (`KAREERLY_LEARN_MIN_AUC_GAIN`) **and** a bootstrap 10th percentile above zero (300 resamples). |
| Tampered model row | Parameters are validated on load: the feature list must match exactly, values must be finite, and bounds are clamped. Anything invalid falls back to the baseline. |

In tests, one account casting 600 votes designed to reward low preference alignment did not get a
model promoted in any of 24 seeded scenarios (recent burst or spread over time). **Known limitation:**
many coordinated fake candidate accounts can still add up. The per-account caps limit this, but
nothing detects sybil accounts. Watch the admin run log for unexpected promotions.

### Model and evaluation

- **Features** (all 0–1): match score, semantic similarity, required and preferred skill coverage,
  preference alignment, learning readiness, missing critical skills, list (Fit-Now/Aspiration), and
  whether the job is in the chosen career area. Unknown values are treated as neutral (0.5).
- **Model:** L2-regularised logistic regression (scikit-learn), fit with the vote weights above.
  Adjustment = `scale × (P(good) − mean P(good))`, clamped.
- **Split:** the newest 25% of vote *weight* is used for evaluation and the rest for training. Splitting
  by weight rather than row count prevents one busy account from filling the evaluation window.
- **Metric:** weighted AUC computed separately within Fit-Now and within Aspiration, then averaged by
  weight. Pairs across lists are not scored because the ranker cannot change them. The run compares
  the baseline, the candidate and the current active model.
- Every fitted model is stored in `ranking_models` with its metrics and data summary, including
  rejected ones. Every run is stored in `ranking_training_runs` with its outcome and reason.

### Rollback

Any of these works. Matching picks up the change within `KAREERLY_RANKER_CACHE_SECONDS` (default 300)
on other instances, and immediately on the instance that handled the admin request.

- **Admin UI:** *Learning & Skills* → *Roll back to baseline*, or select an earlier version to restore.
- **CLI:** `python -m backend.app.learning.jobs rollback` (baseline) or `... rollback --to rank-20261001-184300-ab12cd34`.
- **Kill switch:** set `KAREERLY_RANKER=baseline` on the backend and restart. This ignores the database entirely.
- **SQL:** `update public.ranking_models set status = 'retired', retired_at = now() where status = 'active';`

A daily run also retires the active model on its own if fresh votes show it is worse than the baseline
(bootstrap 90th percentile of the gain below zero). The run log records this as `rolled_back`.

### Data stored with each vote

`public.match_feedback` has one row per (user, job, source), with `created_at` and `updated_at`. It
stores the vote, list, rank position, the numeric signals above, the job category ID, the model and
ranker versions, and a reference to the `match_history` row. It stores **no resume text, skill names,
job text or contact details**. Row-level security limits every read and write to the owner, and
deleting an account deletes its votes. Removing a rating deletes the row.

## Skill discovery

**Sources**
- Active `internal_jobs` and `employer_job_posts`:
  - structured skill fields (strength 0.45)
  - short bullets under Skills/Requirements/Qualifications headings (0.30)
  - phrases such as "experience with X" or "proficient in X" (0.20)
- Candidates' custom skills in `user_skills` that have no taxonomy ID (0.10). These store no snippet,
  and the account appears only as a salted hash (`KAREERLY_EVIDENCE_SALT`).

**Normalization and dedup**
- Qualifiers ("advanced", "strong …skills") and parenthetical notes are stripped. Phrases must have
  1–4 words and 2–40 characters, and generic words and "N years" are dropped.
- Anything matching an existing name or alias in `skills_reference.csv` plus the approved additions is
  already known and is not proposed. The match covers exact, compact and simple plural forms.
- A phrase close to an existing name (similarity ≥ 0.86, or containing an existing name) is proposed as
  an **alias** for review. If it is close to several skills it is flagged `ambiguous_existing_match`.
- A free-text phrase that contains a better-supported proposal from the same scan ("Tableau dashboards"
  vs "Tableau") is folded into it.

**Confidence** is a noisy-OR over independent sources (the strongest mention per job or account). It is
capped at 0.60 when all job evidence comes from one employer and at 0.30 when all evidence comes from
candidate profiles.

**Review flags:** `low_confidence` (< 0.70), `profile_only`, `single_company`, `near_existing_skill`,
`contains_existing_skill`, `ambiguous_existing_match`.

**Approval**
- Approving creates a row in `skill_taxonomy_additions`, either a new skill with an ID from `SK5001`
  up, or an alias of an existing ID.
- The backend merges active additions into the taxonomy used by resume extraction, confirmed-skill
  validation, coverage and `/api/skills/search` within `KAREERLY_TAXONOMY_CACHE_SECONDS` (default 300),
  or immediately on the approving instance.
- A re-scan never overrides a decision. Rejected proposals stay rejected.
- An addition can never overwrite a CSV skill ID.
- To retire an addition, set its `status` to `retired` in SQL.

**What approval does not change**
- The bi-encoder's frozen input representation (training-time skill vocabulary).
- Existing job posts' `required_skill_ids`. Employers see the new skill in search when they edit a post.
- Learning resources. A new skill has no reviewed resource mapping until one is added.

## Deployment

1. **Apply the migration** `supabase/migrations/20260925090000_match_feedback_learning.sql`, using
   `supabase db push` or the Supabase SQL editor. It can be re-run safely.
2. **Backend (Google Cloud Run).** `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`
   are already needed for account and admin features. The only new setting you might want is
   `KAREERLY_LEARNING_JOB_TOKEN`. Optional settings:
   - `KAREERLY_RANKER=baseline`: kill switch
   - `KAREERLY_RANKER_CACHE_SECONDS`, `KAREERLY_TAXONOMY_CACHE_SECONDS`
   - `KAREERLY_EVIDENCE_SALT`: use the same value as the scheduler
   - `KAREERLY_SKILL_AUTO_APPROVE`
   - `KAREERLY_LEARN_MIN_USERS`, `KAREERLY_LEARN_MIN_VOTES`, `KAREERLY_LEARN_MIN_AUC_GAIN`
   - `KAREERLY_LEARNING_JOB_TOKEN`: at least 24 characters; enables `POST /api/internal/learning/run`

   Plain values can be set with environment variables. Keep secrets in Secret Manager:
   ```bash
   gcloud run services update SERVICE --region REGION \
     --update-env-vars KAREERLY_RANKER_CACHE_SECONDS=300 \
     --update-secrets KAREERLY_LEARNING_JOB_TOKEN=kareerly-learning-job-token:latest
   ```
   Each update creates a new revision. Every Cloud Run instance keeps its own copy of the active model
   and approved skills for up to 5 minutes, so admin changes reach all instances within that time.
3. **Schedule.** Pick one:
   - **GitHub Actions (recommended, already included).** `.github/workflows/learning-jobs.yml` runs
     daily and can be started by hand under *Actions → Learning jobs*. Add the repository secrets
     `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, plus `KAREERLY_EVIDENCE_SALT` if you set one.
     Without them the job logs `skipped` and does nothing. It talks to Supabase directly, installs only
     `backend/requirements-learning.txt`, and never needs the Cloud Run service to be awake.
   - **Cloud Scheduler calling the service.** Set `KAREERLY_LEARNING_JOB_TOKEN` on the service first.
     The service already allows unauthenticated requests because the website calls it directly, so
     the token header is what protects this endpoint.
     ```bash
     gcloud scheduler jobs create http kareerly-learning --location REGION \
       --schedule "43 18 * * *" --time-zone UTC \
       --uri "https://YOUR-SERVICE-URL.run.app/api/internal/learning/run" \
       --http-method POST \
       --headers "Content-Type=application/json,X-Learning-Job-Token=YOUR_TOKEN" \
       --message-body '{"job": "all"}' --attempt-deadline 600s
     ```
     The run happens inside the request, so it finishes before Cloud Run throttles CPU. A cold start
     adds the encoder warm-up to the first request, so keep the attempt deadline generous.
   - **Cloud Run Job with the same image.** No HTTP endpoint needed. The image is built from `backend/`,
     so the module is `app.learning.jobs` (not `backend.app.learning.jobs`):
     ```bash
     gcloud run jobs create kareerly-learning --region REGION --image IMAGE_URL \
       --command python --args=-m,app.learning.jobs,run-all,--trigger,cloud-run-job \
       --set-secrets SUPABASE_SERVICE_ROLE_KEY=supabase-service-role:latest \
       --set-env-vars SUPABASE_URL=https://YOUR-PROJECT.supabase.co
     ```
     Trigger it daily from Cloud Scheduler with *Cloud Run Job* as the target.
4. **Check** with `python -m backend.app.learning.jobs status` (`python -m app.learning.jobs status` inside the
   container), or in Admin → *Learning & Skills*.
   The first runs report `insufficient_data` until enough candidates have rated matches. This is
   expected.

## Verification

```bash
backend/.venv/bin/python -m pytest -q backend/tests/test_match_feedback.py \
    backend/tests/test_ranking_learning.py backend/tests/test_skill_discovery.py
bash supabase/tests/run_rls_tests.sh        # needs PostgreSQL server binaries
npm --prefix frontend test
```

`supabase/tests/run_rls_tests.sh` applies the migration twice to a throwaway PostgreSQL cluster, using
a small stand-in for Supabase's `auth.uid()` and roles, and checks the following:

- owners can read and change only their own votes
- one account cannot write or reassign another account's vote
- anonymous callers see nothing
- the rate limit and constraints hold
- only the active model and active additions are public
- proposals, evidence and run logs are service-role only
- votes are deleted with the account

## Known limitations

- The encoder is not retrained. Feedback adjusts ordering only; improving the semantic model remains an
  offline research task (`backend/models/`).
- Votes come only from jobs that candidates were shown near the top (position bias). `rank_position` is
  recorded so this can be corrected later, but it is not used yet.
- Evaluation pools each list across candidates rather than scoring each candidate's own list.
- Coordinated multi-account manipulation is limited by caps but not detected.
- Discovery uses deterministic rules and fuzzy matching, not a language model, so review quality depends
  on the evidence snippets shown to the admin.

# Skill gaps grouped by skill (2026-10-13)

Pipeline step 4 (deterministic skill-gap and learning-path generation) and the
candidate Skills page. Retrieval, reranking and match scoring are unchanged:
no score, list (Fit-Now or Aspiration) or job order moves.

Every rule below lives in `backend/app/services/skill_gap_config.py` and is
sent with each gaps response (`rules`), so the page shows exactly these.

## 1. Why every gap said "1 match" and "Moderate"

* Gaps came only from the top 10 Fit-Now and top 10 Aspiration matches
  (`TOP_FIT_NOW`, `TOP_ASPIRATION`) and the list was cut to 8
  (`MAX_PRIORITIZED_GAPS`), while the dashboard listed every match.
* "N matches" was the number of those 20 jobs missing the skill.
* Priority was Critical (must-have, or required by 3+ jobs), High (required by
  2) or Moderate (everything else). With each gap in one of the 20 jobs and no
  must-have gap (a Fit-Now job cannot miss one), every gap was Moderate.
* A second, weighted priority score in `learning_recommender.prioritize_skill_gaps`
  (0.35 frequency, 0.25 importance, 0.20 severity, 0.10 preference, 0.10
  resource availability) was a different rule; it now uses the tiers below.

## 2. Canonical skills

Each job's missing skills are resolved with matching's own resolver
(`matching_service._skill_key`): verified aliases from `data/skill_aliases.csv`
and merged ESCO duplicates (`skill_id_equivalents`). "SEO", "search engine
optimisation" and "Search Engine Optimization" are one skill (SK672). A skill
with no taxonomy entry is keyed `CUSTOM:<normalised name>`; two spellings of
such a skill stay separate until an alias is added. A skill a job lists as both
required and nice to have counts once, as required.

## 3. Scope ("Gaps from")

| Scope | Jobs |
|---|---|
| `default` | Fit-Now matches, plus saved and applied jobs |
| `fit_now` | Fit-Now matches |
| `saved` | Saved and applied jobs |
| `all` | All matches (Fit-Now and Aspiration) |

Saved and applied jobs count only when they are among the candidate's matches;
the rest have no missing-skill data, are left out and are counted
(`unmatched_saved_jobs`). Withdrawn applications do not count. A saved job is
identified by source and ID.

## 4. Tiers

Counts are over in-scope jobs. A skill takes the first tier whose rule it meets.

| Tier | Rule |
|---|---|
| Close these first | Required by 2 or more jobs |
| Worth doing next | Required by 1 job, or nice to have for 2 or more jobs |
| Nice extras | Nice to have for 1 job |

The same rule now orders the report's gap list (`matching_service.prioritize_skill_gaps`,
used by the onboarding report and its PDF), the report's learning list and the
older `learning_recommender.prioritize_skill_gaps`. Must-have no longer raises a
skill on its own; "severity" in those payloads now carries the tier label.

## 5. Order inside a tier

1. Jobs needing the skill (required + nice to have), most first.
2. Highest match % among those jobs, highest first.
3. Skill name A to Z, only so ties always come out the same way.

Impact meter (3 bars, from jobs needing the skill): 3+ jobs High (3 bars),
2 Medium (2), 1 Low (1).

## 6. What the page shows before anything is expanded

| Item | Limit |
|---|---|
| Close these first | 5 skills, then "Show N more" |
| Worth doing next | 3 skills, then "Show N more" |
| Nice extras | Heading, count and "Show N skills" only |
| Skill search box | Shown when more than 10 open gaps exist; while searching, tier limits are ignored, empty tiers are hidden and "No skills match" is shown |
| Learning: courses per skill | 3, then "Show N more courses" |
| Learning: skills with courses | 5 (and 5 filter chips), then "Show N more skills" |
| Learning: skills with no course | One compact block with a web-search link each, 5 rows then "Show N more" |

So with 30 or more open gaps at most 8 skill rows show by default. Every
"Show more" is a button with `aria-expanded` and `aria-controls`; it stays the
focused element when the list grows or shrinks.

## 7. Completed

A skill leaves the tier lists and joins **Completed · N** (collapsed, at the
bottom) when the candidate marks it Done or says "I already have this skill".
Each row has Undo. In the By Job view the same skill shows as a completed chip
on every card that needs it. The Learning tab stops suggesting courses for it.

* **I already have this skill**: added to the confirmed skill list once (a
  second click or an already claimed skill changes nothing), then matching is
  re-run once, which refreshes every match the skill touches. The 20-skill cap
  on confirmed skills still applies. Undo removes it and re-runs matching.
* **Done**: self-reported course or practice progress. It moves the skill to
  Completed everywhere but does not change match scores (a course mark is not a
  skill the resume shows). Undo sets it back to Not started.

Skill progress (Not started, In progress, Done) is saved per user in
`candidate_skill_progress` (keyed by `skill_key`), like course completions and
claimed skills, so it survives a reload and is the same on every device. See
migration `20261022090000_candidate_progress_sync.sql` and
`frontend/src/lib/candidateProgress.ts`. Re-uploading a resume does not reset
the saved status, percent or chosen course.

## 8. API

`POST /api/skills/gaps?group_by=skill|job&scope=default|fit_now|saved|all&include_courses=true|false`

Body (multipart field `payload`, JSON): `matches` (job ID and source, title,
company, match %, `fit_now`/`aspiration`, `missing_required`, `missing_nice`, as
matching returned them), `saved_jobs`, `applied_jobs`. Nothing is re-scored.

By skill, each row is
`{ skill_id, taxonomy_skill_id, skill_name, tier, tier_label, required_jobs, nice_jobs, jobs_needing, best_match_pct, impact_label, impact_bars, jobs: [{ job_id, job_source, title, company, match_pct, requirement: "required" | "nice_to_have", match_type: "fit_now" | "aspiration" }] }`.
By job, each card lists its gaps with `other_jobs` (the "+N" badge). The
response also carries `totals`, `scope_counts`, `all_skills` and, with
`include_courses`, `courses_by_skill`
(`learning_recommender.recommend_learning_resources_by_skill`: courses per skill,
`helps_matches`, `required_by`, `nice_for`, and a labelled web-search link).
Course eligibility rules are unchanged (`docs/learning-paths.md`).

A skill showing N jobs in By Skill appears in exactly those N cards in By Job
(tested in `backend/tests/test_skill_gap_aggregation.py`).

## 9. Your resume at a glance

`POST /api/resume/summary` fills fixed templates (`services/resume_summary.py`,
version `resume_summary_template_v1`); no language model writes it and no
resume text leaves Kareerly.

1. Skills: "Your resume shows N skills we recognise, led by A, B and C." (the
   extractor's priority order).
2. Experience level: the candidate's Step 3 job-level answer (entry, mid,
   senior); left out when unset. The resume is not read for a level.
3. Roles: the top 3 Fit-Now titles, or with no Fit-Now match the top 3
   Aspiration titles ("closest roles").

Feedback ("Does this sound like you?": Yes / Not quite, reasons Missing skills,
Wrong experience level, Wrong roles, Does not sound like me, Something else, an
optional comment up to 500 characters) is stored in `resume_summary_feedback`
(migration `20261013090000_resume_summary_feedback.sql`): user ID, resume
version (a hash of the resume text), summary version, rating, reasons, comment,
created and updated time. One current answer per user and resume version;
"Change answer" updates it, and an answer about one resume never applies to a
newer one. Row-level security limits each user to their own rows.

## 10. Not changed, and open points

* Retrieval, ranking and scoring are untouched. The code's reranker is the
  feedback logistic adjustment `feedback_rerank_logistic_v1`
  (`backend/app/learning/ranking_model.py`), not an EBM; describe it that way.
* The job detail's two suggested courses still come from the report's
  learning list (top 10 Fit-Now and top 10 Aspiration jobs).
* `cleanSkillDisplayName` (frontend) strips a leading "Sk" from any name
  ("Sketching" reads "etching"); the new Skills page does not use it for
  skill names, other views still do.

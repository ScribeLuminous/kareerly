# Learning recommendation audit (2026-09-27)

How Kareerly turns skill gaps into learning resources, what was wrong, what
changed and what still needs a decision. Follows `docs/skill-match-accuracy.md`
on branch `krly/skill-match-check-fix`. Recommendations stay deterministic;
no model or LLM chooses a resource.

## 1. Pipeline

| Step | Where | Notes |
|---|---|---|
| Candidate skills, job requirements, matched and missing skills | `matching_service.compute_skill_coverage` | See the skill-match review |
| Skill gaps (Skills page) | `POST /api/skills/gaps` → `skill_gap_aggregation.build_gap_report` | Every match's missing skills, regrouped by canonical skill for the chosen scope; tiers and order in `skill_gap_config.py` (see `docs/skill-gaps-by-skill.md`) |
| Skill gaps (report) | `matching_service.prioritize_skill_gaps` | Missing skills of the returned Fit-Now and Aspiration jobs only, grouped by canonical skill, in the same tiers and order |
| Gaps for learning | `learning_recommender.recommend_learning_resources_for_matches` | Every missing skill (required and nice-to-have) of the top 10 Fit-Now and top 10 Aspiration jobs, with the jobs that miss it |
| Skill → resource | `learning_recommender._recommend_for_gap` | 1. taxonomy skill ID in the resource's mapping; 2. otherwise the gap's name in the resource's title or provider skill list |
| Catalogue | Supabase `learning_resources`, else `backend/data/learning_resources.csv` | `resource_is_reviewed` (reviewer, evidence, date) or `resource_is_listable` (active, titled, provider link) |
| Learning tab | `learning_recommender.recommend_learning_resources_by_skill` (via `include_courses`) → Frontend `LearningPage` | Courses keyed by skill for the in-scope gaps, with how many matches each skill helps; the per-job dropdown was removed (2026-10-13) |
| Limited report | `main._apply_report_access_control` | First N resources |
| Pasted external job | `analyze_candidate_job_match` → same function | Gemma parses the posting and may word the match explanation; it never picks resources |

Mapping methods before this change: exact skill IDs (from the catalogue's
`skill_ids`), canonical names and a broad alias table (`related_skills` and
ESCO labels), the provider's listed skills, title words, and a **category
fallback** (any resource in the job's category). No semantic similarity or
hardcoded rules. There is no numeric recommendation score; the
`certification_score` and `recommendation_percentage` fields are always 0.

## 2. Problems found

On the bundled catalogue, for each of the 265 skills the reference jobs
require:

1. **Generated skill mappings were trusted.** Many catalogue `skill_ids` were
   assigned automatically. The Meta Social Media Marketing certificate is mapped to SQL,
   Bookkeeping, Classroom Management and Patient Assessment Support; the CPA
   board exam to Database Management; CISSP to Web Development; AWS Solutions
   Architect to Graphic Design. They were shown as "Catalog maps this
   resource to SQL".
2. **Placeholder courses were offered as real ones.** 220 rows
   (`status = Generated - Review Needed`) are titles such as "Certificate
   Pathway: SQL — Coursera" whose link is a provider search page, a home page
   or empty, and whose description ("Prototype curated learning resource …
   verify the exact provider course before final release") was generated from
   the mapping itself.
3. **Template skill lists.** 24 real certifications
   (`template_category_skills`) had their "skills you'll gain" filled from the
   category template (Microsoft Office Specialist: Excel "teaches" Document
   Management), and the name fallback read that list.
4. **Category fallback.** A gap with no mapped resource got up to three
   resources from the same job category ("Related training for roles that
   require …"): Trello and Procore got HR and PMP certificates, media
   planning got a graphic-design course. This filled an empty state with
   resources that do not teach the skill.
5. **Merging hid the weak reasons.** A resource found for several gaps was
   listed once with all their names. A category-only match for gap B then
   showed under B as if it taught B, because the best method of gap A was kept.
6. **Order ignored gap priority.** Resources were sorted by mapping method
   and resource ID, not by how important the gap is; a nice-to-have gap's
   course could come before a required one.
7. **Reasons were generic and not shown.** `why_recommended` said only
   "Catalog maps this resource to X", did not name the job, and the
   frontend never displayed it.
8. **Name resolution differed from matching.** Missing names were resolved
   with a broad alias table that ignores the reviewed exclusions ("Mocha"
   was JavaScript here but not in matching).
9. **Limited reports** (guest, initial) listed the first N resources of all
   20 jobs, including resources for jobs the report did not show.

## 3. Changes

| Change | Where |
|---|---|
| An unreviewed catalogue mapping counts only when the resource's own title, description or provider skill list names the skill, read by the same extractor and alias rules as resumes. Reviewer-verified resources keep their mapping | `learning_recommender._prepare_resources`, `matching_service.resource_skill_evidence` |
| Generated placeholders are not listable; template-filled skill lists are not evidence | `resource_is_listable`, `_provider_skill_list` |
| Category fallback removed: a gap with no resource that teaches it gets none | `_recommend_for_gap` |
| Gap names resolve to skill IDs exactly as matching resolves them; duplicate ESCO IDs map to the reviewed one | `matching_service.learning_skill_id`, `learning_recommendations_for` |
| Resources ordered by gap priority (required before nice-to-have, must-have, number of jobs), then mapping strength, then review status | `recommend_learning_resources_for_matches` |
| Each resource lists `gap_matches` (skill, ID, method, required or nice-to-have, job IDs and titles), a `why_recommended` for its top gap and `why_by_job` per job, for example: "Recommended because Power BI is a required skill for Data Analyst that your resume does not show; the provider's course details name Power BI." Every resource is `learning_relation: "direct"` | same |
| The limited report keeps only resources for the jobs it shows | `main._apply_report_access_control` |
| The learning page shows the reason for the selected job under each course (one line; no layout change) | `frontend/src/pages/candidate/LearningPage.tsx`, `model.ts`, `types/index.ts` |

### Before and after (bundled catalogue)

| Gap | Before | After |
|---|---|---|
| SQL | Google Data Analytics; Google Digital Marketing; **Meta Social Media Marketing** | Google Data Analytics; Meta Back-End Developer; IBM Back-End Development |
| Web Development | Google IT Automation with Python; **AWS Solutions Architect**; **CISSP** | Meta Front-End and Back-End Developer; Complete Full-Stack Web Development Bootcamp |
| Database Management | **CPA Board Exam**; **Meta Social Media Marketing**; a placeholder | none (no catalogue resource teaches it) |
| Bookkeeping | Intuit Bookkeeping; **CPA**; **CMA** | Intuit Bookkeeping; Bookkeeping Basics; QuickBooks ProAdvisor |
| Classroom Management | **Google Data Analytics**; **Meta Social Media**; a placeholder | Foundations of Teaching for Learning (2 courses); TESOL Certificate |
| Trello, ClickUp, Monday.com, Procore | HR and PMP certificates (category fallback) | none |
| React.js | Meta Front-End; IBM Full Stack; IBM Front-End | unchanged (each names React) |

Of the 265 required skills, 215 now have at least one resource that names
the skill, and 50 have none (before: 250 with a mapped resource, many wrong,
and 15 filled or left by the category fallback). The 50 are catalogue gaps:
Database Management, Records Organization, Training Facilitation, Market
Research, Packaging, Assembly Work, Trello, ClickUp, Monday.com, Procore,
Develop animations, Graphics editor software and several imported ESCO
marketing and finance skills.

Candidate resume from the skill-match review: 37 resources, first for Medical
Terminology (required by 4 of its matches), then Data Encoding, Event
Coordination and complaint handling; none for skills it holds.

## 4. Tests

`backend/tests/test_learning_recommendation_accuracy.py`, through the
production matcher and the bundled catalogue:

- Front-End Developer (holds HTML, CSS, JavaScript; missing React.js): only
  resources that name React; no Python, graphic design or Office courses.
- Data Analyst (holds Excel, SQL; missing Power BI): only Power BI resources;
  nothing about React.
- React or React.js held and required: no gap, no resource.
- Two jobs: each job's resources and reasons name its own gaps; React never
  appears for the Data Analyst.
- Every resource's gap is missing, never matched, for each job it cites.
- A gap with no teaching resource (Trello) gets none; no gaps, no resources.
- Required gaps come before nice-to-have ones; reasons name the job and the
  gap, contain no percentage, and scores stay 0.
- Each resource and title is listed once; limited reports keep their own jobs.
- Wrongly mapped certificates and placeholders are never recommended; real
  resources still are.

`test_learning_paths.py` was updated: placeholders and template skill lists
are not evidence, same-category resources are not recommended, and each
category needs at least 8 real listable resources (it needed 10, which only
K13 and K20 reached by counting placeholders).

## 5. Open items

1. **Catalogue review.** 1,551 of 1,659 catalogue mappings name their skill
   in the resource text, but naming is not proof of depth. Most rows are
   unreviewed (`review_status` empty). A reviewer pass that sets
   `review_status = verified` is what the recommender trusts fully. The 220
   placeholders need real course titles and links, or deletion. The 50 gaps
   above need resources.
2. **Supporting or prerequisite learning** (SQL fundamentals before MySQL,
   CPA review for bookkeeping) is not modelled. It needs a relation between
   resources and skills other than "teaches" (for example a
   `learning_relation` column: `direct` / `prerequisite`) and a UI label.
   Today every recommended resource is direct.
3. **Completed courses.** Completions are kept in the frontend
   (`courseCompletions`); the backend does not know them. A taken course
   stays in the list with a "Taken" badge, which is right while the skill is
   still a gap, since taking a course does not add the skill to the resume.
4. **Learning page fallback (frontend).** When the selected job has no
   resource, the page shows up to six reviewed resources "For your other
   matches". They are labelled as other jobs' resources, but they are not for
   the selected job; showing only the empty state would be stricter.
5. **Focus job.** Resources and reasons come from the same saved run as the
   jobs, and the page filters them per selected job, so they do not go stale
   when the focus changes. A saved run from an older backend still carries
   the old resources until matching is run again.
6. **Legacy code.** `learning_recommender.prioritize_skill_gaps`,
   `recommend_learning_resources` and `job_matcher.py` are not used by any
   endpoint; the category-based priority in them is unused.

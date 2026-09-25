# Why Fit-Now disappeared: matching diagnosis (2026-09-24)

Branch `krly/model-improvement`. All numbers below come from
`backend/scripts/diagnose_match_distribution.py` (33 mock Philippine resumes ×
184 catalogue jobs = 6,072 pairs). Reproduce them with:

```bash
backend/.venv/bin/python -m backend.scripts.diagnose_match_distribution \
    --output /tmp/kareerly-diag --must-have-mode all-required
```

## Labels used for diagnosis

`backend/evaluation/match_diagnostic_labels.csv` gives each resume its stated
target role and a title pattern. A pair is **strong** when the job title belongs
to that role family, **moderate** when it is another job in the same career
area, and **weak** otherwise (179 / 1,057 / 4,836 pairs). The labels use job
metadata only, never the model or skill coverage, so they can judge both.
They are weak labels, not human relevance judgements. Odd resume pages are the
development (calibration) split and even pages the held-out check split.

## Root cause

The problem was a combination of faults. The **dominant** one sat in the input
to the model, not in the model weights or the threshold.

1. **Skill extraction polluted every candidate profile (dominant).**
   `SkillExtractor` split the `;`-separated reference lists on commas as well.
   `related_skills` carries group labels such as "Education, Training, and
   Community Services", so the single word **"education"** became an alias for
   about 45 teaching and social-work skills. Every resume has an EDUCATION
   heading, so every candidate "had" skills such as Classroom Management,
   Library Assistance and "Perform street interventions in social work". The
   same happened with "healthcare", "construction" and other group words.
   Those names were appended to the model input's `[SKILLS]` section. Because
   the fine-tuned model was trained to match skill lists, it pulled every
   resume towards the education and training jobs. "Training and Instruction
   Coordinator" was in the top 10 for 30 of 33 resumes; for the software
   developer resume, the top job was Library Support Assistant. The test that
   covered this (`test_category_words_do_not_become_skills`) was already
   failing on `main`.
2. **The must-have rule silently required 100% coverage.** Supabase jobs and
   pasted external jobs copy one ID list into both `required_skill_ids` and
   `must_have_skill_ids`. The Fit-Now gate rejected any missing must-have, so
   in production the effective rule was "hold every required skill", not the
   documented 50%. This blocked 140 of 179 strong pairs on its own.
3. **Legacy job skill IDs could never be matched.** 36 of the 40 reviewed
   Supabase jobs still contain IDs such as `SK_EXCEL`, `SK_POWER_BI` and
   `SK_REPORTING`. These have no taxonomy row. Combined with (2), those jobs
   could never be Fit-Now.
4. **Every failure became Aspiration.** There was no lower category, so
   unrelated jobs were labelled Aspiration, and the Aspiration label carried no
   information.

The 0.45 Fit-Now threshold was **not** the cause. Once the inputs were clean,
the calibration below shows it is already near the optimum.

## Stage-by-stage evidence

A = original `main`; B = A plus only the extraction fix; C = this branch.
The "all-required" mode reproduces the Supabase and pasted-job mapping.

### 1. Model: fine-tuned cosine by group (median, p10–p90)

| | strong | moderate | weak | AUC strong/moderate | AUC strong/weak |
|---|---|---|---|---|---|
| A (polluted input) | 0.271 (0.09–0.49) | 0.136 (0.01–0.38) | 0.102 (0.00–0.26) | 0.730 | 0.814 |
| B, C (clean input) | 0.520 (0.22–0.73) | 0.169 (0.02–0.45) | 0.070 (−0.04–0.21) | 0.859 | 0.968 |

Fine-tuning did not compress the similarity scale. With clean input, strong
matches sit around 0.5–0.7 and unrelated jobs around 0.1, and the groups
separate well. The low, overlapping scores on `main` came from the input.

### 2. Retrieval quality (per resume, all 184 jobs ranked; relevant = strong, NDCG graded 2/1/0)

| Ranking signal | P@10 | R@10 | NDCG@10 | MRR@10 |
|---|---|---|---|---|
| A: fine-tuned cosine (production on `main`) | 0.146 | 0.297 | 0.364 | 0.271 |
| B: fine-tuned cosine, clean input | 0.400 | 0.798 | 0.856 | 0.865 |
| C: composite match score | 0.412 | 0.826 | 0.885 | 0.924 |
| TF-IDF on the same model inputs | 0.436 | 0.870 | 0.889 | 0.950 |

### 3. Composite score and categories

The composite score preserves and slightly improves the model's separation.
Strong vs weak AUC goes from 0.968 to 0.976 and strong vs moderate from 0.859
to 0.871. Final-score medians are 0.596 for strong, 0.086 for moderate and
0.033 for weak pairs.

Category counts by label:

| | strong: Fit / Asp / Low | moderate: Fit / Asp / Low | weak: Fit / Asp / Low |
|---|---|---|---|
| A, all-required | 7 / 172 / – | 11 / 1,046 / – | 37 / 4,799 / – |
| C, both modes | 98 / 53 / 28 | 72 / 248 / 737 | 1 / 138 / 4,697 |

What users see (top 10 of each list, 33 resumes, all-required mode):

- **Before (A):** 55 Fit-Now cards, 67% of them unrelated jobs; 330 Aspiration
  cards, 54% unrelated.
- **After (C):** 168 Fit-Now cards, 0.6% unrelated; 307 Aspiration cards,
  23% unrelated.

Two resumes (IT Support Specialist and Multimedia Producer) still have no
Fit-Now job, which is a valid outcome.

## Answers to the three required questions

- **Does the model separate strong, moderate and weak matches?** Yes, once its
  input is clean (strong vs weak AUC 0.968). On `main` it did not (0.814), but
  the cause was the extracted skill list, not the weights.
- **Does the scoring pipeline preserve that separation?** On `main` it did not.
  The must-have rule and legacy IDs removed almost all strong pairs, and every
  failure collapsed into Aspiration. The new composite score preserves the
  separation (AUC 0.976), and the categories now follow it.
- **Is the Fit-Now gate calibrated to this distribution?** Yes. See below; the
  cosine floor was kept at 0.45.

## Model findings

- Production uses the checkpoint `backend/trained_models/kareerly-bi-encoder`
  (`kareerly-skills-first-minilm-2026-09-10`). It is **fine-tuned** from
  `sentence-transformers/all-MiniLM-L6-v2`, with MultipleNegativesRankingLoss,
  3 epochs, batch size 16, learning rate 1e-5 and warmup ratio 0.1, and was
  selected on weak-dev NDCG@10 (`models/train_retriever_today.py`).
- Embeddings are L2-normalised, and score_jobs normalises again (a no-op for
  unit vectors). Cosine is clipped to [0, 1] once. No score is normalised twice
  or rescaled against the catalogue.
- **Pretrained baseline not evaluated here.** This environment cannot reach
  Hugging Face, and the training data and training report are not in the
  repository. Run the diagnostic with
  `--baseline-model sentence-transformers/all-MiniLM-L6-v2` on a machine with
  access to fill that row in.
- **On these labels the fine-tuned model does not beat TF-IDF** (NDCG@10 0.856
  vs 0.889). The labels come from job titles, and resumes state their target
  title, which favours lexical matching. Even so, this data gives no evidence
  that fine-tuning improved role-level retrieval, and the thesis should not
  claim it does. No retraining was done because the model separated the groups
  adequately once the inputs were fixed.
- Training review:
  - The data splits are resume-level with deduplicated job groups, and
    checkpoint selection uses dev only. No test leakage appears in the code.
  - Positives are weak IDF-weighted skill-overlap labels (skill cosine ≥ 0.45
    and ≥ 2 shared skills), and the evaluation uses the same labels. This is
    circular: it rewards skill-list matching and says nothing about role
    relevance.
  - The two prepared hard negatives per pair are never used; only anchor and
    positive reach the loss, so only in-batch negatives apply.
  - The synthetic ESCO sentence-to-skill pairs share batches with the
    resume-to-job pairs, which gives easy cross-task negatives.
  - These choices make the model depend heavily on the `[SKILLS]` section,
    which is why the extraction bug did so much damage.

## Threshold justification

| Threshold | Before | After | Evidence (dev split; check split in brackets) |
|---|---|---|---|
| Fit-Now minimum cosine | 0.45 | **0.45 (unchanged)** | F1 for strong pairs is 0.588 at 0.45 vs 0.612 at the best value, 0.40 (check: 0.528 vs 0.529). No weak pair passes at 0.45. The difference is within noise, so the value stays. |
| Fit-Now minimum required coverage | 0.50 (effectively 1.00 for Supabase/pasted jobs) | **0.50** | This is a product definition ("at least half of the required skills"). Sweeping 0.34–0.60 changes dev F1 by less than 0.02. The effective 1.00 came from the must-have bug, not from any decision. |
| Must-have rule | any listed must-have missing blocks Fit-Now | only must-haves singled out from the required list block Fit-Now, with a 0.10 score penalty each (maximum 0.20) | A must-have list identical to the required list carries no extra designation. |
| Aspiration minimum cosine | none (every failure became Aspiration) | **0.20** | Dev F1 optimum for related vs unrelated pairs (0.732; 0.25 scores 0.707). It ties for best on the check split (0.762). 3% of unrelated pairs pass. |
| Aspiration minimum held skills | none | **1** | Without a single shared skill there is no identifiable path to readiness. |

## Follow-up (2026-09-24): Fit-Now from the resume, Aspiration from preferences

Product rule: Fit-Now is decided by the skills on the uploaded resume; Aspiration
is decided by the Step 3 preferences and then compared with the resume.

- **Fit-Now** no longer uses preferences (it never did in scoring, but the
  documentation below still said the semantic floor was 0.45). The floor is now
  **0.30**: coverage of the required skills decides readiness and the cosine only
  rules out unrelated roles. On the mock-resume diagnostic (all-required mode)
  strong Fit-Now pairs rose from 107 to 123 of 179, moderate from 64 to 92 and
  weak from 4 to 8 of 4,841. Every one of the 33 resumes has at least one
  Fit-Now job, through the real upload flow (resume analyzer, Step 2 skills,
  `/api/matches/run-form`) and with production-shaped jobs (three must-have IDs,
  description without the responsibilities list).
- **Aspiration** is every job that is not Fit-Now and belongs to the career area
  chosen in Step 3 (by category name, legacy group name or K01–K24 code). It is
  ranked by alignment with job level, work setup and salary, then by the resume
  match score. Its skill gaps come from the resume. Jobs outside the chosen area
  are Low Match. With no career area, or a job without a category, the previous
  resume rule applies (cosine ≥ 0.20 and at least one held skill).
- Preference alignment now compares answers with job data properly: category
  names with commas map to their area (previously they never did), "unsure",
  "flexible" and "no preference" are ignored, "entry" matches "Junior" and
  "Entry to Mid Level", dashboard labels such as "Hybrid (mix of remote &
  office)" match "Hybrid", and salary ranges are compared numerically.
- **Fit-Now coverage raised from 50% to 75%** (product decision: Fit-Now
  should mean the resume already holds nearly all required skills). Most jobs
  list three required skills, so 2 of 3 (67%) no longer qualifies. With the
  0.30 floor, strong Fit-Now pairs go from 123 to 81 of 179, moderate from 92
  to 27 and weak from 8 to 1. Three resumes (IT Support Specialist, Sales
  Representative, Multimedia Producer) have no Fit-Now job and see only
  Aspiration matches.
- `debug_summary.fit_now_blockers` counts, per rule, how many jobs missed
  Fit-Now, and the same counts are logged, so an empty Fit-Now list in
  production can be explained from the response.

## Follow-up (2026-09-25): skills the resume shows reported as gaps

Symptom: a Step 4 report listed "Order Processing" as missing for a resume
that says "order fulfillment", and a Customer Service Representative match
showed neither matched nor missing skills.

The scorer in this flow is the fine-tuned bi-encoder plus canonical skill
coverage (`/api/matches/run-form` → `match_text_to_jobs` → `score_match`); no
TF-IDF model runs. The causes, reproduced with a synthetic resume and
production-shaped jobs (`backend/tests/test_job_match_evidence.py`):

1. **DOCX text was lost.** `extract_text_from_docx` read only
   `Document.paragraphs` and top-level table cells, dropping content controls
   (`w:sdt`), nested tables, text boxes and headers. A line inside a content
   control never reached skill extraction or matching. Every `w:p` is now read
   in order (text boxes once), on both the analyzer and report routes. PDFs
   with a text layer were already read correctly.
2. **"Order Processing" had no taxonomy skill.** Jobs send it as the legacy
   ID `SK_ORDER_PROCESSING`, which resolved to the free-text name and matched
   only the literal words "order processing". SK693 Order Processing now
   exists, and `backend/data/skill_evidence_relations.csv` records reviewed,
   one-way relations: order fulfillment shows order processing (fulfilling an
   order includes processing it); the reverse does not hold, and purchase
   orders are unrelated. Relations are checked against the resume and the
   names the candidate confirmed, so an accepted skill is never also missing.
   Because gaps are counted from each match's missing skills, the fix also
   removes the entry from "Skill Gaps to Work On".
3. **Jobs without comparable requirements looked like clean fits.** A job
   with no skill IDs or names (or only IDs missing from the taxonomy) showed
   no matched and no missing skills, an explanation about "no major required
   skills", and a percentage that was role similarity alone. Unnamed IDs no
   longer count toward coverage, and such matches carry
   `skill_requirements_available: false` and `score_basis:
   "role_similarity_only"`, which Step 4 and the explanations state plainly.

The 20-skill Step 2 limit was checked: requirements are also credited when
the skill's label or curated spelling appears in the resume text, so skills
ranked past 20 are not reported missing for that reason. "Onboarding" and
"Chat Support" stay gaps unless the resume names them (for example "client
onboarding" or "live chat"). `SK_ONBOARDING` is left as a name because it
means customer onboarding in some jobs and employee onboarding in others.

## Follow-up (2026-09-25): an executive assistant resume with zero Fit-Now

Symptom: a Step 4 report for an executive/administrative assistant resume that
names Help Scout and HubSpot showed zero Fit-Now matches, listed "HelpScout"
and "HubSpot CRM" as gaps, and showed customer-success jobs as Aspiration
although the chosen career area was "Engineering, Trades & Operations".

The path was traced with the resume, the report's five jobs (rebuilt from
the report and from `data/skill_id_review/2026-09-20_job_skill_ids.sql`) and
the fine-tuned bi-encoder (`backend/tests/test_named_tool_report.py` keeps a
synthetic copy without personal details).

1. **The report came from an older backend.** Current `main` already credits
   "HelpScout" and "HubSpot CRM" (taxonomy SK645 and SK642, spelling and
   qualifier matching, resume-text evidence). The report also showed
   "Sales OPS" (now SK648 Sales Operations), a job with no skills described
   as having no gaps (now `skill_requirements_available: false`). Those are
   behaviours of a backend older than PR #44 (merged 10:09 +08:00, report
   generated 12:31), while the frontend already had the Step 4 PDF, so the
   deployed API was behind the frontend. Customer-service jobs shown as
   Aspiration under an engineering area are Low Match since PR #40 unless
   the job has no category. Redeploy the backend.
2. **Step 2 dropped named tools the resume repeats.** The extractor
   de-duplicated repeated mentions before counting them, so HubSpot (named
   three times) had the same evidence as a word named once; ties then sorted
   Z to A, and "CORE SKILLS" / "RELEVANT EXPERIENCE" were not recognised as
   headings, so no skill got the skills-section weight. HubSpot ranked 24th
   and fell outside the 20-skill limit. Every mention now counts once
   (`full_text` only, since sections are slices of it), ties go to the more
   frequent then earlier skill, and headings may carry a qualifier word.
   HubSpot now ranks 6th. Coverage was not affected by the limit because the
   resume text is also checked.
3. **Two requirements the resume shows were still gaps.** SK058 Clinical
   Documentation is defined as maintaining accurate patient and clinical
   records (Supabase jobs asking for "Patient Records" were reviewed to it),
   and SK300 is using CRM software, which HubSpot is. Reviewed one-way
   relations in `data/skill_evidence_relations.csv` now credit "maintained
   (accurate) patient records" and named CRM products or "CRM systems". A
   bare mention of patient records or of "CRM" does not count.

Zero Fit-Now is still correct for the report's five jobs. Fit-Now needs 75%
of the required skills and a role similarity of at least 0.30:

| Job | Required skills held | Blocking rule |
|---|---|---|
| Customer Success Associate | 2 of 3 (Onboarding missing) | coverage |
| Customer Success Specialist (SaaS) | 6 of 10 (Customer Success, Jira, Problem Solving, SaaS missing) | coverage |
| Sales Operations Analyst | 1 of 3 (Microsoft Excel, Sales Operations missing) | coverage |
| Account Manager | 1 of 3 (Account Management, Negotiation missing); similarity 0.18 | coverage, similarity |
| Customer Service Representative | lists no skills | no required skills |

Microsoft 365 is not taken as Excel, and customer support or patient intake is
not taken as onboarding or customer success. Of the reviewed Supabase jobs,
KJ-0055 (Scheduling, Patient Records, Customer Service) now has every
required skill held and becomes Fit-Now if its role similarity is at least
0.30; its posting text was not available here to check.

The career area never changes Fit-Now or the matched and missing skills; it
decides Aspiration. Under the legacy "Engineering, Trades & Operations" area
the customer-service and sales jobs are Low Match; a job with no category
(the Customer Service Representative) falls back to the resume rule under
any area.

## Career areas (2026-09-25)

Step 3 now offers 13 areas, each mapped to K01-K24 job categories in
`CAREER_AREA_JOB_CATEGORIES` and to example canonical skills in
`frontend/src/lib/careerAreas.ts` (a skill may belong to several areas). The
examples only help a candidate choose; matching uses the skills confirmed in
Step 2. The former broad areas "Education, Health & Community" and
"Engineering, Trades & Operations" remain valid saved values and match every
area they used to cover (`LEGACY_CAREER_AREAS`), and a preference saved as its
label resolves to its area.

## New matching logic

```
semantic   = clip(cosine, 0, 1)
required   = matched required skills / required skills   (canonical, deduplicated)
preferred  = matched preferred skills / preferred skills (excluding skills already required)
score      = (0.45·semantic + 0.45·required + 0.10·preferred) / (weights of the components present)
             − 0.10 per missing critical skill (maximum 0.20)

Fit-Now    : required skills listed AND required ≥ 0.75 AND semantic ≥ 0.30 AND no critical skill missing
Aspiration : not Fit-Now AND job in the Step 3 career area
             (no area known: semantic ≥ 0.20 AND ≥ 1 skill held, or the job lists no skills)
Low Match  : otherwise; scored, but excluded from the recommendation lists
Closest    : only when no job is Fit-Now: up to 5 non-Fit-Now jobs with ≥ 1 held
             required skill and semantic ≥ 0.20, by composite score; if none
             qualifies, the single best-scoring job, marked weak (see below)
```

Lists are ranked by the composite score, then cosine, coverage, preference
alignment and learning readiness as tie-breakers.

Previous logic, for comparison:

```
Fit-Now : required skills listed AND cosine ≥ 0.45 AND coverage ≥ 0.50 AND no must-have missing
else    : Aspiration
ranking and match_percentage: cosine only
```

## Cached and stored embeddings

- No embeddings are persisted, either in Supabase or on disk.
- Job vectors are cached in process memory only, keyed by the model version,
  the checkpoint path and the exact job input text. An edited job, a new job or
  a different checkpoint therefore never reuses old vectors.
- Candidate vectors are computed per request, so a changed profile or resume is
  always re-encoded.
- Stale embeddings are not a factor.
- Saved dashboard reports keep the categories computed when they were saved.
  They update when the candidate reruns matching.

## Frontend

`SnapshotStep.tsx` used to relabel backend Aspiration results under 60% (and
any 0% result) as "Partial Match", which was a second category rule in the UI.
It now shows the backend's `match_category`/`match_type`, falling back to the
list a result came from for older saved reports.

## Known limitations and follow-ups

- Some reference jobs list implausible required skills. For example, "Software
  Developer" requires Animal Care and Bookkeeping, which lowers coverage for
  genuine candidates. The job data needs review.
- 41 legacy `SK_*` IDs remain in Supabase jobs. They are now matched by name,
  but mapping them to taxonomy IDs would be better.
- Philippine mobile numbers (0917-…) are not redacted from the model input's
  evidence text.
- The labels here are weak metadata labels. The planned human-judged
  development and test collection should replace them before the thresholds
  are frozen for Chapter 4.

## Follow-up (2026-09-25): zero Fit-Now and no relevant recommendation

Symptom: the same executive/administrative assistant resume, now with the
Step 3 career area "Communications & Creative Media", produced a report with
zero Fit-Now matches. The Aspiration list held nothing the resume supports.

**Live path.** The frontend calls `/api/matches/run-form`, which runs
`run_matches`, then `matching_service.match_text_to_jobs`, then
`match_scoring.score_match`. Jobs come from Supabase `internal_jobs` and
`employer_job_posts` (active or open, deadline not passed); the bundled
`reference_jobs.csv` is used only when Supabase returns no job.
`job_matcher.py` only serves `/api/jobs/list`; its TF-IDF `JobMatcher` is not
used by any matching route.

**Reproduction.** The resume went through the real analyzer and matcher with
the fine-tuned bi-encoder, against the 184-job CSV catalogue (Supabase is not
reachable from the test container). The result was 0 Fit-Now:
`fit_now_blockers` = `required_skill_coverage` 184 and `semantic_similarity`
177. Aspiration held 17 creative jobs. The top ten, which the ranker orders by
preference alignment first, have role similarity 0.00–0.19, and nine of them
hold none of their required skills. The ten jobs that scored best against the resume
were all Low Match and hidden. They included Sales Manager (0.40), Customer
Success Manager (0.37), Customer Service Representative (0.37), Account
Executive (0.36) and Medical Records Assistant (0.33).
`backend/tests/test_fit_now_fallback.py` keeps a synthetic version.

Root cause:

1. **No fallback when Fit-Now is empty.** Aspiration follows the career area
   by design, so when the chosen area holds nothing the resume supports and
   nothing reaches Fit-Now, every job related to the resume is Low Match. The
   candidate then sees no relevant job even though several exist.
2. **Resume evidence missing from reviewed relations.** "Office software" was
   not credited from Microsoft 365 or Google Workspace, and "Document
   Management" was not credited from "Document & Records Organization". The
   Executive Assistant job held 0 of 5 required skills.
3. **pandas 3 skipped CSV cleaning.** pandas is unpinned; pandas 3 reads text
   as the `str` dtype, so `safe_read_csv` (which only cleaned `object`
   columns) left blank cells as NaN and titles with line breaks, such as
   "Customer Success\nManager".
4. **Few match-ready jobs for this profile.** The CSV has five Office
   Administration (K05) jobs. The 24 JobStreet snapshot rows carry no source
   link, and Supabase jobs list about three required IDs each, many of them
   legacy `SK_*` names.

The report also listed HelpScout and HubSpot CRM as gaps and used the
"Sales OPS" label. The current code already handles both, so the deployed
API is probably still older than this branch (see the previous follow-up).

Changes:

- **Closest Match.** When no job is Fit-Now, `closest_matches` lists up to
  five jobs nearest to it. A job qualifies when the resume holds at least one
  of its required skills and the role similarity reaches the Aspiration
  floor, and the list is ranked by composite score regardless of career area.
  Each item is labelled `Closest Match`. It keeps `base_match_category` and
  `failed_fit_now_rules`, and its `match_reason` states which rule failed
  ("shows 2 of 3 required skills; Fit-Now needs at least 75%", "a must-have
  skill named by the employer is missing"). Fit-Now rules are unchanged. If
  no job qualifies, the single best-scoring job is returned with
  `closest_match_strength: "weak"` and a reason saying it shares little with
  the resume. A closest match leaves the Aspiration list, so each job appears
  once. Gap counts (`appears_in_closest`), learning resources,
  `total_qualifying_matches`, `debug_summary.closest_count` and the guest,
  initial and full access limits all include it.
- **Catalogue status.** `catalog_status` reports `available`, `empty` or
  `unavailable` with a plain message, and `recommendation_notice` repeats it.
  An empty or unreadable catalogue returns empty lists and no encoder call,
  never a made-up result.
- **Reviewed relations.** SK186 Office software is credited from Microsoft
  365, Microsoft Office, MS Office, Google Workspace and G Suite (never as
  Microsoft Excel). SK016 Document Management is credited from "document
  and/or & records organization". A bare mention of documents does not count.
- **CSV cleaning** now covers the pandas 3 `str` dtype.
- **Frontend.** Step 4 and its PDF show "Closest opportunities (not Fit-Now)"
  under the empty Fit-Now list, and the summary names the closest opportunity
  without calling it Fit-Now. The dashboard lists closest matches with the
  badge "Closest Match". Match feedback is hidden for them, because
  `match_feedback.match_category` only allows Fit-Now and Aspiration.

After the change, the reproduction still has 0 Fit-Now, which is correct. It
now shows five related closest matches (Sales Manager, Customer Success
Manager, Customer Service Representative, Account Executive, Library
Assistant), each with the rule it failed.

Jobs were not added. Every job board and jobs API (JobStreet, Indeed,
Glassdoor, Adzuna, Greenhouse, Lever, Kalibrr, PhilJobNet) was blocked from
the working environment, so no posting could be opened to verify it, record
its date or map its skills from its text. See `docs/job-listings-api.md` for
sourcing more jobs.


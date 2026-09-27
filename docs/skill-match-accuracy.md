# Skill match accuracy review (2026-09-26)

Why Kareerly showed candidates as holding skills they do not have (and the
reverse), what was changed, and what still needs a data or product decision.
Branch: `krly/skill-match-check-fix`. Matching architecture, the fine-tuned
bi-encoder and every score threshold are unchanged.

## 1. The pipeline as implemented

| Step | Where | What decides it |
|---|---|---|
| Resume upload and text | `resume_parser.extract_resume_document`, `resume_analyzer.prepare_resume_text` | PDF/DOCX/DOC readers, OCR |
| Candidate skill extraction (Step 1/2) | `skill_extractor.SkillExtractor._find_alias_matches`, `resume_analyzer.extract_resume_skills` | Exact phrase match against every taxonomy row's name, ESCO preferred and alternative labels, `related_skills` and approved aliases (longest first), joined spellings, upper-case abbreviations |
| Normalization | `skill_extractor._normalize_alias`, `matching_service.normalize_for_match`, `skill_variants.py` | Lower case, punctuation to spaces, reviewed spellings (`data/skill_name_variants.csv`) |
| Confirmed skills | Frontend Step 2 → `confirmed_skills` / `removed_skill_ids` → `matching_service._prepare_candidate_context` | Confirmed skills are held as given; every other skill the resume shows is held too; removed ones never are |
| Candidate representation | `resume_evidence.candidate_model_inputs` | Profile input plus section windows |
| Job source | `supabase_jobs.load_internal_jobs_dataframe` (Supabase `internal_jobs`, `employer_job_posts`); `data/reference_jobs.csv` only when Supabase returns nothing | `must_have_skill_ids` is used as the required list |
| Pasted job parsing | `external_job_analysis.analyze_external_job` | Gemma extracts requirement names (fallback: the resume extractor over the description); names are resolved to taxonomy IDs |
| Requirement resolution | `matching_service._skill_key`, `canonical_skill_lookup` | Canonical ID, label, curated aliases, ESCO labels of `mapped` rows, reviewed variants; otherwise a named `CUSTOM:` requirement |
| Similarity | `matching_service.bi_encoder_score_jobs` → `bi_encoder_service.score_jobs` | Fine-tuned all-MiniLM-L6-v2 cosine, max over resume sections (offset 0.125) |
| Skill possession per requirement | `matching_service.compute_skill_coverage` | Held skill ID → reviewed resume-text names → upper-case abbreviations → reviewed one-way relations (`data/skill_evidence_relations.csv`). **No embeddings** |
| Fit-Now / Aspiration | `match_scoring.score_match` / `classify` | Fit-Now: required coverage ≥ 0.75, cosine ≥ 0.30 (or the resume names the role), no critical skill missing. Aspiration: chosen career area, else cosine ≥ 0.20 and a shared skill |
| Matched / missing / evidence | `_score_single_normalized_job`, `_matched_skill_evidence`, `_missing_skill_status` | From the one coverage result |
| Skill gaps | `matching_service.prioritize_skill_gaps` (returned jobs only) | Missing skills of returned jobs |
| Learning, explanation | `learning_recommender`, `grounded_explanation` (Gemma may reword a pasted job's explanation; never the score) | Reviewed skill-ID mappings |

Semantic similarity is used only for the job-level cosine. It is never used to
decide whether a candidate holds a skill. Semantic similarity *was* used
offline to map job requirement text to ESCO skills (the ESCO auto-expansion
and `scripts/job_skill_id_review.py`), and that is where most wrong job skills
came from (section 2).

## 2. Root causes

The screenshots (Accounting Assistant, Business Intelligence Developer,
Digital Project Manager, each 89–91% Fit-Now with every listed skill
"matched") combine three problems.

**A. The dashboard showed a saved run made by an older backend.** Its "Your
fit" text ("This role is showing as Fit-Now because …", "The main areas to
strengthen next are no major required skills") is from
`generate_match_explanation`, which was removed in `d3aaad9` (2026-09-25). The
dashboard restores the last saved run (`loadLatestMatchRun`), so it keeps
showing old results until matching is run again.

**B. The live job rows carry skill lists from before the data review.** The
skills shown are exactly the pre-review lists in `docs/job-data-anomalies.md`:
Python, JavaScript and Web Development on the Accounting Assistant;
Bookkeeping and Inventory Management on the BI Developer; "Identify
requirements of the work in the artistic performance", Cyber attack
counter-measures, Python and Training Facilitation on the Digital Project
Manager. The review fixed `reference_jobs.csv` on 2026-09-24, but matching
reads Supabase first, and the Supabase rows were never updated (section 5 of
that document). These skills came from ESCO concepts chosen by wording
similarity and from category-fallback filling.

**C. The candidate side cannot come from this resume.** No version of the
extractor, from 2026-09-20 to this branch, finds Python, JavaScript, SQL, Data
Visualization or Perform data mining in it. The 2026-09-22 extractor did read
"business" as Bookkeeping and Financial Reporting (category labels were used
as aliases; fixed in `76142c4`). Even that code, on the pre-review jobs,
credits one of the BI Developer's six skills and puts none of the three jobs
in Fit-Now. For every listed skill to be "matched", the saved run must have
received them as confirmed skills. `_prepare_candidate_context` holds a
confirmed skill without resume evidence by design (a candidate may add a
skill), so a stale or edited skill list is reported as possessed. On this
branch the same resume gets 20 Step 2 skills (Invoicing and Billing, CRM,
Email and Calendar Management, Google Workspace, HubSpot, Help Scout, …) and,
against the reviewed catalogue, Executive Assistant, Virtual Assistant and
Google Workspace Admin Assistant as its top Fit-Now jobs.

Current code also had these defects (found by the regression set in
`backend/tests/test_skill_match_accuracy.py`):

1. **Taxonomy labels that are not names of the skill.** `related_skills` and
   ESCO alternative labels are read as exact aliases. Some name a different
   technology (`XPath`, `DMX`, `QUEL` → SQL; `Mocha`, `Escript` → JavaScript),
   a related but different skill ("data analysis" and "data collection" →
   Statistics, "programming languages" → Python, "mechatronics" → Robotics)
   or an everyday word ("conduct" → Student Assessment, "survey" → Surveying,
   "shooting" → Photography, "scratch" → Scratch programming, "packing" →
   Packaging engineering, "banking" → Economics).
2. **"web" meant Web Development.** A bare programming-language name is
   accepted as evidence ("Python" for Python Programming). The rule stripped
   "programming" from any label, so ESCO's "web programming" produced a
   language called "web", and any resume mentioning the web (or "Web
   Developer") held Web Development and Web programming. "Use scripting
   programming" produced "use scripting".
3. **Spaced "Java Script" was read as Java.**
4. **"React" was not React.js**, so a React developer was told React.js was
   missing, and "React" as a job requirement never resolved.
5. **Excel did not show "Use spreadsheets software"**, the skill the
   Accounting Assistant posting's "MS Excel" was mapped to.
6. **Appointment scheduling written as "coordinated patient appointments"**
   was reported missing.
7. **Pasted jobs dropped requirements with no taxonomy skill** ("Node.js",
   "MySQL"). They were neither matched nor missing, so coverage was computed
   over fewer requirements than the posting lists and a candidate could look
   Fit-Now for a job asking for skills they lack.
8. **A typed skill "Python" did not resolve to Python Programming** (the bare
   name was accepted in resume text only).

## 3. Changes

| Change | Files |
|---|---|
| Reviewed exclusion list: 49 labels on 30 skills that must not identify that skill, each with its reason. Removed once when rows are loaded, so extraction, Step 2 search and requirement resolution agree | `data/skill_alias_exclusions.csv`, `skill_variants.remove_excluded_aliases`, `skill_extractor.py`, `matching_service.load_skills_reference` |
| A bare language name counts only if it is itself a label of the skill ("Python", "Java", "JavaScript"; not "web"), and it now also resolves requirements and typed skills | `matching_service._programming_language_names`, `canonical_skill_lookup` |
| Reviewed spellings: "Java Script" → JavaScript; "React" (Title Case, not "React to …") and "React JS" → React.js | `data/skill_name_variants.csv` |
| Resume text split from a one-word name ("Java Script", "Zen Desk") is not evidence for another skill ("Java") | `matching_service._without_other_spellings` |
| One-way relations: Excel / MS Excel / Google Sheets show Use spreadsheets software; "coordinated patient appointments", "booked appointments" and similar show Appointment Scheduling | `data/skill_evidence_relations.csv` |
| Pasted jobs keep requirements with no taxonomy skill as named requirements | `external_job_analysis._requirement_names` |
| Read-only script that compares live `internal_jobs` with the reviewed reference jobs and writes guarded SQL, plus a list of live jobs using unknown or unreviewed skill IDs | `scripts/sync_reviewed_job_skills.py` |

### Before and after

| Case | Before | After |
|---|---|---|
| Resume "Web Developer … website" vs Web Development | matched (via "web") | not matched |
| "XPath" / "Mocha" in a resume | SQL / JavaScript extracted | nothing extracted |
| "Conducted audits", "customer survey", "from scratch", "trouble shooting" | Student Assessment, Surveying Support, Scratch, Photography | nothing |
| "Programming languages: Java, C#" | Python extracted | Java only |
| "Java Script" | Java extracted; meets a Java requirement | JavaScript; does not meet Java |
| "Built interfaces using React" (mock resume 1) | React.js not found | React.js |
| Chef "packing and delivering orders" (mock resume 24) | Packaging engineering | not extracted |
| TESDA "Mechatronics Technology NCII" (mock resume 26) | Robotics | not extracted |
| MS Excel vs Use spreadsheets software | missing | matched (one way; spreadsheet use never shows Excel) |
| "Coordinated patient appointments" vs Appointment Scheduling | missing | matched |
| Pasted job requiring Calendar Mgmt, Google Workspace, Canva, Node.js | Node.js dropped; coverage 2/3 | Node.js missing; coverage 2/4 |
| Typed skill "Python" vs Python Programming | missing | matched |
| Java ↔ JavaScript, C ↔ C++ ↔ C#, Photoshop ↔ Illustrator, SQL ↔ MySQL, UI ↔ UX Design, Data Analysis ↔ Data Science, Microsoft Office ↔ Excel | not matched | not matched (now covered by tests) |

## 4. Thresholds

**Not changed.** `diagnose_match_distribution.py` (33 mock resumes × 460 jobs, 15,180 pairs)
before and after this branch:

| Measure | Before | After |
|---|---|---|
| Fine-tuned cosine, strong pairs p10 / median / p90 | 0.21 / 0.52 / 0.70 | unchanged |
| Fine-tuned cosine, weak pairs p10 / median / p90 | −0.03 / 0.07 / 0.20 | unchanged |
| Cosine AUC strong vs weak / strong vs moderate | 0.966 / 0.865 | unchanged |
| Strong pairs Fit-Now / Aspiration / Low Match | 133 / 176 / 50 | 134 / 175 / 50 |
| Moderate pairs Fit-Now | 64 | 64 |
| Weak pairs Fit-Now | 1 | 1 |
| Strong pairs failing the required-coverage rule | 225 | 224 |
| Required-coverage nDCG@10 | 0.849 | 0.850 |

The Fit-Now cosine floor (0.30) lies between the strong-pair p10 and median
and above the weak-pair p90, and weak pairs almost never reach Fit-Now. The
wrong matches were never a cosine problem: skill possession is decided by
exact skill logic, and the errors were in taxonomy labels, the language-name
rule, stale job data and confirmed skills. Moving the threshold would not have
fixed any of them.

## 5. Tests added

`backend/tests/test_skill_match_accuracy.py`:

- 16 MATCH and 32 NO-MATCH pairs checked both as a held skill and as resume
  text (React/React.js, Excel/Microsoft Excel, Node.js/NodeJS, Java/JavaScript,
  C/C++/C#, UI/UX, SQL/MySQL, Photoshop/Illustrator, Data Analysis/Data
  Science, Machine learning/Deep Learning, Office/Excel, …).
- Extraction: look-alike words are not skills, real names still are, "React
  to …" is a verb, "Java Script" is JavaScript, and an executive-assistant
  resume shows none of the skills from the screenshots.
- Language-name rule, and exclusion-file integrity (every entry names a label
  the skill still lists).
- End to end through `run_matching` with the pre-review job lists: no
  unsupported skill is matched, none of those jobs is Fit-Now, and matched,
  missing, evidence, explanation and aggregate gaps never contradict.
- Pasted external job, internal and named requirements, through the same
  matcher; unmapped requirements are kept.
- Guarded SQL planning in `sync_reviewed_job_skills.py`.

The full backend suite passes except 14 tests that fail on `main` too
(`test_skill_discovery.py` assumes Tableau, Canva and Figma are not yet in the
taxonomy; two `.doc` conversion tests depend on the local LibreOffice).
`test_training_today.py` needs the `datasets` package and was not run.

## 6. What still needs a decision

1. **Update the live jobs.** Run
   `python3 -m backend.scripts.sync_reviewed_job_skills --output <dir>` where
   Supabase is reachable, review `internal_jobs_skill_sync.sql` and run it. On
   the pre-review data it updates 65 jobs, including JOB-002, JOB-013 and
   JOB-015. If the live rows use other IDs (the 2026-09-20 review saw
   `KJ-00xx`), `unusable_job_skill_ids.csv` lists every live job that uses an
   unknown or unreviewed skill ID; those need the same review.
2. **Re-run matching for saved dashboards.** Saved runs keep their old
   matched and missing skills until the candidate refreshes. A backend
   version stamp on saved runs, with a prompt to refresh, would stop stale
   results being shown as current.
3. **Confirmed skills without resume evidence.** They count as held, by
   design. Per-job `matched_skill_evidence` already marks them
   `confirmed_in_skill_review` with no quoted text. The UI could label such
   skills "added by you" instead of presenting them like resume evidence.
4. **Frontend wording (not changed here).** In `frontend/src/pages/candidate/model.ts`,
   "You meet N of the M skills the employer lists as required" builds M
   from the matched and missing lists, so it always reads N of N when nothing
   is missing. "Your background lines up with the Not Specified field" is shown
   when the job has no category. "Skills you already have" on the Skills page
   is the union of every job's matched skills, not the candidate's skill list.
5. **"Related" as a category.** Related skills (UI and UX Design, Machine
   learning and Deep Learning, Recruitment Coordination and Recruit personnel)
   are now simply "not matched". Showing them as "related skill" would need a
   reviewed relation table, API fields and UI; it is not added.
6. **Unreviewed taxonomy rows.** The 422 `auto_generated_review` ESCO rows are
   still searched in resumes. No job may require them, so they cannot create a
   false match, but they can appear in Step 2. The exclusion list covers the
   ambiguous names found so far; the rows still need review.
7. **Pasted jobs without Gemma.** The fallback reads every skill named
   anywhere in the posting as required, including company boilerplate, and
   cannot tell required from preferred. Section-aware parsing ("Requirements",
   "Nice to have") would need its own tests on real postings.
8. **Ambiguous short names.** "Swift", "Ruby", "Pascal", "Scratch" and "Ada"
   are no longer read as languages, so a developer who lists only "Ruby" is
   not credited. Those rows are unreviewed and no job requires them; an
   upper-case-only spelling (like "JS") is an option once they are reviewed.

Learning recommendations built on these gaps are reviewed in `docs/learning-recommendations.md`.

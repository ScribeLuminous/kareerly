<!-- SECTION valid_count -->
180

<!-- SECTION similarity_resolutions -->
No pair ever crossed a threshold, so nothing needed rewriting for similarity. The flags that were raised and fixed while authoring came from the content checks and review instead: four experience or date inconsistencies (CAT13-R06 at 7.2 years against 6 in the matrix; CAT15-R02 whose volunteer role counted as 1.2 years; CAT13-R01 whose practicum ran past graduation; CAT04-R02 whose summary claimed two years of bookkeeping against an 11-month role), four phrases close to an intentionally missing skill ("inbox management", "phishing risks", "emergency lights", "dispatch"), two locations outside the approved lookup (Batac City and Toronto), single-bullet roles given a second bullet, and 18 employer or school names that matched or could match real public bodies and institutions, all renamed to fictional ones. Four specs were changed because a canonical label or alias made the intended gap impossible to write (CAT09-R01, CAT09-R06, CAT17-R03 and CAT20-R02 at Gate 1, CAT21-R01 later); see finding 6 under Resume parsing QA.

<!-- SECTION conventions -->
- **Emails:** `firstname.surname@example.com`, `@example.org` or `@example.net` only (RFC 2606 reserved domains); all 180 unique.
- **Phones:** `+63 9XX XXX XXXX`, drawn from common Philippine mobile prefixes; all 180 unique. These are realistic-format numbers that may belong to real subscribers. **Never use these fixtures to send SMS, place calls or send email.**
- **Names:** fictional given-name and surname combinations from general and regional pools (Ilocano, Cordilleran, Kapampangan, Bicolano, Visayan, Mindanao and Muslim Filipino surnames), with surnames of prominent public figures and political families blocked; no duplicate full names, no surname used more than 3 times.
- **Organisations:** every employer, school and public body is invented. Public-sector roles (K13, K23) use invented foundations, councils and development authorities rather than real government offices. Credentials name their real issuers (PRC, TESDA, Civil Service Commission, DOLE-accredited trainers, vendor certifications), as a real resume would.
- **Locations:** only the approved Section 6.3 lookup, keyed on (city, province). Negros Island Region follows RA 12000 (Bacolod, Silay, Kabankalan, Dumaguete, Bais, Bayawan, Siquijor are NIR). No Sulu location (including Jolo) and no Isabela City anywhere. Independent and highly urbanised cities are written with their geographic province (for example "Baguio City, Benguet"); NCR uses "Metro Manila". Every approved location resolves to the same region in the repository's `ph_regions.py`.
- **Dates:** reference date 2026-09-28; no date after it; current roles end "Present"; work-history experience within ±1 year of `experience_years` for all 180.
- **Layouts:** 10 variants, each used 17–19 times; every category uses at least 7 of them.

<!-- SECTION parsing -->
**Findings**

1. **Filipino names with "ñ" were mangled (parser issue, fixed after the first run).** `resume_analyzer.normalize_person_name` split names on non-ASCII letters: "Randy Omaña" → "Randy Oma A", "Mylene Ybañez" → "Mylene Yba Ez", "Patrick Cañete" → "Patrick Ca Ete". For "Mark Anthony Dela Peña" (CAT23-R07) the mangled name failed the plausibility check and the parser returned the location line "Alaminos City Pangasinan" as the name. All 11 name failures (169/180 detected) had this one cause; the PDFs extract "ñ" correctly. Names are now read with Unicode letters and composed to NFC first (a PDF may store "ñ" as "n" plus a combining tilde); **180/180 names are detected in the rerun.**
2. **"Work History" and "Career History" were not recognised as experience headings (parser issue, fixed after the first run).** All 27 resumes without a detected experience section used one of these two headings (certification_focus: 16 of 19, mixed_paragraph: 11 of 18); `SECTION_HEADINGS` had "experience", "work experience", "professional experience" and "employment history" but not these variants. Skills were still extracted, but from the wrong section. Both headings are now section headings and experience keywords; **the experience section is detected in 180/180 resumes in the rerun** (153/180 before), and the extracted skills of every resume are unchanged.
3. **A short second page is treated as a scanned page (parser issue).** CAT04-R01 and CAT14-R01 are text PDFs whose second page holds only a few lines; the parser reports "This resume looks scanned (image-only), but text recognition (OCR) is not available" (`ocr_status: unavailable`). A real user would see a misleading warning.
4. **Certification indicators without a certifications section.** 14 resumes with no certifications listed still report certification indicators, triggered by credentials inside education entries ("Caregiving NC II", "Registered Civil Engineer") or phrases such as "licensure". This is arguably correct for TESDA NC holders and is noted, not counted as a failure.
5. **Skill extraction is precision-first.** No intentionally missing skill was extracted from any resume, and every extracted skill is a canonical ID. Median recall of the skills in each candidate's spec is 0.56. The misses are mostly soft and generic skills (Business Communication 69 resumes, English Communication 44, Manage staff 22) and naturally worded skills with no verified alias ("PowerShell scripting", "firewall policies", "HR processes"). This is a normalization coverage gap rather than a resume-structure problem; the resumes deliberately use natural wording (Section 2).
6. **Canonical labels that contain other labels or aliases (normalization issue).** Found while authoring and fixed in the specs, not in the taxonomy: "Use customer relationship management software" contains "Customer relationship management"; Production Monitoring's alias is the label "Monitor the production line"; Electrical Installation's alias is the label "Install electrical and electronic equipment"; Tourism Assistance's alias is the label "Provide tourism related information"; "surveying" (Surveying Support) matches inside "quantity surveying". A candidate cannot show one of these without appearing to hold the other.

Failure classes in `parsing_results.csv`: `resume_structure_or_section_detection` means the experience or education section was not detected (27 resumes on the first run, all from finding 2, a parser vocabulary issue and not a resume defect; none after the fix). Seven resumes that this class had masked now appear under `normalization_low_recall`; their recall did not change; `normalization_low_recall` means fewer than half the spec skills were extracted (finding 5).

<!-- SECTION matching -->
**Findings**

Matching was rerun after the parser fixes (names with "ñ", "Work History" / "Career History"); the section split changes the evidence windows the model reads, so 38 of the 360 rows differ in some detail, but only two changed their Fit-Now count or top match (CAT21-R06 gained one Fit-Now match; CAT15-R06 changed its top title from Caregiver to Caregiving Assistant). The figures below are from the rerun.

1. **Fit-Now mostly lands in the right category.** Of 350 Fit-Now matches for controlled resumes, 269 are in the target category, 79 in a neighbouring category and only 2 outside both (CAT02-R06 into Education, which is its teacher background; CAT05-R04 into Sales, which is its purchasing duties). The top recommendation is in the target category for 125 of 168 controlled resumes, and the target category is in the top 5 for 155.
2. **Profiles behave as designed, with one exception.** Strong-entry resumes get the most dependable results (22 of 24 with a Fit-Now match; the top match is in the target category for all 24). Partial-entry resumes mostly get Aspiration only (16 of 24 have no Fit-Now), which is the intended skill-gap case. Career-transition and mixed-boundary resumes produce the most out-of-category Fit-Now matches (32 and 33), as designed. **The exception is `advanced`:** 8 of 24 have no Fit-Now match and their top matches are mostly Junior, Entry or Mid-level roles (Accounting Manager → Junior Accountant; Care Home Supervisor, RN → Medication Aide; Site Foreman → Carpenter).
3. **Catalog seniority gap (catalog coverage issue).** `reference_jobs.csv` has 11 Senior roles out of 460 (168 Entry, 123 Junior, 139 Mid, 19 Entry-to-Mid). Senior and managerial candidates have almost nothing at their level to match, so the matcher recommends junior versions of their job. This is a coverage limit of the catalog, not of the matcher.
4. **Regional coverage gap (catalog coverage issue).** No catalog job is located in Region I, II, IV-B, VIII, IX, XII or BARMM, and only one each in Region V and Caraga. With the region filter on, candidates there see only the 63 remote jobs; 82 jobs whose location names no region ("Philippines") are excluded by design. Resumes with at least one Fit-Now fall from 129 to 37 with the filter, and 22 resumes get no recommendation at all. NCR (210 located jobs) and CALABARZON (68) dominate.
5. **False positives traced to skill extraction, not to the matcher.**
   - CAT07-R05 (Procurement Manager): top match *Packaging Operator* (K21). The parser extracted **Packaging** from "negotiated … packaging contracts" and missed Purchasing Support, purchase orders and contract review, so the extracted profile looks like a packing worker. Only 2 of its 8 core skills were extracted.
   - CAT03-R05 (Information Security Officer): top match *Regulatory Compliance Assistant* (K23), an Aspiration; "information security", "security policy", "ICT audits" did not map to the canonical K03 skills, leaving compliance skills to dominate.
   - CAT04-R05 (Accounting Manager, CPA): "Accounting", "financial statements", "PFRS / IFRS" and "cost accounting" were not extracted; top match is *Junior Accountant* (Aspiration).
6. **Generic-skill dominance (semantic overreach, manual review).** Resumes built around generic office skills drift toward generic jobs: CAT09-R02 (chat support) and CAT23-R02 (government program assistant) both top out at *Order Processing Clerk* (K07) on Data Encoding and Customer Service; CAT21-R07 (Production Planner) tops out at *Business Report Writer* (K10) on reporting and data words; CAT02-R02 (reporting analyst graduate) at *Operations Support Assistant* (K05). These are plausible Aspiration matches, not errors, but show that shared generic skills can outrank the target category when core skills are sparsely extracted.
7. **Median counts (no filter):** 1 Fit-Now, 29 Aspiration and 429 Low Match per resume; Low Match jobs are scored but never recommended.

Categories with the weakest results (fewest resumes with a Fit-Now match, no filter): K06 Human Resources and Project Management (1 of 7), K08 Marketing (3 of 7) and K13 Social Services (3 of 7). K13 has only 2 of its own skills in any K13 job; K06 jobs require tools (Jira, Asana) and processes that most HR-side resumes do not name.

<!-- SECTION stress -->
**Per case** (no location filter)

- **STRESS-001 Web Designer (Design → Web):** one Fit-Now (*Junior Figma Designer*, K11); ten K01 jobs are Aspiration because React, Git and testing are missing. Clean separation: design first, front-end as a stretch. Plausible.
- **STRESS-002 Client Relations and Inside Sales (Customer Service → Sales):** top match *Inside Sales Representative* (K07, Fit-Now); Fit-Now split K07 ×3, K09 ×2. Genuine multi-category result. Plausible.
- **STRESS-003 Marketing Analytics (Marketing → Data):** top-5 mostly K02 (*Marketing Data Analyst* first); 4 of 5 Fit-Now in Data. The secondary category dominates. Plausible, but worth a manual look if marketing roles should rank first.
- **STRESS-004 Office Coordinator and Project Support (Admin → PM):** top match *Project Coordinator* (K06); Aspiration mostly K05. Plausible. No Fit-Now with the region filter (Region II has no located jobs).
- **STRESS-005 Home Health Nurse (Healthcare → Caregiving):** 9 of 10 Fit-Now are caregiving roles; top match *Medication Aide*. A licensed nurse is steered to aide-level caregiving jobs. **Manual review:** seniority/licence mismatch plus clustering on the secondary category; the parser also missed Patient Assessment Support and treatment monitoring.
- **STRESS-006 Banquet and Catering Supervisor (Food Service → Hospitality):** all 7 Fit-Now are K19 kitchen/service roles; top *Commis Cook* (entry level). Hospitality events work appears only as Aspiration. **Manual review:** seniority mismatch.
- **STRESS-007 E-learning Developer (Education → Design):** top *Instructional Designer* (K12); one design Fit-Now; broad Aspiration spread across 9 categories. Plausible.
- **STRESS-008 Content and Digital Marketing Writer (Writing → Marketing):** top 2 are Marketing roles (*Digital Marketing Assistant*), then Writing. Plausible multi-category result.
- **STRESS-009 IT Security and Data Privacy (IT → Legal):** **no Fit-Now**; top is *Data Privacy and Compliance Associate* (K24, Aspiration), listing "Ensure information security" as missing although the resume states it. The parser did not map "information security" and three other security skills. **Manual review: false negative caused by normalization.**
- **STRESS-010 Project Engineer (Engineering → PM + Construction):** top *Construction Site Assistant* (K16, entry level) for a licensed engineer with seven years' experience; Aspiration spread over K16, K17 and K06. **Manual review:** seniority mismatch; Civil engineering and project management were not extracted.
- **STRESS-011 Events Sales Executive (Hospitality → Sales):** top match is the exact role *Events Sales Executive* (K18); Fit-Now in K18 and K07. Plausible.
- **STRESS-012 Supply Chain and Production Planning (Logistics → Manufacturing):** top *Production Planner* (K21, secondary category); Aspiration split K20/K21. Plausible.

**Patterns:** 8 of 12 have both their primary and a secondary category in the top 5; the exceptions are 005 and 006 (all top 5 in one category), 007 (all Education) and 009 (no IT-security job in the top 5). The secondary category takes the top spot in 7 of 12 (002, 003, 004, 005, 008, 009, 012), which is defensible for overlap profiles. The clear problems are the same two seen in the controlled set: missed normalization of stated skills (009, and partly 005 and 010) and a lack of senior roles (005, 006, 010). No stress resume received an unrelated top match.

<!-- SECTION issues -->
## Issues found, not fixed in this task

Two parser issues found by the first run (names with "ñ", and the "Work History" / "Career History" headings) were fixed afterwards and are listed under "Changes made outside the dataset folder".

These are documented, not changed, as the task requires for the model, thresholds, normalization, catalog and parser behaviour.

| Area | Issue | Where |
|---|---|---|
| Parser | Text PDF with a short last page reported as scanned, with an OCR warning | `backend/app/services/resume_parser.py` scanned-page heuristic |
| Normalization | Five label/alias overlaps (see Resume parsing QA, finding 6) | `backend/data/skill_aliases.csv`, `skills_reference.csv` |
| Normalization | Stated skills not mapped: "information security", "purchase orders"/"purchasing", "financial statements", "Accounting", "civil engineering" in running text; "Packaging" extracted from "packaging contracts" | skill extractor / `skill_aliases.csv` |
| Catalog | 11 of 460 jobs are Senior; advanced candidates are matched to junior roles | `backend/data/reference_jobs.csv` |
| Catalog | No located jobs in Regions I, II, IV-B, VIII, IX, XII, BARMM; one each in V and XIII; region filter leaves only remote jobs there | `reference_jobs.csv` |
| Taxonomy | Thin categories: K15 has 10 own skills (one is music therapy), K23 11 (including railway legislation and nutrition policy); K13 jobs use only 2 of K13's own skills and lean on K12's Case Documentation; K17, K19 and K21 jobs use 4–5 of their own skills | `skills_reference.csv`, `reference_jobs.csv` |

## Changes made outside the dataset folder

- `backend/app/services/ph_regions.py`: Sulu and Jolo no longer map to BARMM (Supreme Court, 2024) and name no region rather than a guessed one; "Isabela City" and "Isabela City, Basilan" resolve to Region IX. A test was added in `backend/tests/test_region_preference.py`; the file's 21 tests pass. This was requested at Gate 1.
- `backend/app/services/resume_analyzer.py`: names are read with Unicode letters (NFC-normalised, so "Omaña", "Peña", "Cañete" survive), and "Work History" and "Career History" are section headings and experience keywords. Tests are in `backend/tests/test_resume_names_and_headings.py`. `parsing_results.csv` and this report were regenerated after the change: names detected 169 → 180, experience section detected 153 → 180, section-structure failures 27 → 0, extracted skills unchanged.
- Nothing else outside `test-data/synthetic-resumes-180/` was changed.

<!-- SECTION integrity -->
## Research and data integrity

These 180 resumes are synthetic system-test fixtures. They must not be added to fine-tuning, validation or held-out thesis test data, used for checkpoint selection, presented as real Filipino job seekers, used to report or adjust thesis metrics, or mixed with production candidate records. No model, checkpoint, threshold, gate, skill-coverage rule, PSOC/ISCO/ESCO mapping, job catalog, production database or thesis dataset was changed. PSOC/ISCO codes are left empty: jobs carry no reviewed PSOC codes, and the repository's documentation states PSOC feeds no matching, skill-gap or learning logic, so a code derived from a title alone would be unreviewed.

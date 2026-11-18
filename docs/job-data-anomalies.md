# Reference job data anomalies (2026-09-24)

This is a manual review of all 184 jobs in `backend/data/reference_jobs.csv`,
with skill IDs resolved to names through `backend/data/skills_reference.csv`.
It is the data follow-up from `docs/matching-diagnosis.md`. Sections 1–5 are
the review as found. The fixes have since been applied; see
[Applied fixes](#applied-fixes-2026-09-24) at the end.

Odd requirements hurt genuine candidates. A real software developer can never
hold "Animal Care", so JOB-009's required-skill coverage is capped, and the
job's model input is diluted as well.

## Summary

| Problem | Jobs |
|---|---|
| Implausible required or nice-to-have skills | 52 of JOB-001–JOB-060 (44 with at least one clearly wrong skill), plus 7 seed/template jobs |
| Job filed under the wrong category | 22 |
| Same skill listed as both required and nice-to-have | 26 |
| Required list longer than 8 skills (dilutes coverage) | 7 |
| Seed descriptions with internal boilerplate | 30 (JOB-061–JOB-090) |
| Near-duplicate seed jobs | 2 pairs |

**Root cause of most odd skills.** 164 of the 1,050 skill references in the
catalogue point to rows from the ESCO auto-expansion batch. Those 500 rows are
`mapping_status=auto_generated_review` with
`source_note=esco_auto_expansion_500_review_needed`, meaning they were never
reviewed. They are used by 57 jobs, almost all in JOB-001–JOB-060, which came
from the JobStreet-informed curation. Examples: "Perform market research in
footwear", "Provide anti-cancer medical treatment", "Prepare airport annual
budget", "Write prescriptions for medication in dentistry". A second, smaller
source is "category fallback" filling. For example, JOB-002 Accounting
Assistant, filed under Software and Web Development, was given Python and
JavaScript.

## 1. Implausible skills, JOB-001 – JOB-060

**Clearly wrong** skills should be removed. **Questionable** skills are
defensible for some postings and need a human decision. (N) marks a
nice-to-have skill; everything else is required.

| Job | Title (category) | Clearly wrong | Questionable |
|---|---|---|---|
| JOB-001 | Digital Analytics Engineer (K01) | Case Documentation | Risk Reporting; Establish an Information Security Management System; 13 required skills in total |
| JOB-002 | Accounting Assistant (K01) | Python Programming; JavaScript Programming; Web Development | Bookkeeping also listed as (N) |
| JOB-003 | Customer Service Representative (K09) | – | Execute email marketing |
| JOB-004 | IT Operation Analyst (K02) | Analyse large-scale data in healthcare; Financial Reporting | Implement a firewall |
| JOB-005 | IT Support Engineer (K02) | Bookkeeping; Analyse large-scale data in healthcare | – |
| JOB-006 | Digital Solutions Analyst (K02) | Delivery Coordination; Bookkeeping; Graphic Design; Comply with quality standards related to healthcare practice | Cyber attack counter-measures |
| JOB-007 | Senior Analyst, IT Applications (K01) | Analyse large-scale data in healthcare (also N); Graphic Design; Adhere to health well-being and safety; Classroom Management | – |
| JOB-008 | Information Systems Audit Specialist (K01) | Graphic Design; Review meteorological forecast data; Develop code exploits | Web Development |
| JOB-009 | Software Developer (K01) | Graphic Design; Bookkeeping; Animal Care | – |
| JOB-010 | Data Analyst (K02) | Masonry; Bookkeeping | – |
| JOB-011 | IT Support Specialist (K03) | Computer graphics | Computer engineering; Inventory Management |
| JOB-012 | Cybersecurity Analyst (K03) | Student Assessment | – |
| JOB-013 | Business Intelligence Developer (K02) | Inventory Management; Bookkeeping | – |
| JOB-014 | Systems Administrator (K01) | – | JavaScript Programming; Web Development (category fallback) |
| JOB-015 | Digital Project Manager (K03) | Identify requirements of the work in the artistic performance | Cyber attack counter-measures; Python Programming; Training Facilitation |
| JOB-017 | Administrative Officer (K05) | Sell office equipment; Use scripting programming (N) | – |
| JOB-019 | Business Development Manager (K01) | Python Programming; Make recommendation on nutrition to public policy makers; Bookkeeping | – |
| JOB-020 | Payroll Specialist (K04) | Support social service users to manage their financial affairs; Medication Assistance (N) | – |
| JOB-021 | Internal Auditor (K02) | Student Assessment | Content Writing |
| JOB-022 | Tax Specialist (K04) | Support social service users to manage their financial affairs | – |
| JOB-023 | Treasury Analyst (K04) | – | Manage human resources; Management systems standards |
| JOB-024 | Operations Manager (K05) | – | Social Media Management; Payroll Processing; Python Programming (N) |
| JOB-025 | Executive Assistant (K04) | Tourism Assistance; Provide financial product information | Support implementation of quality management systems |
| JOB-026 | Compliance Officer (K04) | Classroom Management | – |
| JOB-027 | Budget Analyst (K04) | Prepare airport annual budget; Driver's license structure (N) | – |
| JOB-028 | Procurement Officer (K04) | Prepare airport annual budget; Payroll Processing | – |
| JOB-029 | Risk Analyst (K04) | Student Assessment; Identify necessary human resources | Content Writing |
| JOB-030 | Corporate Secretary (K04) | Case Documentation | Payroll Processing |
| JOB-031 | Digital Marketing Specialist (K08) | – | SQL; Community Engagement |
| JOB-033 | Customer Success Manager (K09) | – | Delivery Coordination |
| JOB-034 | Brand & Marketing Manager (K07) | Policy Support | – |
| JOB-035 | Customer Service Representative (K09) | Undertake healthcare examination | – |
| JOB-036 | Account Executive (K09) | Manage guest support services; Build a strategic marketing plan for destination management; Counselling Support (N) | Financial Reporting |
| JOB-037 | SEO Specialist (K08) | Student Assessment; Perform market research in footwear; Blueprints (N) | – |
| JOB-038 | Email Marketing Specialist (K07) | Manage guest support services | Graphic Design |
| JOB-039 | Trade Marketing Officer (K07) | Recruitment Coordination; Technical Drafting | SQL |
| JOB-040 | Sales Manager (K04) | – | Bookkeeping |
| JOB-042 | CRM Specialist (K01) | Workplace Safety; Classroom Management | Financial Reporting; Python Programming |
| JOB-043 | Market Research Analyst (K08) | Perform market research in footwear | Graphic Design |
| JOB-044 | E-commerce Specialist (K09) | Manage guest support services; Provide anti-cancer medical treatment | – |
| JOB-045 | Influencer Marketing Coordinator (K07) | Recruitment Coordination; Production Monitoring; Perform market research in footwear (N); Engineering Measurement (N) | SQL |
| JOB-046 | Graphic Designer (K04) | International financial reporting standards | – |
| JOB-048 | Social Media Manager (K11) | Classroom Management; Bookkeeping; Accept feedback on artistic performance | Database Management; SQL |
| JOB-051 | UI/UX Designer (K11) | Student Assessment; Teach design and applied arts principles | Python Programming |
| JOB-052 | Photographer (K11) | Tourism Assistance; Teach design and applied arts principles; Make technical drawings of fashion pieces (N) | Records Organization; Front Desk Support (N) |
| JOB-053 | Motion Graphics Artist (K11) | Adapt designers' work to the performance venue; Psychological healthcare services (N) | – |
| JOB-054 | Creative Director (K03) | Information security strategy; Cyber attack counter-measures | – |
| JOB-055 | Podcast Producer (K11) | Recruitment Coordination; Write prescriptions for medication in dentistry (N) | Inventory Management; JavaScript Programming (N) |
| JOB-056 | Illustrator (K03) | Cyber attack counter-measures; Psychological healthcare services; Electrical Installation (N) | – |
| JOB-058 | Scriptwriter (K10) | – | Write job descriptions; Develop animations |
| JOB-059 | Brand Designer (K11) | Cyber attack counter-measures | – |
| JOB-060 | Media Buyer / Planner (K11) | Cyber attack counter-measures; Electrical Installation; Teach design and applied arts principles; Identify requirements of the work in the artistic performance | – |

No odd skills in: JOB-016, 018, 032, 041, 047, 049, 050, 057.

## 2. Implausible skills in seed and template jobs

JOB-061 onwards is mostly clean. Exceptions:

| Job | Title | Problem |
|---|---|---|
| JOB-146 | Livestock Farm Assistant | Requires **Elderly Care** |
| JOB-114 | Backhoe Operator | Required skills lack any equipment-operation skill (Construction Safety, Mechanical Maintenance, Engineering Measurement) |
| WEB-…-K17 | Cost Estimator | Requires Masonry and Electrical Installation; no estimating or measurement skill |
| WEB-…-K20 | Warehouse Associate | Requires only driver skills (Driving Safety, Route Planning, Delivery Coordination); no Warehouse Operations or Inventory Management |
| WEB-…-K21 | Quality Assurance Engineer | Requires Machine Operation, an operator skill |
| WEB-…-K24 | Security Operations Officer | Requires Legal Documentation and Legal Research Support |
| WEB-…-K11 | Graphic Designer (Packaging and Brand Assets) | Requires Video Editing and UI Design; packaging design is not represented |

The 24 `WEB-20260922-K*` jobs were given their category's template skills
(`skill_id_mapping_status=template_category_skills`) rather than skills from
the posting, which is why several don't fit the title.

## 3. Jobs filed under the wrong category

Category drives the preference-alignment tie-breaker and the dashboard filters.

| Job | Title | Current | Suggested |
|---|---|---|---|
| JOB-002 | Accounting Assistant | K01 Software and Web Development | K04 Finance and Accounting |
| JOB-004 | IT Operation Analyst | K02 Data and AI | K03 IT Infrastructure |
| JOB-005 | IT Support Engineer | K02 Data and AI | K03 IT Infrastructure |
| JOB-008 | Information Systems Audit Specialist | K01 Software | K03 IT Infrastructure (or K04) |
| JOB-015 | Digital Project Manager | K03 IT Infrastructure | K06 HR and Project Management |
| JOB-019 | Business Development Manager | K01 Software | K07 Sales and Purchasing |
| JOB-021 | Internal Auditor | K02 Data and AI | K04 Finance and Accounting |
| JOB-025 | Executive Assistant | K04 Finance | K05 Office Administration |
| JOB-028 | Procurement Officer | K04 Finance | K07 Sales and Purchasing |
| JOB-034 | Brand & Marketing Manager | K07 Sales | K08 Marketing and PR |
| JOB-038 | Email Marketing Specialist | K07 Sales | K08 Marketing and PR |
| JOB-039 | Trade Marketing Officer | K07 Sales | K08 Marketing and PR |
| JOB-041 | Product Marketing Manager | K07 Sales | K08 Marketing and PR |
| JOB-045 | Influencer Marketing Coordinator | K07 Sales | K08 Marketing and PR |
| JOB-040 | Sales Manager | K04 Finance | K07 Sales and Purchasing |
| JOB-042 | CRM Specialist | K01 Software | K07 Sales or K09 Customer Service |
| JOB-046 | Graphic Designer | K04 Finance | K11 Design and Media |
| JOB-048 | Social Media Manager | K11 Design and Media | K08 Marketing and PR |
| JOB-049 | Video Editor | K10 Writing | K11 Design and Media |
| JOB-054 | Creative Director | K03 IT Infrastructure | K11 Design and Media |
| JOB-056 | Illustrator | K03 IT Infrastructure | K11 Design and Media |
| JOB-130 | Personal Grooming Services Assistant | K18 Hospitality | K19 Food Service and Personal Care |

JOB-002, 019, 042 and 046 are probably where the odd skills in section 1 came
from: category-fallback skills were added for the wrong category.

## 4. Other data smells

- **Same skill required and nice-to-have (26 jobs):** JOB-001, 002, 007, 009,
  010, 015, 018, 019, 021, 032, 036, 038, 039, 040, 042, 043, 047, 050, 051,
  052, 053, 054, 055, 058, 059, 060. Scoring already ignores the duplicate
  nice-to-have entry, but the data should list each skill once.
- **Very long required lists:** JOB-001 (13), JOB-004, 006, 007, 008 (10 each),
  JOB-009 and 042 (9). With this many required skills, a genuine candidate
  rarely reaches 50% coverage, especially when several of them are wrong.
- **Internal boilerplate in descriptions:** JOB-061 to JOB-090 say "The role is
  included as a Kareerly reference coverage seed so the matching engine can
  recognize resumes and jobs involving these competencies." Users can see this
  text, and it is fed into the model input.
- **Near-duplicate seed jobs:**
  - JOB-085 and JOB-148 (Environmental Conservation Assistant) have identical
    required skills.
  - JOB-082 and JOB-139 (Warehouse Operations Assistant) overlap heavily.

  Other shared titles (Accounting Assistant, Data Analyst, Customer Service
  Representative, Hotel Front Desk Associate, Human Resources Assistant) are
  distinct postings and are fine.

## 5. Supabase jobs (not auditable from here)

The live catalogue could not be read from this environment. From
`backend/data/skill_id_review/2026-09-20_job_skill_ids.sql`, 36 of the 40
reviewed jobs still carry 41 distinct legacy IDs with no taxonomy row, such as
`SK_EXCEL` (5 jobs), `SK_REPORTING` (3), `SK_DOCUMENTATION` (3),
`SK_DATA_ENTRY`, `SK_SCHEDULING`, `SK_TROUBLESHOOTING` and `SK_POWER_BI`.
Matching now compares these by name, but they should be mapped to taxonomy IDs
or added to `skills_reference.csv`. Running the same review over the live
`internal_jobs` and `employer_job_posts` tables is recommended.

## Suggested order of fixes

1. Remove the "clearly wrong" skills in sections 1 and 2. Most are
   `auto_generated_review` rows.
2. Recategorise the jobs in section 3.
3. Stop mapping job requirements to `auto_generated_review` skills until those
   rows are reviewed.
4. Replace the boilerplate descriptions and deduplicate the required and
   nice-to-have lists.
5. Rerun `backend/scripts/diagnose_match_distribution.py`. The Fit-Now
   thresholds were calibrated on the current data, so check that they still
   hold.

## Applied fixes (2026-09-24)

`backend/scripts/fix_reference_job_data.py` applies the fixes and can be re-run;
a second run changes nothing. It lists every reviewed job's final required and
nice-to-have skills, so each decision can be read in one place. Each list was
checked against the posting's own requirement text and the matching ESCO
v1.2.1 occupation profile (`occupationSkillRelations_en.csv`).
`backend/tests/test_reference_data_quality.py` keeps these rules from
regressing.

**Jobs (`reference_jobs.csv`)**

- All skills marked clearly wrong in sections 1 and 2 are removed. Where a
  posting then lacked a skill it plainly asks for, the ESCO skill named for
  that work was added. Examples: Use spreadsheets software for "MS Excel", Use
  customer relationship management software for "Salesforce / HubSpot", Execute
  ICT audits and Audit techniques for the IS Audit Specialist, Quantity
  surveying for the Cost Estimator, Social Media Management for the Social
  Media Manager (it was missing).
- Questionable skills: kept when the posting asks for them, removed otherwise.
  Kept: Web Development (JOB-001, tag management and instrumentation), Content
  Writing for report writing (JOB-021, 026, 029) and Inventory Management as
  nice-to-have (JOB-011, "maintain IT asset inventory"). Removed: Risk Reporting and ISMS (JOB-001), Implement a firewall
  (JOB-004), Cyber attack counter-measures (JOB-006, 015), Computer
  engineering (JOB-011), Python and Training Facilitation (JOB-015),
  Management systems standards and Manage human resources (JOB-023), SQL
  where the posting never mentions it (JOB-031, 039, 045, 048), Graphic Design
  (JOB-038, 043), Payroll and Social Media (JOB-024), Write job descriptions
  and Develop animations (JOB-058), and the rest of the questionable column.
- Also removed, though section 1 did not list them: SAS language (JOB-001),
  Policy Support and Bookkeeping (JOB-024), Product Knowledge (JOB-026),
  Retail Operations (JOB-033, 041), Graphic Design, Sales Techniques and
  Content Writing (JOB-034), Content Writing and Sales Techniques (JOB-046),
  the Writing-category fallback skills on the Video Editor (JOB-049), and
  Graphic Design and Sales Techniques (JOB-052), Python Programming (JOB-016
  Financial Analyst) and Data Visualization (JOB-057 Web Designer). None of
  these appears in its posting.
- All 22 recategorisations in section 3 are applied. JOB-042 went to K07
  Sales. JOB-008 went to K03. JOB-014 Systems Administrator also moved to K03;
  it was the other category-fallback job. JOB-030 Corporate Secretary moved
  from Finance to K05 Office Administration and Records.
- Template jobs K11, K17, K20, K21 and K24 now carry skills that fit their
  title. The Backhoe Operator requires Machine Operation. Elderly Care is gone
  from the Livestock Farm Assistant.
- No job lists a skill as both required and nice-to-have. No job requires more
  than 8 skills; the longest list is now 7.
- JOB-061–JOB-090 have plain descriptions of the work instead of the "coverage
  seed" text.
- Near-duplicates: JOB-085 is now *Reforestation and Nursery Assistant*
  (Tree Planting, Environmental Conservation, Horticulture). JOB-082 is now
  *Forklift and Materials Handling Assistant* (Warehouse Operations, Machine
  Operation). The JobStreet-sourced JOB-148 and JOB-139 are unchanged.
- On JOB-081, a driver job, the filler nice-to-haves Machine Operation and
  Production Monitoring are replaced with Workplace Safety.
- `job_text_for_matching` is rebuilt for all 184 jobs from the title,
  description, requirement text, mapped skill names and category. The old text
  still named the removed skills, and repeated the category name up to four
  times.
- Jobs whose skills changed have `skill_id_mapping_status=reviewed`.

**Skills (`skills_reference.csv`)**

- The 78 imported ESCO skills that jobs still use are now
  `mapping_status=reviewed`. Each is named after its ESCO concept, so the link
  is exact, and each was checked with the job that uses it. No job references
  an `auto_generated_review` row any more, and the new test keeps it that way.
  The other 422 imported rows are untouched and still need review before a
  job uses them.
- 14 core skills were linked to an ESCO concept picked by wording rather than
  meaning. Resume parsing uses the linked concept's labels as aliases, so
  these produced false detections. They are relinked:

  | Skill | Was linked to | Now linked to |
  |---|---|---|
  | SK022 Operations Support | ensure lawful business operations | coordinate operational activities |
  | SK024 Retail Operations | mill operations | supervise sales activities |
  | SK052 Case Documentation | maintain customer records | maintain records of work with service users |
  | SK059 Caregiving | provide lawn care | apply person-centred care |
  | SK061 Basic Life Support | provide ICT support | provide first aid |
  | SK064 Pharmacy Support | navy operations | ensure the appropriate supply in pharmacy |
  | SK069 Engineering Measurement | take measurements of performance space | use measurement instruments |
  | SK071 Masonry | blast masonry | lay bricks |
  | SK078 Front Desk Support | train reception staff | greet guests |
  | SK081 Tourism Assistance | tourism market | provide tourism related information |
  | SK087 Personal Grooming Services | thermal treatment (waste incineration) | style hair |
  | SK089 Machine Operation | operate router machinery | operate industrial equipment |
  | SK104 Livestock Production | research livestock production | manage livestock |
  | SK106 Environmental Conservation | inform customers environmental protection | conserve natural resources |

- 26 core skills had `related_skills` aliases copied from an unrelated ESCO
  concept. Examples: "oversee casino" on Classroom Management, "train animals"
  on Training Facilitation, "caring for forest wildlife" on Elderly Care,
  "handle payments" on Payroll Processing, "developing staff" on Web
  Development, and nuclear-emergency terms on Emergency Response. These are
  removed. The full list is `RELATED_DROP` in the script.

**Diagnostic rerun** (`diagnose_match_distribution.py`, 33 mock resumes × 184
jobs, fine-tuned model, current thresholds; before → after):

| Measure | Before | After |
|---|---|---|
| Strong pairs classed Fit-Now | 98 / 179 | 107 / 179 |
| Strong pairs classed Low Match | 28 | 22 |
| Strong pairs failing the required-coverage rule | 68 | 55 |
| Moderate pairs classed Fit-Now | 72 | 64 |
| Weak pairs classed Aspiration | 138 | 89 |
| Weak pairs classed Fit-Now | 1 | 4 |
| Resumes with no Fit-Now job | 2 | 0 |
| Final-score nDCG@10 / recall@10 | 0.885 / 0.826 | 0.899 / 0.861 |
| Fine-tuned cosine AUC, strong vs moderate | 0.859 | 0.887 |

The thresholds still hold: Fit-Now rises for strong pairs and falls for
moderate and weak ones, so there is no reason to recalibrate. The three new
weak Fit-Now pairs are reasonable matches that the career-area labels count
as weak: Content Writer → Social Media Manager (now under Marketing), and a
Legal Assistant and a Government Administrative Officer → Corporate
Secretary. Moving JOB-030 to Office Administration doesn't change these labels:
the diagnostic places both resumes in its government, legal and security career
area.

**Not changed**

- Section 5 (Supabase jobs) needs the live tables and is not covered here.
  `backend/scripts/sync_reviewed_job_skills.py` writes guarded SQL that brings
  live jobs with a reviewed reference row in line with it, and lists live jobs
  that use unknown or unreviewed skill IDs. See `docs/skill-match-accuracy.md`.

## Live employer posts (2026-11-17)

A read of the public job list on 2026-11-17 (1,723 open jobs: 1,224 employer
posts, 499 internal) found test and duplicate posts reaching candidates:

| Problem | Posts | Handling |
|---|---|---|
| Posts from test companies named "(Test …)" / "(TEST …)" | 27 | Hidden by migration `20261117100000_employer_test_postings.sql` (`is_test_posting`); their owners still see them |
| Same company posting the same job twice (one bulk file uploaded on 27 and 28 Oct) | 168 | Listed and matched once: `drop_duplicate_postings` in `backend/app/services/supabase_jobs.py` keeps the first-posted copy |
| The same jobs posted by two companies ("wednesday virtual works" and "LTK Corp.") | 680 | **Needs review.** Not hidden automatically: identical posts from two companies could be real |

To review the cross-company copies, run in the Supabase SQL editor:

```sql
select a.company_name, b.company_name as also_posted_by, count(*) as identical_posts,
       min(a.created_at)::date as first_posted
from public.employer_job_posts a
join public.employer_job_posts b
  on a.employer_id < b.employer_id
 and lower(a.job_title) = lower(b.job_title)
 and lower(coalesce(a.location, '')) = lower(coalesce(b.location, ''))
 and coalesce(a.job_description, '') = coalesce(b.job_description, '')
 and coalesce(a.required_skills, '') = coalesce(b.required_skills, '')
where a.posting_status = 'active' and b.posting_status = 'active'
group by 1, 2
order by identical_posts desc;
```

If an account turns out to be a test account, hide all of its posts (this
deletes nothing and can be undone with `false`):

```sql
update public.employer_job_posts set is_test_posting = true
where employer_id = (select id from public.employer_profiles where company_name = 'COMPANY NAME HERE');
```

An admin can also set or clear the mark on one post with
`PATCH /api/admin/jobs` and `{"job_id": "<post uuid>", "is_test_posting": true}`.

## Catalogue data still to review (2026-11-18)

These need someone who knows the jobs and courses; code cannot decide them.

**PSOC codes (audit DATA-04).** No open job carries a `psoc_unit_code`
(0 of 1,723 on 2026-11-16), so the PSOC 2012 / ISCO-08 reference loaded in
`backend/data/psoc/` is not used for any job. An admin can set a code per post
with `PATCH /api/admin/jobs` (`psoc_unit_code`, four digits, validated against
the reference). To see which titles to code first:

```sql
select job_title, count(*) as open_posts
from (
  select job_title from public.employer_job_posts where posting_status = 'active' and psoc_unit_code is null
  union all
  select job_title from public.internal_jobs where posting_status = 'active' and psoc_unit_code is null
) jobs
group by job_title order by open_posts desc limit 50;
```

**Category names (audit DATA-03).** 120 internal jobs use the older 12 group
names ("Technology/Data/Digital Systems") instead of the 24 career categories,
and 104 have none. The group names are broader than one category (a data
analyst and a web developer share "Technology/Data/Digital Systems"), so they
are not renamed automatically. Spelling variants of level, work setup and
employment type are now shown in one form (`supabase_jobs.py`).

**Learning catalogue (audit DATA-05, AI-03).** None of the 483 resources passes
`resource_is_reviewed` (status active, mapping reviewed, review verified, a
verification date, reviewer and evidence link). Unreviewed rows are still shown,
labelled, so the learning pages are not empty. To work through them:

```sql
select status, review_status, skill_id_mapping_status,
       count(*) as resources,
       count(*) filter (where coalesce(external_course_or_certification_link, '') = '') as no_link,
       count(*) filter (where coalesce(level, '') = '') as no_level,
       count(*) filter (where coalesce(cost_type, '') = '') as no_cost
from public.learning_resources
group by 1, 2, 3 order by resources desc;
```

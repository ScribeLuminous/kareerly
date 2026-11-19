# Baseline: Kareerly resume extraction (Phase 7)

How well the current extractor reads 40 resumes of different formats and
layouts, measured against the ground truth in `../ground_truth/`. Nothing in
the extractor was changed. All figures are reproducible:

```bash
python3 test-data/resume-extraction/scripts/run_extraction_eval.py
```

The full generated tables, per sample and per split, are in
`baseline_tables.md`; scores and error causes per sample are in
`baseline_results.json` (no extracted text is stored). Two runs give
byte-identical results.

## Setup

| | |
|---|---|
| Extractor | `analyze_resume_bytes` (behind `POST /api/resume/analyze`), parser version `2026.09-ocr-columns-doc` |
| OCR | Tesseract 5.3.4, English, as installed by the backend Dockerfile |
| Skills | `SkillExtractor()` built from the repository CSVs; approved taxonomy additions stored in Supabase are not loaded |
| Samples | 40: 15 fully annotated (QRR, JBS, RVK), 25 layout-only placeholder templates (PRS) |
| Images | JPGs are refused at upload. They are scored twice: **as shipped** (refused) and **through the OCR path** (the image wrapped unchanged in an image-only PDF, as a scanned PDF upload would be) |
| Split | Development 25 (QRR, JBS, RVK-01–05, PRS-01–13); held-out test 15 (RVK-06–08, PRS-14–25), by content group. Every sample was viewed during the Phase 5 inventory, so the test split guards against tuning, not against having seen the files. |

Annotations are by one annotator and not yet reviewed; the skill expectations
in particular are judgement calls (see `ANNOTATION_GUIDE.md`).

## Headline results

All 40 samples, images through the OCR path (as shipped, in brackets, where it
differs):

| Field | Result | Main cause of misses |
|---|---|---|
| File accepted | 35/40; 40/40 through the OCR path | JPG/PNG refused at upload |
| Name | 10/15 correct (6/15) | Wrong line chosen |
| Email, phone, location, links | 0%: not extracted | No extractor |
| Summary / objective | 0% of 12: not extracted | No extractor |
| Work experience (27 entries: titles, companies, dates) | 0%: not extracted | No extractor |
| Education entries | 13/22 matched (9/22) | Only one entry returned; degree patterns |
| — degree / programme | 6/22 (3/22) | Patterns miss "Associates Degree", "Bachelor Degree", "Masters Degree" |
| — school | 13/22 (9/22) | |
| — graduation year | 3/22 (1/22) | Year on the degree line or a date line is not read |
| — education level | 6/22 (3/22) | Follows the degree |
| Certifications and training | 12/25 found; year right for 1 of 12 | Section boundaries; dates on their own lines |
| Certification entries that are not certifications | **64 of 76 returned** | Sidebar text and split lines |
| Expected skills | 60/98 (61%); 60/89 (67%) without English Communication | Alias coverage |
| Skills not stated in the resume | 2 of 63 returned | Letter-spacing fallback |
| Section headings recognised | 101/265 (38%); 101/132 (77%) of the kinds Kareerly looks for | Heading vocabulary and format |

Placeholder templates produced **no** false skills and **no** false
certifications: the extractor does not invent content from Lorem ipsum.

## Findings by stage

### 1. File reading is not the bottleneck for digital files

Every annotated value (names, titles, companies, dates, degrees, schools,
certifications, achievements, skills) is present in the text Kareerly extracts
from the 10 fully annotated PDF and DOCX files: **100% text coverage for every
value type**, including two-column, sidebar and letter-spaced layouts. What
goes wrong happens after the text is read.

Two reading problems still matter:

- **Images are refused** (`resume_parser.py:26`, `:133`). As shipped, the five
  JobStreet resumes score 0 on everything, 130 misses in all.
- **Kerning splits words** in one PDF (RVK-08, "New Y ork"). Text coverage is
  unaffected because the checks ignore spacing, but see finding 6.

### 2. OCR reads the images well; Kareerly's clean-up then drops lines

Through the OCR path the five JobStreet images give the right name in 4 of 5,
the education entry in 4 of 5 and 40 of 45 expected skills (89%), better than
the text PDFs (their resumes name more skills plainly). But:

| Value | Raw Tesseract output | After Kareerly's `_ocr_lines` clean-up |
|---|---|---|
| Dates | 10/10 | 8/10 |
| Achievement lines | 15/15 | 11/15 |

`_ocr_lines` (`resume_parser.py:244`) drops lines that are less than half
letters, which removes "(June 2014 – Feb 2015)" and "Students (2014 - 2015)".
Every line it drops here was read correctly by Tesseract. OCR also turns round
bullets into "e" and, in label-column layouts, puts a heading on the same line
as its content, so only 8 of 39 headings are recognised on the images.

These are clean digital images. Phone photos and skewed scans, not yet in the
set, will be harder.

### 3. Section detection is the largest single source of error

| | |
|---|---|
| Headings recognised | 101 of 265 |
| — of the kinds Kareerly looks for (skills, education, experience, certifications, training, projects) | 101 of 132 |
| Lines wrongly taken as headings | 2 |
| Certification entries that are really another section's text | 48 |

Missed headings fall in three groups: kinds Kareerly does not look for at all
(summary, objective, achievements, awards, languages, interests, references,
contact, personal details: 133 headings); names for the supported kinds it
does not know ("Employment", "Pre-Professional Experience", "On-the-Job
Training (OJT)", "Seminars & Trainings", "Courses" variants); and decorated
headings (`_SUMMARY_`, "01 SUMMARY", letter-spaced "P R O F I L E" with text on
the same line). PRS-11, PRS-22, JBS-02 and RVK-08 have no recognised heading
at all.

Because a section runs until the next recognised heading, an unrecognised one
lets the section above it swallow what follows. On sidebar layouts the
"Courses" section absorbs the sidebar: **61 of the 64 false certification
entries come from multi-column / sidebar resumes** (RVK-06 and RVK-07 return 17
each), including street addresses, cities, phone numbers, email addresses and
link labels. These would pre-fill the candidate's certifications.

### 4. Most profile fields have no extractor

Present in the 15 filled examples and never returned: email (15), location
(15), work experience (15 resumes, 27 entries), street address (13), summary
(12), phone (10, plus 5 masked), links (10), achievements (9), languages (9),
references (7), headline (5), training as its own field (4), interests (3),
projects (2). 129 of the 450 misses are this cause.

The job titles, companies and dates are all in the extracted text (100%
coverage), so work history needs an extractor, not better file reading.
Matching today reads the whole text and does not depend on these fields.

### 5. Education and certification entries are assembled from single lines

- **One education entry at most** (`resume_analyzer.py:381`): 6 entries lost
  outright on resumes with two or three.
- **Degree patterns** (`resume_analyzer.py:314`) miss "Associates Degree in",
  "Bachelor Degree in", "Masters Degree in", and stop at the line break of a
  wrapped degree; on JBS-02 "MS Word" is read as a Master of Science.
- **Graduation year** is taken only from lines near the degree and school, so
  "BS Accountancy — Cum Laude (GWA 1.45) 2021 – 2025" gives no year: 3 of 22
  correct.
- **Certifications** are one entry per line: a wrapped title becomes two
  entries and a date line ("Nov", "JANUARY") becomes an entry of its own (16
  entries); the year on the next line is never attached (year right for 1 of
  12); the issuer is always empty.

### 6. Skills: mostly alias coverage, and one layout-triggered precision bug

38 expected skills were missed. 28 have no alias matching the resume's wording
(9 of them are English Communication, which Kareerly deliberately does not
infer from "English" in a language list; the annotation rule counts it, so
recall is also reported without it). Others are generic wording: "Programming"
(Computer programming, 5), "account managers" / "team" (Manage staff, 3),
"sales" (Sales Techniques, 3), "Project Management" in a certificate title (3).

Both false positives come from RVK-08: its letter-spaced headings trigger the
fragmented-spacing fallback (`skill_extractor.py:67`, `:401`), which compacts
the **whole** document and then finds "excel" inside "Excelled" and "git"
inside "digital". Any letter-spaced heading can do this to any resume.

### 7. Names: the first plausible line wins

5 of 15 wrong (`resume_analyzer.py:178`): the "Personal details" heading
(RVK-02, RVK-03), a country (RVK-05, whose real name is letter-spaced), the
name joined with the job title (RVK-08, "John Huber, UX Designer"), and on
JBS-01 a stray OCR digit beside the name, which makes the line fail the
no-digits rule.

## Layout and format

Through the OCR path:

| Group | Name | Education matched | Certifications and training | Skill recall | Headings |
|---|---|---|---|---|---|
| PDF (9) | 5/9 | 8/16 | 12/22 | 16/46 | 24/63 |
| DOCX (26) | 1/1 | 1/1 | 0/3 | 4/7 | 69/163 |
| JPG via OCR (5) | 4/5 | 4/5 | – | 40/45 | 8/39 |
| Single column (13) | 3/5 | 4/6 | 0/8 | 25/37 | 31/82 |
| Left label column (11) | 2/3 | 2/4 | – | 19/24 | 23/67 |
| Multi-column / sidebar (16) | 5/7 | 7/12 | 12/17 | 16/37 | 47/116 |

Read these with care: content differs between groups (the sidebar PDFs are
Resume Viking examples for roles the taxonomy covers thinly), so the skill
column mostly reflects content, not layout. The clean comparisons are the
same-content groups:

| Group | Same content in | Name | Education | Certifications | False certification entries | Skills | Headings |
|---|---|---|---|---|---|---|---|
| JobStreet | 5 image layouts | 4/5 right | 4/5 | – | 0 | 8/9 in every layout | 0–2 of 7 (11 on JBS-05) |
| Account Manager | 3 PDF layouts | 1/3 right | 1/2, 1/2, 0/2 | 2/2, 0/2, 0/2 | 7, 4, 3 | 1/5 in every layout | 3/5, 3/6, 3/6 |
| Qarera | DOCX and PDF | identical | identical | identical | 0 | identical | identical |

Skills are stable across layouts (they are also searched in the full text).
Name, education and certifications change with layout alone, so those are the
layout-sensitive parts of the pipeline. The DOCX and PDF of the same resume
give identical results.

## Where the errors come from

All 450 misses (OCR path), by stage:

| Stage | Misses | Share |
|---|---|---|
| Section detection (headings not recognised, sections running on, false headings) | 220 | 49% |
| Field mapping (no extractor for the field) | 129 | 29% |
| Skill normalisation (alias coverage, generic words, false positives) | 40 | 9% |
| Entity extraction (wrong line, one entry only, split entries) | 51 | 11% |
| Date normalisation | 10 | 2% |
| File parsing / OCR (value missing from the text) | 0 scored* | – |

\* OCR line loss shows in the text-coverage table (finding 2) rather than as
scored misses, because the dropped dates and achievement lines belong to fields
Kareerly does not extract yet. As shipped, a further 130 misses come from
images being refused at upload.

## What this suggests for Phase 8 (proposal, not implemented)

Ordered by the number of misses each would address, all within the existing
pipeline; no new model is indicated:

1. **Section detection**: a wider heading vocabulary (including Philippine
   headings: OJT, Seminars & Trainings, Character References), tolerance for
   numbering, underscores and letter-spacing, headings with text on the same
   line, and ending a section at any heading-like line so sidebars stop
   running into certifications.
2. **New fields, additive to `extracted_profile_json`**: email, phone,
   location, links (simple patterns), summary, work-experience entries with
   normalised dates. No database change: the analysis is stored as JSON.
3. **Entries**: several education entries; degree patterns for "Associates /
   Bachelor / Masters Degree in"; the year from the degree line or the date
   line beside it; certification entries that join wrapped lines, attach date
   lines and split out the issuer.
4. **Images**: accept JPG/PNG through the existing OCR path, keep date lines in
   `_ocr_lines`, and strip bullet glyphs.
5. **Skills**: limit the fragmented-spacing fallback to the letter-spaced
   stretch instead of the whole document; review aliases for the generic
   misses. Whether "English" in a language list should count as English
   Communication is a product decision.
6. **Names**: skip heading and country lines, and split "Name, Title".

Each change should be measured on the development split, then confirmed once
on the test split, with `backend/tests` and the synthetic 180-resume set as
regression checks for matching.

## Limitations

- 15 fully annotated resumes, 8 distinct contents; differences of one or two
  items are not meaningful.
- One unreviewed annotator; skill expectations are the most subjective part.
- No photos or scans of printed resumes, no PNG, no non-English resumes.
- Sample sources are template and example sites, not real applicants.
- Skill results exclude the approved taxonomy additions held in Supabase.

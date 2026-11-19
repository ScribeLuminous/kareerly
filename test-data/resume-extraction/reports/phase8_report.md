# Phase 8: resume extraction improvements

Six areas were improved inside the existing pipeline (no new model, no new
dependency, no database change). Results are measured with the same scorer on
the same files before and after; the "before" figures come from an untouched
checkout of the previous commit.

```bash
python3 test-data/resume-extraction/scripts/run_extraction_eval.py --label after
python3 test-data/resume-extraction/scripts/score_synthetic_fields.py --label after
```

Full tables: `after_tables.md` and `baseline_tables.md` (regenerated with the
extended scorer; every figure in the Phase 7 report is unchanged).

## Results

### All 40 samples, as the app ships

| Field | Before | After |
|---|---|---|
| Files accepted | 35/40 (JPG refused) | 40/40 |
| Name | 6/15 | 14/15 |
| Email, phone, location | not extracted | 15/15, 10/10, 14/15 |
| Headline, summary | not extracted | 4/5, 10/12 |
| Work history (27 jobs) | not extracted | 26/27 found; title 26, company 20, start 26, end 26 |
| Languages, interests, references, projects | not extracted | 21/21, 9/9, 7/7, 2/2 |
| Achievements | not extracted | 27/30 |
| Education entries | 9/22 | 21/22 |
| — degree / school / year / level | 3 / 9 / 1 / 3 of 22 | 21 / 21 / 21 / 21 of 22 |
| Certifications and training | 12/25, year right for 1 | 24/25, year right for 23 |
| Certification entries that are other text | 64 of 76 | 4 of 28 |
| Expected skills | 20/98 | 60/98 (60/89 without English Communication) |
| Skills the resume does not state | 2 of 23 | 0 of 61 |
| Section headings recognised | 93/265 | 250/265 |
| Lines wrongly taken as headings | 1 | 4 |
| Scored misses | 501 | 94 (13 are street addresses, not extracted by design) |

Images through OCR in both versions (the fairer comparison for extraction,
since the old code refuses images): name 10 → 14 of 15, education 13 → 21
of 22, skills 60 → 60 of 98, misses 450 → 94.

### Held-out test split (looked at once, after development)

| Field | Before | After |
|---|---|---|
| Name | 2/3 | 3/3 |
| Email, phone, location, headline | not extracted | 3/3 each |
| Work history (7 jobs) | not extracted | 7/7 found; title 7, **company 3**, dates 7 |
| Education entries | 3/5 | 4/5 |
| Certifications and training | 3/6 | 5/6 |
| Certification entries that are other text | 34 of 37 | 3 of 8 |
| Section headings | 40/100 | 93/100 |
| Skills the resume does not state | 2 | 0 |

The test split confirms the development gains, with one gap: a non-Philippine
town written after the company ("Amazon, Miami Gardens", "Blue Penguin
Designs, Bar Bigha") is not recognised as a place and stays in the company
name. It was not tuned after being seen.

### 180 synthetic resumes (10 layouts not used for development)

| Field | Before | After |
|---|---|---|
| Name | 180/180 | 180/180 |
| Email, phone | not extracted | 180/180, 180/180 |
| Location, headline | not extracted | 172/180, 174/180 |
| Jobs found (349) | not extracted | 343/349 |
| — title / company / start / end | – | 327 / 340 / 343 / 343 |
| Jobs returned that are not jobs | – | 6 |
| Education entries found (200) | 159 | 200 |
| — school / graduation year | 144 / 20 | 194 / 200 |
| Skills (recall of spec skills; intentionally missing skills extracted) | 0.549; 0 | 0.549; 0 |

## What changed

| Area | Change | Files |
|---|---|---|
| Intake | JPG and PNG accepted, checked by content; read with the existing OCR, turned upright from EXIF, enlarged when small, contrast stretched | `resume_parser.py`, frontend upload and preview |
| OCR clean-up | Date and year lines kept; bullets read as "e" or "©" removed; table-rule noise removed | `resume_parser.py` (`_ocr_lines`) |
| PDF reading order | Sidebars holding 4–10% of a page are columns when their gutter is clean; a column of right-aligned dates is never one; kerning-split pages are re-read with pdfplumber | `pdf_layout.py`, `resume_parser.py` |
| Section detection | 15 kinds of section with Philippine headings (OJT, Seminars & Trainings, Character References, Educational Attainment, Eligibility); numbering, underscores, symbols and letter-spacing ignored; headings with text on the same line or wrapped over two lines; every heading ends the section above | `resume_analyzer.py` |
| New fields | Email, phone, location, links, headline, summary, work history with normalised dates, languages, interests, achievements, projects, references; `field_confidence` per field | `resume_fields.py` (new), `resume_analyzer.py` |
| Education | Every entry, highest level first; "Associates/Bachelor/Masters Degree in", BSIT-style abbreviations, senior high strands, NC II programmes and training centres; year from the degree or date line; in-progress degrees; wrapped school names | `resume_analyzer.py` |
| Certifications | Wrapped titles joined, date lines attached, issuer split, certification/training/license labelled; contact lines, link labels and personal details dropped; credentials stated in the summary | `resume_analyzer.py` |
| Skills | The letter-spacing fallback joins only letter-spaced stretches, not the whole resume | `skill_extractor.py` |
| Names | Nearest to the email or phone line or first line wins; headings, labels, addresses and role words skipped; "Name, Title" split; stray OCR marks trimmed; five-word names with particles; surnames that are also towns kept | `resume_analyzer.py` |

`RESUME_PARSER_VERSION` is now `2026.11-sections-fields-images` (backend and
frontend). Saved analyses from the old version are shown as read by an older
reader, and the dashboard offers to read the original file again, as it did
for the previous version bump.

## Compatibility

- **Additive only.** Every existing `candidate_profile` key is kept. Education
  entries keep their four keys and add `location`, `start_date`, `end_date`,
  `honors`, `in_progress`; certification entries keep `title`, `issuer`,
  `year` and add `kind`, `dates_as_written`, `source_section`. New fields are
  stored inside the existing `extracted_profile_json`; no schema change.
- **Education order.** Several entries can now be returned, highest level
  first, so the profile form's pre-fill (`education[0]`) gets the highest
  attainment.
- **The UI does not show the new fields yet**; they are returned by
  `/api/resume/analyze` and saved with the analysis.
- **Contact details** were already stored in `resumes.parsed_text`; the new
  fields add no new place they are kept.

## Effect on matching (180 synthetic resumes, 360 rows)

Matching reads the resume text and its sections; the text of the synthetic
PDFs is unchanged, but more headings are now recognised, which changes the
section passages the matcher compares.

| | Before | After |
|---|---|---|
| Skills extracted | identical (one resume lists the same skills in a different order) | |
| Top match in the target category | 247 | 246 |
| Fit-Now matches | 545 | 548 |
| Aspiration matches | 6,290 | 6,383 |
| Rows whose top score changed | | 79 (mean 0.0035, largest 0.078) |
| Rows whose top match changed | | 4 |

Of the four changed top matches, two stay in the same category (CAT12-R05,
STRESS-008 ×2) and one moves out of it: CAT15-R02 (caregiving, no Fit-Now
match either way) now tops at Housekeeping Attendant (0.40) instead of Care
Home Supervisor (0.43). If matching must stay exactly as before, the matcher
can be pinned to the previous section splitter; the extraction gains do not
depend on it.

## Tests

| Suite | Before | After |
|---|---|---|
| Backend (`pytest backend/tests`) | 606 passed, 1 skipped | 648 passed, 1 skipped (42 new in `test_resume_extraction_improvements.py`) |
| Frontend (`npm test`) | – | 245 passed |
| TypeScript (`tsc -b`) | – | passes |
| ESLint | 32 problems | 32 problems (none in changed code; `Dashboard.tsx` 12 before and after) |

`backend/tests/test_training_today.py` fails to import in both versions
because `pyarrow` (from `requirements-learning.txt`) is not installed here; it
is unrelated to resume reading. Real Tesseract OCR is exercised by one test,
skipped where Tesseract is absent; the other image tests stub OCR.

## Remaining errors and limits

- Job company and location when an unrecognised town follows the company
  (test split: company 3/7).
- A name printed letter by letter with single spaces ("R O B E R T C O O P E R")
  cannot be split into words and is left empty.
- Skill recall is unchanged (60/98): the misses are vocabulary, not reading
  (below).
- Photos and scans of printed resumes, PNG files and non-English resumes are
  still not in the sample set; image support is tested on clean exports only.
- The annotations are by one unreviewed annotator; development scores are
  optimistic by construction, which is why the test split and synthetic set
  are reported separately.

## Skill aliases for review (not applied)

These canonical skills were named in the resumes but not returned. Adding
aliases changes the reviewed taxonomy and matching, so they are listed for
review rather than added.

| Skill | Missed in | Wording in the resumes |
|---|---|---|
| SK031 English Communication | 9 | "English" in a language list (product decision) |
| SK165 Computer programming | 5 | "Programming (Java, C++, …)" — generic word filtered |
| SK023 Sales Techniques | 3 | "upselling", "sales growth" |
| SK215 Perform project management | 3 | "Certificate in Project Management" |
| SK261 Manage staff | 3 | "Manage a national team of five Account Managers" |
| SK187 Audit techniques | 2 | "audit fieldwork", "working papers" |
| SK260 Accounting | 2 | "BS Accountancy", "accounting staff" |
| SK059, SK061, SK085, SK399 | 1 each | "childcare", "CPR certification", "prepare the evening meal", "tutoring" |
| SK117, SK099, SK042, SK663 | 1 each | "surveillance, CCTV monitoring", "warehouse duties", "re-designing existing UIs", "Illustrator" |
| SK615, SK577, SK347 | 1 each | "Foundations in Criminal Law", "Supply Chain Principles", "hi-fi interactive prototypes" |

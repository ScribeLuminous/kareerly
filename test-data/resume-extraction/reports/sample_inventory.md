# Sample inventory and first observations (Phase 5)

Inventory of the 40 resume samples received on 2026-11-19, and how Kareerly's
current extractor (`RESUME_PARSER_VERSION = "2026.09-ocr-columns-doc"`) reads
each one. Samples are referred to by ID only; see `../manifest.csv`.

This is an inventory, not the accuracy baseline. There is no ground truth yet,
so the counts below show what the extractor returned, not whether it was
right, except where a result is plainly wrong (a heading returned as a name, a
contact line returned as a certification).

## How the files were read

- Every file was run through `analyze_resume_bytes`, the function behind
  `POST /api/resume/analyze`, with Tesseract 5.3.4 installed as in production.
- JPG files are refused at upload today ("Please upload a PDF, DOCX or DOC
  resume."). To see what the existing OCR path would do with them, each JPG
  was also wrapped unchanged in an image-only PDF (the same as uploading a
  scanned PDF). Those results are marked * below.
- Layouts were classified by eye from rendered pages (DOCX rendered with
  LibreOffice).

## What the set contains

| | Count |
|---|---|
| Files | 40: 26 DOCX, 9 PDF, 5 JPG |
| Filled examples (real-looking content) | 15: QRR ×2, JBS ×5, RVK ×8 |
| Placeholder templates (Lorem ipsum, "Your Name", "MONTH 20XX") | 25: PRS-01 to PRS-25 |
| Same content in several layouts or formats | JBS-01–05 (5 layouts), RVK-01–03 (3 layouts), QRR-01/02 (DOCX and PDF) |
| Multi-column or sidebar layouts | 16 (9 PRS, 1 JBS, 6 RVK) |
| Left label or date column layouts | 11 (8 PRS, 2 JBS, 1 RVK) |
| With a photo | 7 (RVK) |
| Multi-page | 29 (2–3 pages); 2 have a short last page (RVK-03, RVK-08) |
| Need OCR | 5 (JBS); none of the PDFs is scanned |
| Philippine resume conventions (OJT, seminars, character references, date of birth) | 7 (QRR ×2, JBS ×5) |
| Accepted by Kareerly's upload checks today | 35 (all but the 5 JPGs) |

Not in this set yet: scanned PDFs, photos of printed resumes, PNG files,
resumes in Filipino or another language, and resumes that previously failed in
Kareerly.

## Per-sample results

Name: "correct" means the right line was returned; "placeholder" means the
template's "Your Name" was returned, which is correct for a blank template;
"wrong line" means another line was returned. Sections recognised excludes
the text before the first heading. Skills are the canonical skills shown in
Step 2.

| ID | Format | Pages | Read by | Layout | Features | Column re-ordering | Name | Sections recognised | Edu | Certs | Skills |
|---|---|---|---|---|---|---|---|---|---|---|---|
| JBS-01 | JPG | 1 | OCR (as scanned PDF)* | single column | – | – | **wrong line** | technical skills, education | 1 | 0 | 8 |
| JBS-02 | JPG | 1 | OCR (as scanned PDF)* | left label column | – | – | correct | **none** | 1 | 0 | 8 |
| JBS-03 | JPG | 1 | OCR (as scanned PDF)* | left label column | – | – | correct | technical skills, education, experience | 0 | 0 | 8 |
| JBS-04 | JPG | 1 | OCR (as scanned PDF)* | single column shaded heading bars | icons/graphics | – | correct | technical skills, education | 1 | 0 | 8 |
| JBS-05 | JPG | 1 | OCR (as scanned PDF)* | two column grid boxes | icons/graphics | – | correct | technical skills, education | 1 | 0 | 8 |
| PRS-01 | DOCX | 2 | text layer | single column | – | – | placeholder | education, experience, skills | 1 | 0 | 0 |
| PRS-02 | DOCX | 2 | text layer | single column | – | – | placeholder | education, experience, skills | 0 | 0 | 0 |
| PRS-03 | DOCX | 1 | text layer | two column right sidebar | tables | – | placeholder | education, experience, skills | 0 | 0 | 0 |
| PRS-04 | DOCX | 2 | text layer | single column | – | – | placeholder | education, experience, skills | 0 | 0 | 0 |
| PRS-05 | DOCX | 2 | text layer | left label column | tables | – | **wrong line** | education, experience, skills | 0 | 0 | 0 |
| PRS-06 | DOCX | 2 | text layer | left label column | tables | – | placeholder | education, experience, skills | 0 | 0 | 0 |
| PRS-07 | DOCX | 2 | text layer | single column dates left | – | – | placeholder | education, experience, skills | 0 | 0 | 0 |
| PRS-08 | DOCX | 2 | text layer | single column | – | – | placeholder | education, experience, skills | 0 | 0 | 0 |
| PRS-09 | DOCX | 2 | text layer | single column shaded label block | tables, icons/graphics | – | placeholder | education, experience, skills | 0 | 0 | 0 |
| PRS-10 | DOCX | 1 | text layer | two column left block | tables, text boxes, icons/graphics | – | **wrong line** | skills, education, work experience | 0 | 0 | 0 |
| PRS-11 | DOCX | 2 | text layer | single column | tables | – | placeholder | **none** | 0 | 0 | 0 |
| PRS-12 | DOCX | 2 | text layer | two column right sidebar | tables, icons/graphics | – | placeholder | education, experience, skills | 0 | 0 | 0 |
| PRS-13 | DOCX | 2 | text layer | single column | – | – | **wrong line** | education, work experience | 0 | 0 | 0 |
| PRS-14 | DOCX | 2 | text layer | two column left contact | tables, text boxes | – | placeholder | education, experience, skills | 0 | 0 | 0 |
| PRS-15 | DOCX | 2 | text layer | single column centered | – | – | placeholder | education, experience, skills | 0 | 0 | 0 |
| PRS-16 | DOCX | 2 | text layer | left label column | tables | – | **wrong line** | education, experience, skills | 0 | 0 | 0 |
| PRS-17 | DOCX | 2 | text layer | single column | tables, icons/graphics | – | **wrong line** | education, experience, skills | 0 | 0 | 0 |
| PRS-18 | DOCX | 2 | text layer | left label column | tables | – | placeholder | education, experience, skills | 0 | 0 | 0 |
| PRS-19 | DOCX | 1 | text layer | two column right sidebar | tables | – | placeholder | education, experience, skills | 0 | 0 | 0 |
| PRS-20 | DOCX | 2 | text layer | left label column | tables | – | placeholder | education, experience, skills | 0 | 0 | 0 |
| PRS-21 | DOCX | 2 | text layer | two column left sidebar | tables | – | **wrong line** | skills, education, experience | 0 | 0 | 0 |
| PRS-22 | DOCX | 3 | text layer | left label column | tables | – | placeholder | **none** | 0 | 0 | 0 |
| PRS-23 | DOCX | 2 | text layer | two column left sidebar | tables | – | placeholder | skills, education, experience | 0 | 0 | 0 |
| PRS-24 | DOCX | 2 | text layer | two column left sidebar | tables | – | placeholder | education, experience | 1 | 0 | 0 |
| PRS-25 | DOCX | 2 | text layer | three zone dates main sidebar | tables | – | placeholder | skills, education, experience | 0 | 0 | 0 |
| QRR-01 | DOCX | 1 | text layer | single column | – | – | correct | education, skills | 1 | 0 | 4 |
| QRR-02 | PDF | 1 | text layer | single column | – | – | correct | education, skills | 1 | 0 | 4 |
| RVK-01 | PDF | 2 | text layer | header banner left sidebar | photo, icons/graphics | page 2 | correct | skills, education, courses | 1 | 9 | 1 |
| RVK-02 | PDF | 2 | text layer | two column left sidebar | photo, icons/graphics | page 1 | **wrong line** | skills, education, courses | 1 | 4 | 1 |
| RVK-03 | PDF | 3 | text layer | single column details table | photo | page 2 | **wrong line** | education, skills, courses | 0 | 3 | 1 |
| RVK-04 | PDF | 2 | text layer | header banner right sidebar | photo, icons/graphics | page 2 | correct | education, courses | 1 | 11 | 0 |
| RVK-05 | PDF | 2 | text layer | two column left sidebar | photo, icons/graphics | page 1 | **wrong line** | skills, training, employment history, education | 1 | 12 | 0 |
| RVK-06 | PDF | 2 | text layer | two column right sidebar | photo, icons/graphics | page 1 | correct | employment history, education, courses, skills | 1 | 18 | 2 |
| RVK-07 | PDF | 1 | text layer | two column right sidebar | photo, icons/graphics | page 1 | correct | employment history, education, courses, skills | 1 | 19 | 5 |
| RVK-08 | PDF | 2 | text layer | single column dates left | – | – | **wrong line** | **none** | 1 | 0 | 5 |

\* Read with OCR after wrapping the JPG in an image-only PDF; a real JPG upload is refused.

## Recurring patterns

Each finding names the stage it comes from. "Confirmed" means it was
reproduced on these files.

### File reading and OCR

1. **Image uploads are refused** (upload checks). All five JBS images are
   rejected, although the existing OCR path reads them: through it, all five
   produce the same 8 skills. Supporting JPG/PNG is mainly an intake change.
2. **The OCR clean-up throws away date lines** (OCR post-processing, confirmed).
   `_ocr_lines` (`resume_parser.py:244`) drops any line whose characters are
   less than half letters. Tesseract reads "Students (2014 - 2015)",
   "(June 2014 – Feb 2015)" and "(2010 – 2015)" correctly on JBS-05, and the
   filter removes all of them. On every scanned or photographed resume this
   loses employment dates and graduation years.
3. **Bullets become letters and stray marks join lines** (OCR noise,
   confirmed). Round bullets are read as "e" ("e Hardware troubleshooting") on
   all five JBS images. On JBS-01 the photo placeholder adds a "3" to the name
   line; the name check rejects lines with digits, so a skills line was
   returned as the name.
4. **The left-label layout merges label and content** (OCR layout, confirmed).
   On JBS-02 OCR puts each heading on the same line as its first content line,
   so no section heading is recognised, and the degree is read from "MS Word,
   Excel…" (the "MS" degree pattern matches Microsoft Word). The same content
   laid out differently (JBS-04, JBS-05) gives the right degree.
5. **Sidebars on page 1 are not separated** (multi-column reading order,
   confirmed). Column re-ordering triggered on page 1 of RVK-02, 05, 06 and 07
   but only on page 2 of RVK-01, 03 and 04, whose page 1 has a full-width
   photo banner above the sidebar. Sidebar text (address, phone, email, place
   of birth, links, languages) then runs into the main column. In RVK-02 the
   sidebar's "Languages" block lands inside the job history.
6. **Kerning splits words** (PDF text extraction, confirmed). RVK-08 reads as
   "New Y ork", "W orking", "FinT ech", "T emplates": pypdf turns tight
   letter spacing into spaces. Skill names can split the same way.
7. **DOCX tables can put all headings before all content** (DOCX reading
   order, confirmed). PRS-22 stores headings in one table column and content in
   the next; the text lists "01 SUMMARY … 05 INTERESTS" first and every entry
   after, so no section has a body.

### Section detection

8. **Many common headings are not recognised** (heading vocabulary,
   confirmed). Missed in these files: "Employment" (RVK-01–03), "Career
   Objective", "Personal Skills", "Pre-Professional Experience",
   "Achievements / Responsibilities", "References" (all JBS), "On-the-Job
   Training (OJT)", "Seminars & Trainings", "Leadership & Activities",
   "Character References" (QRR), "Languages", "Personal details", "Awards",
   "Accomplishments", "Interests". A work-experience heading is recognised in
   only 4 of the 15 filled examples (JBS-03, and "Employment History" on RVK-05–07).
9. **Decorated headings are not recognised** (heading format, confirmed):
   `_SUMMARY_` (PRS-11), "01 SUMMARY" (PRS-22), and letter-spaced headings
   followed by text on the same line, "P R O F I L E Proactive…" (RVK-08).
   These three files have no recognised section at all.
10. **An unrecognised heading's content joins the section above it**
    (section boundaries, confirmed). On RVK-04–07 the "Courses" or "Training"
    section runs on into the sidebar, so every following line becomes a
    certification: 11–19 "certifications" each, including the street address, city, phone
    number, email, "Driving license" and link labels (RVK-07). These are the
    lines that would pre-fill the candidate's certifications.

### Field extraction and normalisation

11. **The name is taken from the wrong line** (name heuristic, confirmed):
    the "Personal details" heading (RVK-02, RVK-03), a country (RVK-05), the
    name joined with the job title (RVK-08), a skills line (JBS-01), and on
    templates "Job Title", "Degree University Name" or Lorem ipsum words. 5 of
    the 15 filled examples have the wrong name line.
12. **Education is inconsistent for the same content** (education regex,
    confirmed). JBS-01–05 hold the same degree; the extractor returns it
    correctly for 3, a wrong "degree" for 1 (JBS-02) and nothing for 1 (JBS-03).
    RVK-01–03 return 1, 1 and 0 entries. At most one entry is ever returned.
13. **Few skills on non-entry-level profiles** (skill vocabulary, not
    extraction). RVK-01–03 list "Client Relationship Management", "Team
    Leadership", "Strategic Planning", "Sales Growth" and the extractor finds 1
    canonical skill; RVK-04 (au pair) and RVK-05 (security guard) give 0. The
    text is read correctly; these skills are not in Kareerly's taxonomy, which
    is built around Philippine entry-level roles. This is a taxonomy-coverage
    question, separate from extraction.
14. **Contact details, work entries, dates and projects are not extracted at
    all** (no extractor exists), as noted in the Phase 1 review.

### What held up well

- Text extraction of every DOCX worked, including text boxes (PRS-10, PRS-14)
  and table-based sidebars, and the DOCX and PDF of the Qarera resume give
  identical results.
- Skills are stable across layouts: JBS-01–05 give the same 8 skills and
  RVK-01–03 the same 1, because skills are also searched in the full text.
- OCR on clean digital images reads two-column grids in a sensible order
  (JBS-05).

## Assessment: one pipeline, better parts

None of the layouts needs its own extraction algorithm. Every failure above
maps to a stage of the existing pipeline:

| Stage | Fix within the existing pipeline |
|---|---|
| Intake | Accept JPG/PNG and pass them to the existing OCR path, with EXIF rotation |
| OCR clean-up | Keep date and number lines; remove bullet glyphs instead of letting them become "e" |
| PDF reading order | Detect sidebars below a full-width banner; join kerning-split words |
| DOCX reading order | Read table rows as label + content pairs where a column holds only headings |
| Section detection | A wider heading vocabulary (including Philippine headings), tolerate decorations and same-line content, and close a section at any heading-like line |
| Fields | Name, contact, work entries and dates as new fields, additive to `extracted_profile_json` |

These are recommendations to confirm against the baseline in Phase 7; nothing
has been changed.

## Gaps to fill before the baseline

- Ground truth: 15 filled examples can be annotated now. The 25 placeholder
  templates can be annotated for layout (sections and their order, entry
  counts) but not for field values.
- Photos and scans: the JBS images are clean digital exports. The weakest real
  case, a phone photo of a printed resume, is not represented. Printing two or
  three of these samples and photographing them would add that case with the
  same ground truth.
- Split: assign development and held-out test samples by content group
  (JBS-01–05 together, RVK-01–03 together, QRR-01/02 together) once the photo
  and scan samples arrive, so both splits contain OCR cases.

## Source citations still to verify

The four source pages could not be opened from this environment (the network
policy blocks those sites), so the APA references in `../README.md` use the
organisation as author, the page title taken from the URL, "n.d." and a
retrieval date. Check the exact title, any author byline and the publication
or update date on each page before using them.

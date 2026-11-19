# Ground-truth annotation guide

One JSON file per sample in `ground_truth/<sample_id>.json`. Each file states
what a correct extractor should return for that document, and keeps three
cases apart: information the resume **contains**, information it **does not
contain**, and information it shows only as **placeholder or masked** text.
Nothing is filled in from outside the document.

Check the files with:

```bash
python3 test-data/resume-extraction/scripts/validate_ground_truth.py
```

The validator checks the structure, the skill IDs, and, when the sample files
are in `private/`, that every annotated value really appears in the document.

## Levels

- `full`: every field annotated (filled examples: QRR, JBS, RVK).
- `layout_only`: sections, entry counts and false positives only (the PRS
  placeholder templates). Field values are `placeholder`.

`review_status` starts as `unreviewed`. A second person should review each file
and set `reviewed`, recording disagreements in `notes`.

## Field status

Every field has a `status`:

| Status | Meaning | How it is scored |
|---|---|---|
| `present` | The resume states it | Extractor must find it |
| `absent` | The resume does not contain it | Extractor should return nothing; anything returned is a false positive |
| `placeholder` | Template text ("Your Name", Lorem ipsum) | Not scored for value |
| `masked` | Present but obscured ("0917 - XXX - XXXX") | Not scored |

`null` inside a present field means that detail is not stated (for example a
certification with no issuer). Kareerly's current extractor returns `""` for
unknown values; the evaluation treats `""` and `null` alike.

## Fields

Education and certification entries use the same keys as Kareerly's
`candidate_profile` (`backend/app/services/resume_analyzer.py`), so results can
be compared directly; the other fields are new and additive.

| Field | Shape |
|---|---|
| `full_name` | `value`; `as_printed` when capitals or spacing differ |
| `headline` | `value` (job title or degree under the name) |
| `email`, `phone` | `sha256` of the normalised value (see Privacy) |
| `location` | `value`, city level only |
| `street_address` | `sha256` |
| `links` | `count`; `sha256` list when real URLs are printed |
| `personal_details` | `items`: which of `date_of_birth`, `place_of_birth`, `nationality`, `driving_license` appear; `date_of_birth_sha256` |
| `summary` | `value`, `section_type` (`profile` or `objective`) |
| `work_experience` | `entries`: `job_title`, `company`, `department`, `location`, `start_date`, `end_date`, `is_current`, `dates_as_written`, `employment_type` |
| `education` | `entries`: `highest_educational_attainment`, `degree_program`, `school_university`, `year_graduated` (Kareerly keys), plus `location`, `start_date`, `end_date`, `dates_as_written`, `honors`, `in_progress` |
| `skills_stated` | `values`: the skills section as written |
| `certifications` | `entries`: `title`, `issuer`, `year` (Kareerly keys), plus `kind` (`certification` or `license`), `section`, `dates_as_written` |
| `training` | `entries`: `title`, `provider`, `date`, `section`, `dates_as_written` |
| `projects` | `entries`: `name`, `context`, `section` |
| `achievements` | `entries`: `text`, `section` |
| `languages`, `interests` | `values` |
| `references` | `value`: `available_on_request` or `listed` |

Layout-only files give `entry_count` for `work_experience`, `education` and
`achievements` instead of entries (`null` when the template's items cannot be
counted).

### Dates

`start_date` and `end_date` are `YYYY-MM` or `YYYY`; a current role or degree
ends with `present`. The text as printed is kept in `dates_as_written` so date
normalisation can be scored separately. `year_graduated` is the end year of a
completed degree and `null` while it is in progress. A certification's `year`
is the year it was obtained, or the end year of a printed range.

### Education level

`highest_educational_attainment` is one of Kareerly's `EDUCATION_LEVELS`
(`backend/app/services/education.py`) or `null` when the entry is not a degree
(certificate programmes, diplomas, short courses). An unfinished degree is
`Some College`.

## Classification rules

These decide the cases a reader could file two ways:

1. **Keep entries where the resume puts them.** A certificate programme listed
   under Education is an education entry; a section heading decides the
   section `type`.
2. **Certification or training.** An item whose name says it is a credential
   (certified, certificate, certification, licence) or is a known professional
   credential (CDA, CKAM, CPR certification) is a certification; seminars,
   courses and programmes are training. Credentials stated only in the summary
   are certifications too, with `section` naming where they appear.
3. **Licences.** A professional licence (a commercial driver's licence, a
   board licence) is a certification with `kind: license`. A plain "Driving
   license: Full" in personal details is a personal detail, not a licence.
4. **Internships and OJT** are work experience with
   `employment_type: internship`.
5. **Achievements** cover awards, honours and leadership roles, wherever they
   appear (a Dean's List line in Education counts).
6. **Projects** include an academic thesis or capstone.
7. **Duplicated items** in the source are listed once, with a note.

## Section annotation

`sections` lists every visible section with its canonical `type`, its printed
`heading` (`null` for an unheaded block such as the contact line under the
name) and its `region` (`header`, `main`, `sidebar`, `label_column`, or a
grid position). Types: `contact`, `personal_details`, `summary`, `skills`,
`experience`, `education`, `certifications`, `training`, `projects`,
`achievements`, `languages`, `interests`, `references`, `links`.

Section detection is scored as a set of (type, heading) pairs; order within a
region is recorded but not scored.

## Expected skills

Skills are scored against Kareerly's canonical IDs in
`backend/data/skills_reference.csv`:

- `expected_skill_ids`: canonical skills the resume **names** explicitly
  anywhere (skills section, summary, duties, training), or by an unambiguous
  synonym (MS Word → Microsoft Office). English listed as a language counts as
  English Communication (SK031).
- `acceptable_skill_ids`: skills that the duties reasonably imply but do not
  name. Extracting them is not counted against the extractor; missing them is
  not counted either.
- Anything else extracted is a false positive. `notes` names likely traps
  (for example "Networking" meaning professional networking, not Network
  Administration).

## Privacy

Committed files hold no contact details. Email, phone, street address, links
and date of birth are stored as SHA-256 digests of a normalised value, so an
extractor's output can be compared without the value itself:

| Field | Normalisation before hashing |
|---|---|
| email | trim, lower-case |
| phone | digits only |
| street address | lower-case, every run of non-alphanumerics replaced by one space, trimmed |
| link | lower-case, without `http(s)://` and `www.`, no trailing `/` |
| date of birth | ISO `YYYY-MM-DD` |

Names and city-level locations are kept as text: the samples are published
examples with fictional people. Ground truth for real candidate resumes must
stay in `private/` and is never committed.

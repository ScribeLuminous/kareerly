# PSOC API integration (Phase 2, 2026-09-27)

Branch `krly/psoc-api-integration`, from `main` at `beeda30`. It is independent
of the ESCO branch (`krly/esco-skill-implementation`); neither needs the other.

## 1. What the audit found before any change

| Area | Finding | Category |
|---|---|---|
| PSA Classifications API client | `backend/scripts/import_reference_data.py psoc`, a manual maintainer script. It downloaded the four PSOC 2012 levels and wrote CSVs and `load.sql` locally. | client exists but unused/incomplete |
| Client robustness | Token sent as `?token=` with no redaction (an `HTTPError` or traceback printed the full URL). 60 s timeout, no retries, no validation, any failure aborted with a traceback. | incomplete |
| Imported PSOC data | Never committed: `backend/data/corpus/reference/` is empty and untracked. The migration `20260918090000_occupation_skill_reference.sql` creates `psoc_groups` and `psoc_esco_occupation_links`, but no runtime code, frontend page or scheduled job reads them. | no working implementation |
| Jobs | Neither `reference_jobs.csv` nor the Supabase `jobs` table has a PSOC column. No job occupation is classified. | no working implementation |
| Skills | `skills_reference.csv` has a hand-entered `psoc_code` / `psoc_category` per skill (86 unit codes), identical to `isco08_code` on all 694 rows. It is not read by matching. | offline data only |
| Training | The workbook sheet "Category-PSOC Map" is read only by offline training scripts. | offline data only |
| Production | Nothing in the deployed backend or website calls the PSA API. | — |

Nothing PSOC-related is API-powered in production, before or after this branch.

## 2. What was added

### Hardened client (the existing one, extended; no second client)

`scripts/import_reference_data.py`:

- **Timeouts and bounded retries.** 30 s per request (`--timeout`). `--retries` (default 2) applies to 5xx, 429, timeouts, connection errors and invalid JSON, with exponential backoff. Other 4xx answers are not retried; 401 and 403 say "check PSA_API_TOKEN".
- **Clear failures.** Every failure is a `PsocApiError`. The `psoc` command prints one line, says the published reference is unchanged, and exits 2, with no traceback.
- **Token redaction.** `redact()` replaces the `token=` query value and the token string. Error messages carry only the redacted URL. The original exception, which holds the real URL, is not chained (`from None`), so it cannot reach a traceback or an error reporter. A response body that echoes the token is not saved. The token is read from `PSA_API_TOKEN` (environment or `backend/.env`, which is git-ignored) and never written anywhere.
- **Validation without correction.** `validate_psoc()` lists these problems in `psoc_validation.csv` and changes nothing:
  - codes that aren't numbers or are too long for their level;
  - missing titles;
  - duplicate codes;
  - records from another version;
  - groups whose parent is missing.
- **Last-known-good reference.** `psoc --publish` writes `backend/data/psoc/psoc_2012_groups.csv` and `psoc_reference_meta.json`, which record:
  - the pinned version (2012);
  - `retrieved_at`;
  - the SHA-256 of the raw response and of the CSV;
  - row counts;
  - a token-free source URL.

  Files are staged and swapped in only when complete. Nothing is published when the API fails, when validation finds problems (exit 3) or when no unit groups arrive.

### Runtime: read-only, no network

`backend/app/services/psoc_reference.py`:

- **`reference_status()`**, shown under `psoc_reference` in `/api/health/config`: whether a reference is available, its version and `retrieved_at`, its age in days, and whether it is stale. Stale means older than `PSOC_REFERENCE_MAX_AGE_DAYS`, default 365. A stale reference is still used, and flagged.
- **`validate_occupation_code(code)`**: whether a code is a PSOC 2012 group, with its level, title, parent and crosswalk status. It never corrects a code: `110` is reported as unknown, with a hint to use `0110`.
- **`isco_crosswalk(code)`**: the recorded PSOC → ISCO-08 row.

No module under `backend/app` contains the PSA host or the token variable, and a test enforces this. Matching never waits on the PSA API.

### Discrepancy reports, never rewrites

- `psoc-compare --against <csv|xlsx> --code-column … --title-column … [--level-column …] [--sheet …]` compares the reference with another list, such as the PSA 2022 updates workbook or an export of the stored `psoc_groups` table. It writes `psoc_discrepancies_<file>.csv` with these kinds:
  - `missing_in_reference`
  - `missing_in_other`
  - `title_differs`
  - `level_differs`
  - `code_format` (a spreadsheet dropped a leading zero)
- `psoc-check` does the same for the codes stored in `skills_reference.csv`.

### PSOC → ISCO-08 → ESCO, only where verified

`psoc-crosswalk --isco <ESCO ISCOGroups_en.csv>` classifies every PSOC group:

- `isco_match`: the same code exists in ISCO-08 and the titles share words;
- `ambiguous`: the same code exists but the titles differ (renamed or re-scoped for the Philippines);
- `philippine_specific`: the code is not in ISCO-08.

Every row is `review_status = proposed`. When the crosswalk file exists, `link` proposes ESCO occupations for `isco_match` units only and lists the held-back units in `SUMMARY.md`. Without the crosswalk, `link` behaves as before.

ESCO occupation profiles are never used to derive a vacancy's skills. A job's skills come only from its own text or requirement list (Phase 1). PSOC describes the occupation group.

**Offline result on the stored codes.** `psoc-crosswalk --stored-skill-codes` ran against ESCO v1.2.1 `ISCOGroups_en.csv`: of the 86 PSOC unit codes in `skills_reference.csv`, 84 are `isco_match` and 2 are `ambiguous`:

- 4416 "Human Resources Clerks" vs ISCO "Personnel clerks";
- 4225 "Contact Centre Information Clerks" vs ISCO "Enquiry clerks".

Neither was changed.

## 3. What could not be done here

- **The PSA API was not reached.**
  - `classification.psa.gov.ph` is not reachable from this environment, and no token was available. The response format was therefore not confirmed against live documentation.
  - The client accepts the shapes the existing code already handled: a bare list, or `results` / `data` / `items` with `next`.
  - An unexpected shape now fails clearly instead of being guessed.
  - No PSOC reference is published in this branch. `/api/health/config` reports `available: false` until a maintainer runs the command below.
- **The 2022 updates workbook was not provided.** `psoc-compare` is ready for it, and the report lists every difference for review.
- **Job occupation classification.** Jobs have no PSOC column, so there is nothing to validate yet. `validate_occupation_code` is the check to call once a job carries a code. Adding the column is a schema change for a later, reviewed migration.

## 4. Maintainer steps

```bash
cd backend
# PSA_API_TOKEN in backend/.env (git-ignored) or the shell environment
python3 scripts/import_reference_data.py psoc --publish
python3 scripts/import_reference_data.py psoc-crosswalk --isco <ESCO folder>/ISCOGroups_en.csv
python3 scripts/import_reference_data.py psoc-check
python3 scripts/import_reference_data.py psoc-compare --against <PSOC 2022 updates.xlsx> \
    --code-column "<code column>" --title-column "<title column>"
git add data/psoc/psoc_2012_groups.csv data/psoc/psoc_reference_meta.json data/psoc/psoc_isco_crosswalk.csv
```

Before committing, check that no file under `data/psoc/` contains the token. The test suite checks the same for fixture runs.

## 5. API-powered vs offline

| Component | Source |
|---|---|
| PSOC groups (`data/psoc/`) | PSA API, fetched by a maintainer and published offline |
| `/api/health/config` `psoc_reference`, `validate_occupation_code` | local files only |
| PSOC → ISCO-08 crosswalk | offline: the PSOC reference plus ESCO's ISCO-08 groups |
| PSOC → ESCO occupation links | offline proposals, not used at runtime |
| Skill PSOC codes in `skills_reference.csv` | hand-entered, offline |
| Matching, skill gaps, learning recommendations | no PSOC input |

## 6. Tests

`backend/tests/test_psoc_integration.py` uses fixture openers and makes no network calls. It covers:

- success and pagination;
- 5xx retries that recover;
- persistent failure;
- timeouts;
- 401 without retry;
- an unexpected body;
- token redaction in messages, tracebacks, command output and written files;
- invalid codes;
- publish, and keeping the last-known-good reference after API failure and after invalid records;
- a stale and a missing reference;
- occupation code validation;
- the compare kinds;
- crosswalk statuses and link gating;
- no PSA access from `backend/app`.

`test_import_reference_data.py` is unchanged and passes.

## 7. Live follow-up on 2026-09-27

The original limitations above describe the state of PR #72. A later authenticated
run reached the PSA API and published a local PSOC 2012 copy. The live response is
paginated JSON with `count`, `next`, `previous`, and `results`. PSA returned 10
major, 43 sub-major, 130 minor, and 455 unit groups (638 total). The [PSOC API
documentation](https://psa.gov.ph/classifications-api/psoc) says 456 unit groups,
but the API's own `count` field says 455. The snapshot preserves the API data and
records the actual counts; no missing unit was invented.

The first publish attempt found a validator bug: PSA sends major code `0` as a
number, and validation treated it as empty. This also falsely reported missing
parents for `01`, `02`, and `03`. Validation now accepts zero and a fixture test
covers the armed-forces hierarchy. A second download validated cleanly and
published `data/psoc/psoc_2012_groups.csv` with its provenance metadata.

This is **PSOC 2012**, not the complete 2022 update. The API has code `2121`
as "MATHEMATICIANS AND ACTUARIES" and no `2123`; [PSA's 2022 technical
notes](https://psa.gov.ph/statistics/technical-notes/1684075911) describe the
split into `2121` Mathematician and `2123` Actuaries. The [official 2022
workbook](https://psa.gov.ph/sites/default/files/kmcd/files/2022-Updates-to-the-2012-PSOC.xlsx)
returned HTTP 403 in this environment, so a complete 2012-versus-2022 comparison
remains pending. Do not describe the API snapshot as the current 2022 list.

`psoc-check` found 16 title differences and one stored skill code (`6210`)
missing from the API reference. These are review items, not automatic changes.
The full PSOC-to-ISCO report contains 586 `isco_match`, 30 `ambiguous`, and 22
`philippine_specific` groups; all 638 remain `proposed` for review.

The nullable `psoc_unit_code` columns in migration
`20260930090000_job_psoc_unit_codes.sql` allow an administrator to assign a
reviewed 2012 unit code to an employer post. The backend validates the code
against the published copy, and returns the code and title as job metadata.
Matching scores and vacancy skill requirements do not use it. Apply the
migration before using the admin occupation action. Existing jobs remain
unclassified until a reviewer assigns a code; title similarity alone is not
treated as approval.

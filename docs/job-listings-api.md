# Job listings APIs for Philippine jobs (assessed 2026-09-25)

**Question.** Could a job listings API supply more match-ready Philippine jobs
for Fit-Now matching?

**How this was checked.** The working environment's network policy blocked
every provider's site and API host (developer.adzuna.com, search.api.careerjet.net,
careerjet.ph, jooble.org, rapidapi.com, openwebninja.com, ph.jobstreet.com,
philjobnet.gov.ph). The notes below come from web search results that quote
those providers' documentation. They are **not verified against the current
documentation or terms**. Each item marked *verify* must be read at the source
before any integration. No credentials were requested or committed.

## What Kareerly needs from a source

Matching scores every job in the catalogue (`load_reference_jobs` → bi-encoder
→ canonical skill coverage), so a usable source must:

1. Allow listings to be **stored or cached** between searches, not only
   displayed live next to a user's search.
2. Return the **full description**. Required and must-have skill IDs are
   mapped from its text (`external_job_analysis.analyze_external_job` already
   does this for pasted jobs), and a snippet is not enough evidence.
3. Give a **posting date** (freshness) and a **stable link** to the original
   posting (provenance, and the `source_url` column of `internal_jobs`).
4. Cover the Philippines, including provincial and entry-level jobs.

## Options

| Option | Philippine coverage | Pricing | Authentication | Terms relevant to Kareerly | Freshness and links | Mapping into Kareerly |
|---|---|---|---|---|---|---|
| **JSearch** (OpenWeb Ninja; also on RapidAPI) | `country=ph` is listed as supported. Aggregates Google for Jobs (LinkedIn, Indeed, Glassdoor and others; `job_publisher` names the source). | Free tier without a card; paid tiers scale by call volume (tens to low hundreds of USD a month). The RapidAPI route adds a marketplace markup. *verify* | API key (RapidAPI key or OpenWeb Ninja key). | The data is collected from Google for Jobs, so storage and redistribution rights depend on OpenWeb Ninja's terms and on the underlying publishers. *verify before storing any listing* | Posting date and `job_apply_link` are returned. *verify field names* | `job_title` → `job_title`; `employer_name` → `company_name`; `job_city`/`job_state` → `location`; `job_is_remote`/employment type → `work_setup`, `employment_type`; `job_description` → `job_description` (skills mapped through `analyze_external_job`, then reviewed); `job_apply_link` → `source_url`; `job_publisher` → `source_platform`; posted date → `created_at`/`source_note`; salary fields → `salary_min_php`/`salary_max_php` only when the currency is PHP and the period is monthly. |
| **Careerjet API v4** | `en_PH` locale (careerjet.ph). About 90 countries. | Free for partners (the publisher model). | API key sent with HTTP Basic auth; partner account required. | Built for publishers: every call must carry a real visitor's `user_ip` and `user_agent`, and links are tracking redirects. That fits live search next to a user, not a stored catalogue scored in bulk. *verify* | Result links go through a tracking redirect, not to the original posting. The date field is *unverified*. | Title, company, location, salary and URL map directly. The description is reported to be an excerpt, which is too little evidence for skill IDs. *verify* |
| **Jooble REST API** | Aggregates about 60+ countries. Each country domain needs its own key; the jooble.org key covers the US only. A Philippine key would have to come from the Philippine domain. *verify it exists* | Free key on request, capped at **500 requests per key for its lifetime**. | Key in the request path, issued by email after review. | Partnership terms. *verify* | Link and update date are returned. | Snippet-level description. The 500-request lifetime cap rules out a maintained catalogue. |
| **Adzuna API** | **Philippines not supported.** The 19 countries are US, GB, AU, DE, FR, IN, CA, NZ, ZA, PL, NL, IT, ES, AT, BE, BR, MX, SG and CH. | — | — | — | — | Not applicable. |
| **JobStreet (SEEK)** | Best local coverage. | — | No official public search API. Third-party Apify actors call an undocumented internal endpoint. | Scraping an undocumented endpoint is not an agreed use; do not build on it. | — | Not recommended. |
| **PhilJobNet (DOLE)** | Government vacancies nationwide, including provincial jobs. | Free portal. | No documented public API was found. | A data-sharing request to DOLE-BLE would be needed. | Job pages have stable URLs. | Worth asking DOLE-BLE for a feed. It suits the K23 (public administration) and provincial gaps. |

## Recommendation

Pilot **JSearch** as a **review-gated import**, not a live integration.

- It is the only option found that covers the Philippines, returns full
  descriptions, and gives posting dates and original links. Kareerly needs the
  full description because required and must-have skills have to be mapped
  from evidence.
- Careerjet is official and free but is designed for live, per-visitor search
  with tracking links. Jooble's lifetime cap and Adzuna's missing Philippine
  coverage rule them out. JobStreet has no sanctioned API.

**Do not integrate it now:**

1. Its current terms and pricing could not be read from this environment. The
   first step is to confirm that listings may be stored, and for how long,
   and whether attribution to `job_publisher` is required.
2. It needs an API key, which must live in the backend environment
   (`JSEARCH_API_KEY`) and never in the repository or the frontend.
3. Imported jobs must not reach matching unreviewed. The pilot should:
   - write to a staging table;
   - run `analyze_external_job` to propose required and must-have skill IDs;
   - deduplicate by normalised title + company + city, and by apply URL;
   - drop postings older than 30 days;
   - insert into `internal_jobs` only rows a reviewer approved, with
     `source_platform`, `source_url` and the posting date in `source_note`, and
     `is_synthetic_seed = false`.

   Matching needs no change: `load_internal_jobs_dataframe` already loads
   active `internal_jobs` rows.
4. Also send DOLE-BLE a request for a PhilJobNet data feed. It is the only
   source with an official public-interest mandate for Philippine vacancies.

## Sources

- JSearch: <https://www.openwebninja.com/api/jsearch>, <https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch>, <https://jobspipe.dev/blog/jsearch-api-direct>
- Careerjet: <https://www.careerjet.com/partners/api>, <https://github.com/careerjet/careerjet-api-client-python>, <https://jobspipe.dev/blog/careerjet-api>
- Jooble: <https://help.jooble.org/en/support/solutions/articles/60001448238-rest-api-documentation>, <https://help.jooble.org/en/support/solutions/articles/60000922689-how-to-connect-to-the-jooble-rest-api>, <https://jobspipe.dev/blog/jooble-api>
- Adzuna: <https://developer.adzuna.com/docs/regional>
- JobStreet third-party scrapers (evidence that no official API exists): <https://apify.com/unfenced-group/jobstreet-scraper/api>
- PhilJobNet: <https://philjobnet.gov.ph/>, <https://ble.dole.gov.ph/about-philjobnet/>

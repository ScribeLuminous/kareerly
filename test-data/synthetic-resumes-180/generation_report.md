# Synthetic resume dataset: generation and QA report

System-test fixtures for Kareerly. Not training, validation or thesis evaluation data. All people, employers, schools, emails and phone numbers are fictional.

## Overall

| Item | Result |
|---|---|
| Expected resumes | 180 |
| Generated resumes | 180 |
| Valid resumes (all checks pass) | 180 |
| Controlled resumes | 168/168 |
| Stress-test resumes | 12/12 |
| Categories | 24/24 |
| Regions | 18/18 |
| Reference date | 2026-09-28 |

## Category distribution

| ID | Category | Controlled resumes |
|---|---|---:|
| K01 | Software and Web Development | 7 |
| K02 | Data, Analytics, and Artificial Intelligence | 7 |
| K03 | IT Infrastructure and Cybersecurity | 7 |
| K04 | Finance and Accounting | 7 |
| K05 | Office Administration and Records | 7 |
| K06 | Human Resources and Project Management | 7 |
| K07 | Sales and Purchasing | 7 |
| K08 | Marketing and Public Relations | 7 |
| K09 | Customer Service and Retail | 7 |
| K10 | Writing, Language, and Communications | 7 |
| K11 | Design, Media, and Performing Arts | 7 |
| K12 | Education and Training | 7 |
| K13 | Social and Community Services | 7 |
| K14 | Healthcare and Clinical Services | 7 |
| K15 | Caregiving and Wellness | 7 |
| K16 | Engineering and Architecture | 7 |
| K17 | Construction and Skilled Trades | 7 |
| K18 | Hospitality and Tourism | 7 |
| K19 | Food Service and Personal Care | 7 |
| K20 | Logistics, Transport, and Warehousing | 7 |
| K21 | Manufacturing and Quality Operations | 7 |
| K22 | Agriculture, Forestry, Fishery, and Environment | 7 |
| K23 | Public Administration and Government | 7 |
| K24 | Legal, Security, and Protective Services | 7 |

## Regional distribution

| Region | Name | Controlled | Stress test | Total |
|---|---|---:|---:|---:|
| NCR | National Capital Region | 9 | 1 | 10 |
| CAR | Cordillera Administrative Region | 9 | 1 | 10 |
| I | Ilocos Region | 10 | 0 | 10 |
| II | Cagayan Valley | 9 | 1 | 10 |
| III | Central Luzon | 9 | 1 | 10 |
| IV-A | CALABARZON | 9 | 1 | 10 |
| IV-B | MIMAROPA | 10 | 0 | 10 |
| V | Bicol Region | 9 | 1 | 10 |
| VI | Western Visayas | 10 | 0 | 10 |
| NIR | Negros Island Region | 9 | 1 | 10 |
| VII | Central Visayas | 9 | 1 | 10 |
| VIII | Eastern Visayas | 10 | 0 | 10 |
| IX | Zamboanga Peninsula | 9 | 1 | 10 |
| X | Northern Mindanao | 9 | 1 | 10 |
| XI | Davao Region | 9 | 1 | 10 |
| XII | SOCCSKSARGEN | 10 | 0 | 10 |
| XIII | Caraga | 9 | 1 | 10 |
| BARMM | Bangsamoro Autonomous Region in Muslim Mindanao | 10 | 0 | 10 |

## Candidate variant distribution

| Variant | Count |
|---|---:|
| strong_entry | 24 |
| partial_entry | 24 |
| strong_mid | 24 |
| partial_mid | 24 |
| advanced | 24 |
| career_transition | 24 |
| mixed_boundary | 24 |
| cross_category_stress | 12 |

## Allocation details

- Seed 20260928; seed used 20260928 after 1 attempt(s); 22 seeded within-category profile swaps to keep at most 2 of one profile per region.
- Regions with 10 controlled candidates (seeded shuffle): BARMM, I, IV-B, VI, VIII, XII.
- Every stress resume sits in a region without a controlled candidate of its primary category: yes.

### Region × category (controlled)

| Region | 01 | 02 | 03 | 04 | 05 | 06 | 07 | 08 | 09 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23 | 24 |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| NCR | 1 | · | · | · | 1 | · | 1 | · | · | · | 1 | 1 | · | 1 | 1 | · | 1 | · | 1 | · | · | · | · | · |
| CAR | 1 | · | · | · | · | 1 | 1 | · | · | · | 1 | 1 | · | 1 | 1 | · | 1 | · | 1 | · | · | · | · | · |
| I | 1 | 1 | · | · | 1 | · | · | 1 | · | · | · | · | 1 | 1 | 1 | · | 1 | · | · | · | 1 | · | 1 | · |
| II | · | · | · | · | · | 1 | 1 | · | · | · | 1 | 1 | · | 1 | 1 | · | 1 | · | 1 | 1 | · | · | · | · |
| III | · | 1 | 1 | · | · | · | · | 1 | 1 | 1 | · | · | 1 | · | · | 1 | · | 1 | · | · | · | 1 | · | · |
| IV-A | · | · | · | 1 | · | 1 | · | · | 1 | 1 | · | 1 | · | · | · | · | · | 1 | 1 | 1 | · | · | · | 1 |
| IV-B | 1 | 1 | · | · | 1 | · | · | · | · | · | 1 | · | 1 | 1 | 1 | · | 1 | · | · | · | 1 | · | 1 | · |
| V | · | · | 1 | 1 | · | · | · | 1 | 1 | 1 | · | · | · | · | · | 1 | · | 1 | · | · | · | 1 | · | 1 |
| VI | 1 | 1 | 1 | · | 1 | · | · | 1 | · | · | · | · | 1 | · | · | 1 | · | · | · | · | 1 | 1 | 1 | · |
| NIR | · | · | · | 1 | · | 1 | · | · | 1 | 1 | · | · | · | · | · | 1 | · | 1 | · | 1 | · | 1 | · | 1 |
| VII | · | · | · | 1 | · | 1 | 1 | · | · | · | 1 | 1 | · | · | · | · | · | 1 | 1 | 1 | · | · | · | 1 |
| VIII | 1 | 1 | 1 | · | 1 | · | · | 1 | · | · | · | · | 1 | 1 | · | · | 1 | · | · | · | 1 | · | 1 | · |
| IX | · | · | · | 1 | · | 1 | 1 | · | · | 1 | · | 1 | · | · | · | · | · | 1 | 1 | 1 | · | · | · | 1 |
| X | · | · | 1 | 1 | · | · | · | · | 1 | 1 | · | · | · | · | · | 1 | · | 1 | · | 1 | · | 1 | · | 1 |
| XI | · | · | · | 1 | · | 1 | 1 | · | · | · | 1 | 1 | · | · | 1 | · | · | · | 1 | 1 | · | · | · | 1 |
| XII | · | 1 | 1 | · | 1 | · | · | 1 | 1 | · | · | · | 1 | · | · | 1 | · | · | · | · | 1 | 1 | 1 | · |
| XIII | 1 | · | · | · | 1 | · | 1 | · | · | · | 1 | · | · | 1 | 1 | · | 1 | · | · | · | 1 | · | 1 | · |
| BARMM | · | 1 | 1 | · | · | · | · | 1 | 1 | 1 | · | · | 1 | · | · | 1 | · | · | · | · | 1 | 1 | 1 | · |

### Region × profile variant

| Region | sE | pE | sM | pM | adv | tr | mix | stress |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| NCR | 1 | 1 | 1 | 1 | 2 | 2 | 1 | 1 |
| CAR | 2 | 1 | 1 | 1 | 2 | · | 2 | 1 |
| I | 1 | 2 | · | 2 | 2 | 1 | 2 | · |
| II | 2 | · | 1 | 1 | 2 | 1 | 2 | 1 |
| III | 1 | 2 | 2 | · | 2 | · | 2 | 1 |
| IV-A | 2 | 2 | 2 | 2 | · | 1 | · | 1 |
| IV-B | 2 | 1 | 1 | 2 | 1 | 1 | 2 | · |
| V | 1 | 1 | 1 | 2 | 1 | 2 | 1 | 1 |
| VI | 1 | 1 | 2 | 2 | 2 | 2 | · | · |
| NIR | 1 | · | 1 | 2 | 2 | 1 | 2 | 1 |
| VII | 2 | 2 | 1 | · | · | 2 | 2 | 1 |
| VIII | 1 | 2 | 2 | 1 | 2 | 1 | 1 | · |
| IX | 1 | 2 | 1 | 1 | 1 | 2 | 1 | 1 |
| X | · | · | 2 | 2 | 1 | 2 | 2 | 1 |
| XI | 1 | 1 | 1 | 1 | 2 | 1 | 2 | 1 |
| XII | 1 | 2 | 2 | 2 | 1 | 2 | · | · |
| XIII | 2 | 2 | 1 | 2 | · | 1 | 1 | 1 |
| BARMM | 2 | 2 | 2 | · | 1 | 2 | 1 | · |

### Layout variant usage

| Layout | Resumes |
|---|---:|
| bullet_heavy | 18 |
| certification_focus | 19 |
| classic_summary_first | 18 |
| compact_one_page | 18 |
| education_first_graduate | 17 |
| experience_first | 19 |
| experienced_professional | 17 |
| mixed_paragraph | 18 |
| project_heavy | 17 |
| skills_first | 19 |

### City usage per region

- **NCR**: Caloocan City, Metro Manila ×1; Manila, Metro Manila ×1; Marikina City, Metro Manila ×2; Parañaque City, Metro Manila ×1; Pasig City, Metro Manila ×2; Quezon City, Metro Manila ×1; Valenzuela City, Metro Manila ×2
- **CAR**: Baguio City, Benguet ×2; Bangued, Abra ×2; Bontoc, Mountain Province ×1; La Trinidad, Benguet ×1; Lagawe, Ifugao ×2; Tabuk City, Kalinga ×2
- **I**: Alaminos City, Pangasinan ×2; Dagupan City, Pangasinan ×1; Laoag City, Ilocos Norte ×2; San Fernando City, La Union ×2; Urdaneta City, Pangasinan ×1; Vigan City, Ilocos Sur ×2
- **II**: Bayombong, Nueva Vizcaya ×1; Cabarroguis, Quirino ×2; Cauayan City, Isabela ×2; Ilagan City, Isabela ×2; Santiago City, Isabela ×1; Tuguegarao City, Cagayan ×2
- **III**: Angeles City, Pampanga ×1; Balanga City, Bataan ×2; Baler, Aurora ×2; Cabanatuan City, Nueva Ecija ×1; City of San Fernando, Pampanga ×1; Malolos City, Bulacan ×1; Olongapo City, Zambales ×1; Tarlac City, Tarlac ×1
- **IV-A**: Antipolo City, Rizal ×1; Batangas City, Batangas ×1; Calamba City, Laguna ×1; Dasmariñas City, Cavite ×2; Lipa City, Batangas ×2; Lucena City, Quezon ×2; San Pablo City, Laguna ×1
- **IV-B**: Boac, Marinduque ×2; Calapan City, Oriental Mindoro ×1; Mamburao, Occidental Mindoro ×2; Odiongan, Romblon ×2; Puerto Princesa City, Palawan ×1; San Jose, Occidental Mindoro ×2
- **V**: Daet, Camarines Norte ×1; Iriga City, Camarines Sur ×1; Legazpi City, Albay ×2; Masbate City, Masbate ×1; Naga City, Camarines Sur ×2; Sorsogon City, Sorsogon ×1; Tabaco City, Albay ×1; Virac, Catanduanes ×1
- **VI**: Iloilo City, Iloilo ×1; Jordan, Guimaras ×2; Kalibo, Aklan ×1; Passi City, Iloilo ×2; Roxas City, Capiz ×2; San Jose de Buenavista, Antique ×2
- **NIR**: Bacolod City, Negros Occidental ×1; Bais City, Negros Oriental ×2; Bayawan City, Negros Oriental ×1; Dumaguete City, Negros Oriental ×2; Kabankalan City, Negros Occidental ×1; Silay City, Negros Occidental ×1; Siquijor, Siquijor ×2
- **VII**: Cebu City, Cebu ×1; Danao City, Cebu ×1; Lapu-Lapu City, Cebu ×2; Mandaue City, Cebu ×2; Tagbilaran City, Bohol ×1; Toledo City, Cebu ×2; Tubigon, Bohol ×1
- **VIII**: Borongan City, Eastern Samar ×1; Calbayog City, Samar ×1; Catarman, Northern Samar ×1; Catbalogan City, Samar ×2; Maasin City, Southern Leyte ×1; Naval, Biliran ×2; Ormoc City, Leyte ×1; Tacloban City, Leyte ×1
- **IX**: Dapitan City, Zamboanga del Norte ×1; Dipolog City, Zamboanga del Norte ×1; Ipil, Zamboanga Sibugay ×2; Molave, Zamboanga del Sur ×2; Pagadian City, Zamboanga del Sur ×1; Sindangan, Zamboanga del Norte ×1; Zamboanga City, Zamboanga del Sur ×2
- **X**: Cagayan de Oro City, Misamis Oriental ×2; Gingoog City, Misamis Oriental ×2; Iligan City, Lanao del Norte ×1; Malaybalay City, Bukidnon ×1; Mambajao, Camiguin ×1; Oroquieta City, Misamis Occidental ×1; Ozamiz City, Misamis Occidental ×1; Valencia City, Bukidnon ×1
- **XI**: Davao City, Davao del Sur ×2; Digos City, Davao del Sur ×1; Mati City, Davao Oriental ×1; Nabunturan, Davao de Oro ×2; Panabo City, Davao del Norte ×2; Tagum City, Davao del Norte ×2
- **XII**: Alabel, Sarangani ×2; General Santos City, South Cotabato ×2; Isulan, Sultan Kudarat ×2; Kidapawan City, Cotabato ×2; Koronadal City, South Cotabato ×1; Tacurong City, Sultan Kudarat ×1
- **XIII**: Bayugan City, Agusan del Sur ×1; Bislig City, Surigao del Sur ×1; Butuan City, Agusan del Norte ×2; Cabadbaran City, Agusan del Norte ×2; San Jose, Dinagat Islands ×2; Surigao City, Surigao del Norte ×1; Tandag City, Surigao del Sur ×1
- **BARMM**: Bongao, Tawi-Tawi ×1; Buluan, Maguindanao del Sur ×1; Cotabato City, Maguindanao del Norte ×1; Datu Odin Sinsuat, Maguindanao del Norte ×1; Lamitan City, Basilan ×1; Malabang, Lanao del Sur ×2; Marawi City, Lanao del Sur ×2; Parang, Maguindanao del Norte ×1

## Near-duplicate check

Methods (Section 15.1): TF-IDF cosine on each resume's visible text with name, contact details and location removed (lower-cased word unigrams and bigrams, sublinear tf), flag ≥ 0.80; the same on the professional summary alone, flag ≥ 0.85; verbatim reuse of any experience or project bullet; Jaccard similarity of skill sets, flag ≥ 0.90; duplicate full names and surnames used more than 4 times. Pure Python (`scripts/check_similarity.py`), no third-party packages. The full-text check was repeated on the text extracted from the PDFs (`validate_dataset.py --pdfs`) with the same result.

| Measure | Within category | Across categories |
|---|---|---|
| Full text | max 0.259, p95 0.134, median 0.051 (n=570) | max 0.253, p95 0.059, median 0.024 (n=15540) |
| Summary | max 0.282, p95 0.100, median 0.032 (n=570) | max 0.242, p95 0.056, median 0.019 (n=15540) |

Flagged pairs: **0** of 16110. `similarity_report.csv` lists every flag; it holds only its header because none remain. No pair ever crossed a threshold, so nothing needed rewriting for similarity. The flags that were raised and fixed while authoring came from the content checks and review instead: four experience or date inconsistencies (CAT13-R06 at 7.2 years against 6 in the matrix; CAT15-R02 whose volunteer role counted as 1.2 years; CAT13-R01 whose practicum ran past graduation; CAT04-R02 whose summary claimed two years of bookkeeping against an 11-month role), four phrases close to an intentionally missing skill ("inbox management", "phishing risks", "emergency lights", "dispatch"), two locations outside the approved lookup (Batac City and Toronto), single-bullet roles given a second bullet, and 18 employer or school names that matched or could match real public bodies and institutions, all renamed to fictional ones. Four specs were changed because a canonical label or alias made the intended gap impossible to write (CAT09-R01, CAT09-R06, CAT17-R03 and CAT20-R02 at Gate 1, CAT21-R01 later); see finding 6 under Resume parsing QA.

## Synthetic PII and conventions

- **Emails:** `firstname.surname@example.com`, `@example.org` or `@example.net` only (RFC 2606 reserved domains); all 180 unique.
- **Phones:** `+63 9XX XXX XXXX`, drawn from common Philippine mobile prefixes; all 180 unique. These are realistic-format numbers that may belong to real subscribers. **Never use these fixtures to send SMS, place calls or send email.**
- **Names:** fictional given-name and surname combinations from general and regional pools (Ilocano, Cordilleran, Kapampangan, Bicolano, Visayan, Mindanao and Muslim Filipino surnames), with surnames of prominent public figures and political families blocked; no duplicate full names, no surname used more than 3 times.
- **Organisations:** every employer, school and public body is invented. Public-sector roles (K13, K23) use invented foundations, councils and development authorities rather than real government offices. Credentials name their real issuers (PRC, TESDA, Civil Service Commission, DOLE-accredited trainers, vendor certifications), as a real resume would.
- **Locations:** only the approved Section 6.3 lookup, keyed on (city, province). Negros Island Region follows RA 12000 (Bacolod, Silay, Kabankalan, Dumaguete, Bais, Bayawan, Siquijor are NIR). No Sulu location (including Jolo) and no Isabela City anywhere. Independent and highly urbanised cities are written with their geographic province (for example "Baguio City, Benguet"); NCR uses "Metro Manila". Every approved location resolves to the same region in the repository's `ph_regions.py`.
- **Dates:** reference date 2026-09-28; no date after it; current roles end "Present"; work-history experience within ±1 year of `experience_years` for all 180.
- **Layouts:** 10 variants, each used 17–19 times; every category uses at least 7 of them.

Rendering: ReportLab 5.0.1 in invariant mode; fonts `DejaVuSans.ttf` sha256 `ae7b7855e115a5966d8b1b3f80f254ccc117ec86f9965e202ee2940453837280`; `DejaVuSans-Bold.ttf` sha256 `5c1247acef7f2b8522a31742c76d6adcb5569bacc0be7ceaa4dc39dd252ce895`.

## Resume parsing QA

Each PDF was passed as bytes, with the neutral file name `resume.pdf`, to `resume_analyzer.analyze_resume_bytes` with the live skill extractor. Nothing was written to any database.

| Measure | Result |
|---|---|
| Text extracted | 180/180 |
| Name detected exactly | 180/180 |
| Experience detected | 180/180 |
| Education detected | 174/180 |
| Certifications detected where present | 97/97 |
| Certifications reported where none listed | 14 |
| Header location resolves to the right region | 180/180 |
| Skills extracted per resume (median) | 5.0 |
| Held-skill recall (median / mean) | 0.56 / 0.55 |
| Resumes where an intentionally missing skill was extracted | 0 |
| All extracted skills canonical (normalization_success) | 180/180 |

Failure classes: normalization_low_recall 63.

Held-skill recall by category (median):

| Category | Median recall | Min |
|---|---:|---:|
| K01 | 0.67 | 0.31 |
| K02 | 0.75 | 0.43 |
| K03 | 0.47 | 0.20 |
| K04 | 0.62 | 0.29 |
| K05 | 0.56 | 0.25 |
| K06 | 0.50 | 0.22 |
| K07 | 0.67 | 0.25 |
| K08 | 0.67 | 0.38 |
| K09 | 0.63 | 0.29 |
| K10 | 0.64 | 0.33 |
| K11 | 0.72 | 0.40 |
| K12 | 0.38 | 0.25 |
| K13 | 0.33 | 0.11 |
| K14 | 0.58 | 0.20 |
| K15 | 0.43 | 0.29 |
| K16 | 0.65 | 0.29 |
| K17 | 0.43 | 0.17 |
| K18 | 0.50 | 0.12 |
| K19 | 0.46 | 0.14 |
| K20 | 0.71 | 0.21 |
| K21 | 0.50 | 0.29 |
| K22 | 0.57 | 0.22 |
| K23 | 0.67 | 0.54 |
| K24 | 0.50 | 0.31 |

Held skills most often not extracted:

| Skill | Resumes |
|---|---:|
| SK020:Business Communication | 69 |
| SK031:English Communication | 44 |
| SK261:Manage staff | 22 |
| SK016:Document Management | 9 |
| SK098:Inventory Management | 9 |
| SK314:Handle complaints | 7 |
| SK083:Reservation Management | 7 |
| SK056:Patient Assessment Support | 7 |
| SK202:Perform clerical duties | 6 |
| SK622:Calendar Management | 6 |
| SK300:Use customer relationship management software | 6 |
| SK373:Communicate with social service users | 6 |
| SK066:Wellness Support | 6 |
| SK166:Manage system security | 5 |
| SK006:Data Visualization | 5 |

Skills most often extracted without being in the candidate's spec:

| Skill | Resumes |
|---|---:|
| SK259:Economics | 9 |
| SK651:Invoicing and Billing | 6 |
| SK629:Microsoft Excel | 6 |
| SK281:Marketing management | 6 |
| SK206:Operations management | 4 |
| SK276:Customer relationship management | 4 |
| SK093:Packaging | 4 |
| SK012:Bookkeeping | 3 |
| SK628:Microsoft Office | 3 |
| SK029:Customer Service | 3 |
| SK649:E-commerce Operations | 3 |
| SK641:Help Desk Support | 3 |

Intentionally missing skills that the parser extracted:

None.

**Findings**

1. **Filipino names with "ñ" were mangled (parser issue, fixed after the first run).** `resume_analyzer.normalize_person_name` split names on non-ASCII letters: "Randy Omaña" → "Randy Oma A", "Mylene Ybañez" → "Mylene Yba Ez", "Patrick Cañete" → "Patrick Ca Ete". For "Mark Anthony Dela Peña" (CAT23-R07) the mangled name failed the plausibility check and the parser returned the location line "Alaminos City Pangasinan" as the name. All 11 name failures (169/180 detected) had this one cause; the PDFs extract "ñ" correctly. Names are now read with Unicode letters and composed to NFC first (a PDF may store "ñ" as "n" plus a combining tilde); **180/180 names are detected in the rerun.**
2. **"Work History" and "Career History" were not recognised as experience headings (parser issue, fixed after the first run).** All 27 resumes without a detected experience section used one of these two headings (certification_focus: 16 of 19, mixed_paragraph: 11 of 18); `SECTION_HEADINGS` had "experience", "work experience", "professional experience" and "employment history" but not these variants. Skills were still extracted, but from the wrong section. Both headings are now section headings and experience keywords; **the experience section is detected in 180/180 resumes in the rerun** (153/180 before), and the extracted skills of every resume are unchanged.
3. **A short second page is treated as a scanned page (parser issue).** CAT04-R01 and CAT14-R01 are text PDFs whose second page holds only a few lines; the parser reports "This resume looks scanned (image-only), but text recognition (OCR) is not available" (`ocr_status: unavailable`). A real user would see a misleading warning.
4. **Certification indicators without a certifications section.** 14 resumes with no certifications listed still report certification indicators, triggered by credentials inside education entries ("Caregiving NC II", "Registered Civil Engineer") or phrases such as "licensure". This is arguably correct for TESDA NC holders and is noted, not counted as a failure.
5. **Skill extraction is precision-first.** No intentionally missing skill was extracted from any resume, and every extracted skill is a canonical ID. Median recall of the skills in each candidate's spec is 0.56. The misses are mostly soft and generic skills (Business Communication 69 resumes, English Communication 44, Manage staff 22) and naturally worded skills with no verified alias ("PowerShell scripting", "firewall policies", "HR processes"). This is a normalization coverage gap rather than a resume-structure problem; the resumes deliberately use natural wording (Section 2).
6. **Canonical labels that contain other labels or aliases (normalization issue).** Found while authoring and fixed in the specs, not in the taxonomy: "Use customer relationship management software" contains "Customer relationship management"; Production Monitoring's alias is the label "Monitor the production line"; Electrical Installation's alias is the label "Install electrical and electronic equipment"; Tourism Assistance's alias is the label "Provide tourism related information"; "surveying" (Surveying Support) matches inside "quantity surveying". A candidate cannot show one of these without appearing to hold the other.

Failure classes in `parsing_results.csv`: `resume_structure_or_section_detection` means the experience or education section was not detected (27 resumes on the first run, all from finding 2, a parser vocabulary issue and not a resume defect; none after the fix). Seven resumes that this class had masked now appear under `normalization_low_recall`; their recall did not change; `normalization_low_recall` means fewer than half the spec skills were extracted (finding 5).

## Matching smoke-test summary

Catalog: `backend/data/reference_jobs.csv` (460 jobs), the matcher's fallback when Supabase is not configured. Supabase was not reachable, so employer posts and admin-added jobs are not part of this run. Each resume ran twice (no location filter, and the matcher's own region filter for the candidate's region): 360 rows in `matching_smoke_test.csv`. Read-only; model, thresholds, gates and catalog unchanged.

| Measure | No filter | Region filter |
|---|---:|---:|
| Resumes with ≥1 Fit-Now | 129 | 37 |
| Resumes with 0 Fit-Now | 51 | 143 |
| Resumes with nothing recommended | 0 | 22 |
| Median Fit-Now | 1.0 | 0.0 |
| Median Aspiration | 29.0 | 4.0 |
| Median Low Match | 429.0 | 429.0 |
| Top match in target category (controlled) | 125/168 | 85/168 |
| Target category in top 5 (controlled) | 155/168 | 115/168 |

### By profile variant (no filter)

| Variant | n | ≥1 Fit-Now | Median Fit-Now | Median Aspiration | Top match in target |
|---|---:|---:|---:|---:|---:|
| strong_entry | 24 | 22 | 2.0 | 24.0 | 24 |
| partial_entry | 24 | 8 | 0.0 | 23.0 | 18 |
| strong_mid | 24 | 16 | 3.0 | 33.0 | 24 |
| partial_mid | 24 | 16 | 1.0 | 27.0 | 18 |
| advanced | 24 | 16 | 1.0 | 25.5 | 22 |
| career_transition | 24 | 19 | 2.0 | 32.0 | 9 |
| mixed_boundary | 24 | 21 | 1.5 | 36.5 | 10 |
| cross_category_stress | 12 | 11 | 2.5 | 35.5 | 5 |

### By category (controlled, no filter)

| Category | Jobs in catalog | ≥1 Fit-Now | Median Fit-Now | Median Aspiration | Top match in target | Target in top 5 |
|---|---:|---:|---:|---:|---:|---:|
| K01 | 16 | 7 | 1 | 21 | 6 | 6 |
| K02 | 16 | 6 | 3 | 42 | 5 | 7 |
| K03 | 19 | 4 | 1 | 20 | 3 | 6 |
| K04 | 23 | 6 | 1 | 30 | 6 | 6 |
| K05 | 17 | 5 | 1 | 22 | 5 | 7 |
| K06 | 15 | 1 | 0 | 20 | 5 | 7 |
| K07 | 19 | 6 | 2 | 25 | 4 | 7 |
| K08 | 22 | 3 | 0 | 31 | 4 | 6 |
| K09 | 18 | 4 | 1 | 37 | 4 | 5 |
| K10 | 14 | 4 | 1 | 33 | 5 | 7 |
| K11 | 25 | 7 | 1 | 21 | 6 | 7 |
| K12 | 24 | 5 | 1 | 24 | 6 | 7 |
| K13 | 15 | 3 | 0 | 16 | 4 | 5 |
| K14 | 22 | 4 | 1 | 30 | 6 | 6 |
| K15 | 16 | 4 | 2 | 23 | 6 | 7 |
| K16 | 23 | 7 | 2 | 23 | 5 | 5 |
| K17 | 15 | 6 | 2 | 34 | 5 | 7 |
| K18 | 21 | 4 | 1 | 29 | 6 | 6 |
| K19 | 19 | 5 | 2 | 26 | 5 | 7 |
| K20 | 20 | 6 | 1 | 38 | 5 | 6 |
| K21 | 18 | 5 | 2 | 38 | 6 | 7 |
| K22 | 26 | 5 | 2 | 28 | 7 | 7 |
| K23 | 18 | 5 | 3 | 46 | 5 | 7 |
| K24 | 19 | 6 | 1 | 31 | 6 | 7 |

### Region filter: jobs available per region

| Region | Jobs available (in region or remote) | Resumes with 0 recommendations when filtered |
|---|---:|---:|
| NCR | 265 | 0 |
| CAR | 77 | 1 |
| I | 63 | 3 |
| II | 63 | 1 |
| III | 86 | 0 |
| IV-A | 131 | 0 |
| IV-B | 63 | 3 |
| V | 64 | 2 |
| VI | 80 | 3 |
| NIR | 80 | 0 |
| VII | 84 | 1 |
| VIII | 63 | 2 |
| IX | 63 | 1 |
| X | 80 | 0 |
| XI | 81 | 0 |
| XII | 63 | 2 |
| XIII | 64 | 2 |
| BARMM | 63 | 1 |

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

## Cross-category stress-test findings

| ID | Primary → secondary | Fit-Now | Aspiration | Top match | Top-5 categories |
|---|---|---|---|---|---|
| STRESS-001 | K11 → Software and Web Development | 1 | 24 | Junior Figma Designer (K11, Fit-Now, score 0.6799, coverage 1.0) | K11|K11|K11|K01|K11 |
| STRESS-002 | K09 → Sales and Purchasing | 5 | 30 | Inside Sales Representative (K07, Fit-Now, score 0.8438, coverage 1.0) | K07|K07|K09|K07|K09 |
| STRESS-003 | K08 → Data, Analytics, and Artificial Intelligence | 5 | 43 | Marketing Data Analyst (K02, Fit-Now, score 0.9007, coverage 1.0) | K02|K02|K08|K02|K02 |
| STRESS-004 | K05 → Human Resources and Project Management | 1 | 37 | Project Coordinator (K06, Fit-Now, score 0.6045, coverage 1.0) | K06|K05|K05|K06|K05 |
| STRESS-005 | K14 → Caregiving and Wellness | 10 | 24 | Medication Aide (K15, Fit-Now, score 0.8896, coverage 1.0) | K15|K15|K15|K15|K15 |
| STRESS-006 | K19 → Hospitality and Tourism | 7 | 26 | Commis Cook (K19, Fit-Now, score 0.8192, coverage 1.0) | K19|K19|K19|K19|K19 |
| STRESS-007 | K12 → Design, Media, and Performing Arts | 7 | 45 | Instructional Designer (K12, Fit-Now, score 0.8796, coverage 1.0) | K12|K12|K12|K12|K12 |
| STRESS-008 | K10 → Marketing and Public Relations|Design, Media, and Performing Arts | 2 | 32 | Digital Marketing Assistant (K08, Fit-Now, score 0.859, coverage 1.0) | K08|K08|K10|K10|K10 |
| STRESS-009 | K03 → Legal, Security, and Protective Services | 0 | 34 | Data Privacy and Compliance Associate (K24, Aspiration, score 0.6014, coverage 0.6667) | K24|K24|K24|K05|K24 |
| STRESS-010 | K16 → Human Resources and Project Management|Construction and Skilled Trades | 3 | 41 | Construction Site Assistant (K16, Fit-Now, score 0.7924, coverage 1.0) | K16|K16|K06|K16|K17 |
| STRESS-011 | K18 → Sales and Purchasing | 2 | 38 | Events Sales Executive (K18, Fit-Now, score 0.8794, coverage 1.0) | K18|K07|K07|K18|K07 |
| STRESS-012 | K20 → Manufacturing and Quality Operations | 1 | 37 | Production Planner (K21, Fit-Now, score 0.8502, coverage 1.0) | K21|K20|K21|K21|K20 |

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

## Research and data integrity

These 180 resumes are synthetic system-test fixtures. They must not be added to fine-tuning, validation or held-out thesis test data, used for checkpoint selection, presented as real Filipino job seekers, used to report or adjust thesis metrics, or mixed with production candidate records. No model, checkpoint, threshold, gate, skill-coverage rule, PSOC/ISCO/ESCO mapping, job catalog, production database or thesis dataset was changed. PSOC/ISCO codes are left empty: jobs carry no reviewed PSOC codes, and the repository's documentation states PSOC feeds no matching, skill-gap or learning logic, so a code derived from a title alone would be unreviewed.

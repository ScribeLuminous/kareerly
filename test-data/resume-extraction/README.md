# Resume extraction samples

Samples for measuring and improving how Kareerly reads resumes of different
formats and layouts (PDF, DOCX, JPG/PNG, scanned and photographed documents,
single- and multi-column designs). This folder is for extraction QA only: it
is separate from production candidate records and from the live upload path.

**Not training data.** Do not use these files to train or tune a model, and do
not report results on them as if they were real job seekers. Placeholder
templates (Lorem ipsum, "Your Name") measure layout handling only, not field
accuracy.

## Layout

- `manifest.csv`: one row per sample, no personal details (see columns below)
- `private/`: the sample files, renamed to their sample IDs. **Git-ignored.**
  The files are third-party templates and examples whose redistribution terms
  were not verified, so they are never committed. Keep a copy outside the
  repository; `sha256` in the manifest checks a restored copy.
- `ground_truth/`: expected output per sample (added in the annotation phase)
- `reports/`: inventory and evaluation results, by sample ID only

The 180 synthetic resumes in `../synthetic-resumes-180/` are reused by
reference for text-based single-column PDFs; they are not copied here.

## Sample IDs and sources

| Prefix | Count | Source | What it is |
|---|---|---|---|
| `PRS-01`–`PRS-25` | 25 DOCX | Prosple graduate CV template bundle (templates originally by Google Docs, Hloom, UpResume, Apple Pages, Microsoft and Resume Viking; `original_creator`) | Blank placeholder templates, 1–3 pages |
| `QRR-01`, `QRR-02` | 1 DOCX, 1 PDF | Qarera Philippine resume template | One filled example in two formats |
| `JBS-01`–`JBS-05` | 5 JPG | JobStreet Philippines fresh-graduate article | One filled example in five layouts |
| `RVK-01`–`RVK-08` | 8 PDF | Resume Viking templates and examples | Filled examples; `RVK-01`–`03` share one content in three layouts |

`content_group` marks samples that hold the same resume content, so a
difference in their results is caused by layout or format alone. Samples in one
group must stay in the same split (development or held-out test) to avoid
leakage.

### References (APA 7th edition)

Dates and exact titles still need checking against the live pages; see
`reports/sample_inventory.md`.

- JobStreet. (n.d.). *Sample resume format for fresh graduates (one-page format)*. Retrieved November 19, 2026, from https://ph.jobstreet.com/career-advice/article/sample-resume-format-for-fresh-graduates-one-page-format
- Prosple. (n.d.). *25 free graduate CV templates*. Retrieved November 19, 2026, from https://ph.prosple.com/campus/25-free-graduate-cv-templates
- Qarera. (n.d.). *Philippines resume template*. Retrieved November 19, 2026, from https://www.qarera.com/resume-templates/philippines
- Resume Viking. (n.d.). *Resume templates*. Retrieved November 19, 2026, from https://www.resumeviking.com/templates/

## Manifest columns

`sample_id`, `file_name` (under this folder), `original_filename`, `sha256`,
`file_format`, `source`, `source_url`, `original_creator`, `content_group`,
`content_type` (`placeholder_template` or `filled_example`), `capture_type`
(`digital`, `digital_export_image`, `scan`, `photo`), `text_layer` (`text`,
`image`, `mixed`), `page_count`, `ocr_required`, `layout_category`, `columns`,
`has_tables`, `has_text_boxes`, `has_photo`, `has_icons_graphics`, `language`,
`accepted_by_kareerly` (whether the upload checks accept the file today),
`ground_truth` (`none`, `partial`, `full`), `split`, `consent_or_license`,
`contains_real_pii` (`n`, `possible`, `y`), `previously_failed_in_kareerly`,
`evaluation_status`, `notes`.

## Privacy rules

- No names, email addresses, phone numbers or addresses in the manifest,
  ground-truth file names or reports; refer to samples by ID.
- Real candidate resumes go in `private/` only with the owner's consent and are
  never committed (Data Privacy Act of 2012, RA 10173).
- Samples are read locally; never send them to Gemma, Hugging Face or any other
  outside service.

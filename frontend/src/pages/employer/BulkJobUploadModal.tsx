import { useRef, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCircleCheck, faDownload, faFileCsv, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
import { Banner, Modal } from '../../components/ui';
import { BULK_JOB_COLUMNS, bulkJobTemplateCsv, MAX_BULK_JOBS, parseBulkJobs, type BulkJobParse, type BulkJobRow } from './bulkJobs';
import type { JobEditorDraft } from './jobDraft';
import { EMPLOYMENT_TYPES, EXPERIENCE_LEVELS, jobCategoryOptions, WORK_SETUPS } from './model';
import { saveBlob } from './insights/export/exportCsv';

export type BulkImportItem = { draft: JobEditorDraft; mode: 'post' | 'draft' };

type ImportMode = 'post' | 'draft';

const MAX_FILE_BYTES = 2 * 1024 * 1024;

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

function downloadTemplate() {
  // The byte-order mark lets Excel read the file as UTF-8 (₱, ñ).
  saveBlob(new Blob(['﻿', bulkJobTemplateCsv()], { type: 'text/csv;charset=utf-8' }), 'kareerly-jobs-template.csv');
}

function rowBadge(row: BulkJobRow, mode: ImportMode) {
  if (row.outcome === 'skip') return <span className="k-badge k-badge-outline">Skipped</span>;
  if (row.outcome === 'post' && mode === 'post') return <span className="k-badge k-badge-success">Ready to post</span>;
  return <span className="k-badge k-badge-high">Draft</span>;
}

function AllowedValues() {
  return (
    <details className="mt-4">
      <summary className="k-link cursor-pointer">Columns and allowed values</summary>
      <dl className="k-facts mt-3">
        {BULK_JOB_COLUMNS.map((column) => (
          <div key={column.key}>
            <dt><code>{column.header}</code>{column.required ? ' *' : ''}</dt>
            <dd>{column.help}</dd>
          </div>
        ))}
      </dl>
      <p className="k-label mt-4">Categories and sub-categories</p>
      <ul className="k-secondary mt-1 space-y-1">
        {jobCategoryOptions.map((category) => (
          <li key={category.code}><span className="k-num">{category.code}</span> {category.value}: {category.subcategories.join(', ')}</li>
        ))}
      </ul>
      <p className="k-meta mt-3">
        Experience level: {EXPERIENCE_LEVELS.join(' · ')}. Work setup: {WORK_SETUPS.join(' · ')}. Employment type: {EMPLOYMENT_TYPES.join(' · ')}.
      </p>
    </details>
  );
}

/**
 * Upload many jobs from one CSV file. Every row is checked like the job
 * editor; complete rows can be posted, the rest are saved as drafts to finish
 * one by one.
 */
export function BulkJobUploadModal({ existingTitles, onImport, onClose }: {
  existingTitles: string[];
  /** Saves the jobs; resolves true once saved. */
  onImport: (items: BulkImportItem[]) => Promise<boolean>;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState<BulkJobParse | null>(null);
  const [fileError, setFileError] = useState('');
  const [mode, setMode] = useState<ImportMode>('post');
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    setParsed(null);
    setFileName(file.name);
    if (/\.(xlsx|xls|ods|numbers)$/i.test(file.name)) {
      setFileError('Save the sheet as CSV first: in Excel, File → Save As → CSV UTF-8; in Google Sheets, File → Download → CSV.');
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setFileError('That file is larger than 2 MB. Split it into smaller files.');
      return;
    }
    try {
      const result = parseBulkJobs(await file.text(), { existingTitles });
      setFileError(result.error);
      if (!result.error) setParsed(result);
    } catch {
      setFileError("That file couldn't be read. Save it as CSV and try again.");
    }
  };

  const reset = () => {
    setParsed(null);
    setFileName('');
    setFileError('');
    if (inputRef.current) inputRef.current.value = '';
  };

  const rows = parsed?.rows || [];
  const ready = rows.filter((row) => row.outcome === 'post');
  const unfinished = rows.filter((row) => row.outcome === 'draft');
  const skipped = rows.filter((row) => row.outcome === 'skip');
  const items: BulkImportItem[] = rows
    .filter((row) => row.outcome !== 'skip')
    .map((row) => ({ draft: row.draft, mode: mode === 'post' && row.outcome === 'post' ? 'post' : 'draft' }));
  const postCount = items.filter((item) => item.mode === 'post').length;
  const draftCount = items.length - postCount;
  const actionLabel = postCount > 0
    ? `Post ${plural(postCount, 'job')}${draftCount > 0 ? ` and save ${plural(draftCount, 'draft')}` : ''}`
    : `Save ${plural(draftCount, 'draft')}`;

  const submit = async () => {
    if (items.length === 0) return;
    setBusy(true);
    try {
      if (await onImport(items)) onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Upload jobs"
      subtitle={parsed ? fileName : `Add up to ${MAX_BULK_JOBS} jobs at once from a spreadsheet.`}
      onClose={busy ? () => undefined : onClose}
      size="lg"
      fullOnMobile
      footer={parsed ? (
        <>
          <button className="k-btn k-btn-ghost mr-auto" type="button" onClick={reset} disabled={busy}>Choose another file</button>
          <button className="k-btn k-btn-ghost" type="button" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="k-btn k-btn-primary" type="button" onClick={() => void submit()} disabled={busy || items.length === 0}>
            {busy ? 'Saving…' : items.length === 0 ? 'Nothing to save' : actionLabel}
          </button>
        </>
      ) : (
        <button className="k-btn k-btn-ghost" type="button" onClick={onClose}>Cancel</button>
      )}
    >
      {!parsed ? (
        <>
          <ol className="k-secondary list-decimal space-y-1 pl-5">
            <li>Download the template and fill in one job per row. Keep the first row as it is.</li>
            <li>Save it as CSV (Excel: CSV UTF-8; Google Sheets: Download → CSV).</li>
            <li>Upload it here. You can check every job before anything is saved.</li>
          </ol>
          <button className="k-btn k-btn-secondary mt-4" type="button" onClick={downloadTemplate}>
            <FontAwesomeIcon icon={faDownload} aria-hidden="true" />Download template
          </button>

          <label
            className={`k-dropzone mt-4 ${dragging ? 'k-dropzone-active' : ''}`}
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              void readFile(event.dataTransfer.files[0]);
            }}
          >
            <FontAwesomeIcon icon={faFileCsv} className="text-[28px] text-rust" aria-hidden="true" />
            <span className="k-label">Choose a CSV file or drop it here</span>
            <span className="k-meta">Up to {MAX_BULK_JOBS} jobs, 2 MB</span>
            <input
              ref={inputRef}
              className="sr-only"
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
              onChange={(event) => void readFile(event.target.files?.[0])}
            />
          </label>
          {fileError && <Banner tone="error" className="mt-3">{fileName ? <><strong>{fileName}</strong>: </> : null}{fileError}</Banner>}
          <AllowedValues />
        </>
      ) : (
        <>
          <p className="k-secondary k-dot-sep mb-3" aria-live="polite">
            <span><strong className="k-num text-dark">{ready.length}</strong> ready to post</span>
            {unfinished.length > 0 && <span><strong className="k-num text-dark">{unfinished.length}</strong> need more details</span>}
            {skipped.length > 0 && <span><strong className="k-num text-dark">{skipped.length}</strong> skipped (no title)</span>}
          </p>

          {ready.length > 0 && (
            <fieldset className="mb-4">
              <legend className="k-label mb-1">How to save them</legend>
              <label className="flex cursor-pointer items-start gap-2 py-1">
                <input type="radio" className="mt-1 accent-rust" name="bulk-mode" checked={mode === 'post'} onChange={() => setMode('post')} />
                <span>
                  <span className="block">Post ready jobs now</span>
                  <span className="k-meta block">Candidates can apply right away.{unfinished.length > 0 ? ' Jobs that need more details are saved as drafts.' : ''}</span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 py-1">
                <input type="radio" className="mt-1 accent-rust" name="bulk-mode" checked={mode === 'draft'} onChange={() => setMode('draft')} />
                <span>
                  <span className="block">Save all as drafts</span>
                  <span className="k-meta block">Hidden from candidates until you post them. You can post several at once from the jobs list.</span>
                </span>
              </label>
            </fieldset>
          )}
          {ready.length === 0 && unfinished.length > 0 && (
            <Banner tone="warn" className="mb-4">None of these jobs is complete yet, so they are saved as drafts. Fix the file and upload it again, or finish each draft in the editor.</Banner>
          )}
          {parsed.unknownHeaders.length > 0 && (
            <p className="k-meta mb-3">Ignored columns: {parsed.unknownHeaders.join(', ')}.</p>
          )}

          <ul className="k-list" aria-label="Jobs in the file">
            {rows.map((row) => {
              const { form } = row.draft;
              const meta = [[form.city, form.province].filter(Boolean).join(', '), form.workSetup, form.employmentType].filter(Boolean);
              return (
                <li key={row.rowNumber} className="k-row items-start">
                  <span className="k-row-main">
                    <span className="k-meta block">Row {row.rowNumber}</span>
                    <span className="k-label block truncate">{form.title || 'No title'}</span>
                    {meta.length > 0 && <span className="k-meta k-dot-sep block">{meta.map((part) => <span key={part} className="whitespace-nowrap">{part}</span>)}</span>}
                    {row.outcome === 'skip' ? (
                      <span className="k-meta mt-1 block">Add a job title to save this row.</span>
                    ) : row.problems.length > 0 && (
                      <ul className="mt-1 space-y-0.5">
                        {row.problems.map((problem) => (
                          <li key={problem} className="k-meta flex items-start gap-1.5">
                            <FontAwesomeIcon icon={faTriangleExclamation} className="mt-0.5 text-amber" aria-hidden="true" />{problem}
                          </li>
                        ))}
                      </ul>
                    )}
                    {row.warnings.map((warning) => <span key={warning} className="k-meta block">{warning}</span>)}
                  </span>
                  <span className="k-row-end">
                    {row.outcome === 'post' && mode === 'post' && <FontAwesomeIcon icon={faCircleCheck} className="text-green" aria-hidden="true" />}
                    {rowBadge(row, mode)}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="k-meta mt-3">Set up each job's candidate assessment afterwards: select the jobs in the list and choose Set assessment.</p>
        </>
      )}
    </Modal>
  );
}

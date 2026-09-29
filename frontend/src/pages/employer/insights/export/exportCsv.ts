import { csvCell } from '../../reports';
import { missingSkills, type JobInsight } from '../insightsModel';

// One row per job, aggregate figures only. There is no applicant-level column,
// and the file carries no metadata lines so a spreadsheet can read it as data.
export const INSIGHTS_CSV_COLUMNS = [
  'job_title',
  'status',
  'applicants',
  'strong_matches',
  'interviewing_or_hired',
  'top_missing_skills',
] as const;

const TOP_MISSING_IN_CSV = 3;

export function insightsCsv(jobs: JobInsight[]): string {
  const rows = jobs.map((job) => [
    job.title,
    job.isOpen ? 'Open' : 'Closed',
    job.applicants,
    job.strong,
    job.advanced,
    missingSkills(job).slice(0, TOP_MISSING_IN_CSV).map((stat) => stat.skill).join('; '),
  ]);
  const lines = [INSIGHTS_CSV_COLUMNS.join(','), ...rows.map((row) => row.map(csvCell).join(','))];
  return `${lines.join('\r\n')}\r\n`;
}

const pad = (value: number) => String(value).padStart(2, '0');

/** The local calendar date, e.g. 2026-09-28. */
export function localDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

/** kareerly-insights-2026-09-28.csv, or with a job slug for one job. */
export function insightsFileName(extension: 'csv' | 'pdf', date: Date, jobTitle = ''): string {
  const jobSlug = jobTitle ? slug(jobTitle) : '';
  return `kareerly-insights-${jobSlug ? `${jobSlug}-` : ''}${localDate(date)}.${extension}`;
}

export function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadInsightsCsv(jobs: JobInsight[], generatedAt = new Date(), jobTitle = '') {
  // The byte-order mark lets Excel read the file as UTF-8.
  saveBlob(new Blob(['﻿', insightsCsv(jobs)], { type: 'text/csv;charset=utf-8' }), insightsFileName('csv', generatedAt, jobTitle));
}

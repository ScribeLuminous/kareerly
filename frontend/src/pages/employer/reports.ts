import type { jsPDF as JsPdfDocument } from 'jspdf';
import type { CandidateAssessment } from '../../lib/assessmentApi';
import type { EvaluationSummary } from '../../lib/evaluationApi';
import { pdfSafeText } from '../../lib/reportPdf';
import { assessmentStatusLabel, HIGH_MATCH_PERCENT, profileMatch, weightedRating } from './evaluation';
import {
  applicantTitle,
  JOB_STATUS_LABEL,
  shouldRevealIdentity,
  type CandidateApplication,
  type CandidateStatus,
  type EmployerJob,
} from './model';

// ---------- Applicant export ----------

/**
 * One applicant as exported. Built with the same privacy rule as the list:
 * name and location are left blank until the applicant reaches Interviewing,
 * so a download never reveals more than the screen does.
 */
export type ApplicantExportRow = {
  jobTitle: string;
  jobStatus: string;
  applicant: string;
  candidateId: string;
  fullName: string;
  location: string;
  stage: CandidateStatus;
  appliedDate: string;
  lastActivity: string;
  /** Share of the job's required skills found in the application, or null when unknown. */
  matchPercent: number | null;
  requiredFound: string;
  skillsFound: string[];
  skillsNotFound: string[];
  assessment: string;
  reviewedRating: string;
};

export const APPLICANT_EXPORT_COLUMNS: Array<{ key: keyof ApplicantExportRow; label: string }> = [
  { key: 'jobTitle', label: 'Job' },
  { key: 'jobStatus', label: 'Job status' },
  { key: 'applicant', label: 'Applicant' },
  { key: 'candidateId', label: 'Candidate ID' },
  { key: 'fullName', label: 'Full name' },
  { key: 'location', label: 'Location' },
  { key: 'stage', label: 'Stage' },
  { key: 'appliedDate', label: 'Applied' },
  { key: 'lastActivity', label: 'Last activity' },
  { key: 'matchPercent', label: 'Profile match %' },
  { key: 'requiredFound', label: 'Required skills found' },
  { key: 'skillsFound', label: 'Skills found' },
  { key: 'skillsNotFound', label: 'Skills not found' },
  { key: 'assessment', label: 'Assessment' },
  { key: 'reviewedRating', label: 'Reviewed rating (of 4)' },
];

export function applicantExportRows(
  applications: CandidateApplication[],
  jobs: EmployerJob[],
  summaries: Map<string, EvaluationSummary> = new Map(),
  assessments: Map<string, CandidateAssessment> = new Map(),
): ApplicantExportRow[] {
  const jobsById = new Map(jobs.map((job) => [job.id, job]));
  return applications.map((candidate) => {
    const job = jobsById.get(candidate.jobId) || null;
    const profile = profileMatch(candidate, job);
    const revealed = shouldRevealIdentity(candidate.status);
    const result = summaries.get(candidate.id)?.result || null;
    const rating = result && result.submittedScorecards > 0 ? weightedRating(result.criteria) : null;
    return {
      jobTitle: job?.title || candidate.role || 'Unknown job',
      jobStatus: job ? JOB_STATUS_LABEL[job.status] : '',
      applicant: applicantTitle(candidate),
      candidateId: candidate.publicId,
      fullName: revealed ? candidate.fullName : '',
      location: revealed ? candidate.location : '',
      stage: candidate.status,
      appliedDate: candidate.appliedDate ? candidate.appliedDate.slice(0, 10) : '',
      lastActivity: candidate.lastActivity ? candidate.lastActivity.slice(0, 10) : '',
      matchPercent: profile.percent,
      requiredFound: profile.percent === null ? '' : `${profile.found.length} of ${profile.required.length}`,
      skillsFound: profile.found,
      skillsNotFound: profile.notFound,
      assessment: assessmentStatusLabel(assessments.get(candidate.id) || null),
      reviewedRating: rating === null ? '' : rating.toFixed(1),
    };
  });
}

/** Quotes a CSV cell, and defuses text a spreadsheet would run as a formula. */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : Array.isArray(value) ? value.join('; ') : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function applicantsCsv(rows: ApplicantExportRow[]): string {
  const lines = [
    APPLICANT_EXPORT_COLUMNS.map((column) => csvCell(column.label)).join(','),
    ...rows.map((row) => APPLICANT_EXPORT_COLUMNS.map((column) => csvCell(row[column.key])).join(',')),
  ];
  return `${lines.join('\r\n')}\r\n`;
}

export function exportFileName(scopeLabel: string, extension: 'csv' | 'pdf', generatedAt: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const date = `${generatedAt.getFullYear()}-${pad(generatedAt.getMonth() + 1)}-${pad(generatedAt.getDate())}`;
  const slug = scopeLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'applicants';
  return `kareerly-applicants-${slug}-${date}.${extension}`;
}

// ---------- Match insights ----------

export type JobMatchInsight = {
  job: EmployerJob;
  /** Applicants still in the running or decided; withdrawn applications are left out. */
  applicants: number;
  /** Applicants with recorded skill evidence, so a match figure exists. */
  withMatch: number;
  averageMatch: number | null;
  highMatches: number;
  /** Share of applicants with a figure who match at least HIGH_MATCH_PERCENT. */
  highMatchShare: number | null;
  advanced: number;
  hired: number;
  /** Applicants in each match band; `noFigure` have no skill evidence yet. */
  bands: MatchBands;
  /** Sum of the match figures, so totals across jobs average exactly. */
  matchSum: number;
  /** Required skills most often not found, most frequent first. */
  commonGaps: Array<{ skill: string; count: number }>;
};

/** Below HIGH_MATCH_PERCENT, a partial match still has at least this share of required skills. */
export const PARTIAL_MATCH_PERCENT = 40;

export type MatchBands = { strong: number; partial: number; low: number; noFigure: number };

export const MATCH_BAND_LABELS: Array<{ key: keyof MatchBands; label: string; range: string }> = [
  { key: 'strong', label: 'Strong', range: `${HIGH_MATCH_PERCENT}% or more` },
  { key: 'partial', label: 'Partial', range: `${PARTIAL_MATCH_PERCENT}–${HIGH_MATCH_PERCENT - 1}%` },
  { key: 'low', label: 'Low', range: `under ${PARTIAL_MATCH_PERCENT}%` },
  { key: 'noFigure', label: 'No figure', range: 'no skill evidence yet' },
];

export function jobMatchInsights(applications: CandidateApplication[], jobs: EmployerJob[], gapLimit = 3): JobMatchInsight[] {
  const insights = jobs.map((job) => {
    const forJob = applications.filter((candidate) => candidate.jobId === job.id && candidate.status !== 'Withdrawn');
    const percents: number[] = [];
    const gaps = new Map<string, { skill: string; count: number }>();
    forJob.forEach((candidate) => {
      const profile = profileMatch(candidate, job);
      if (profile.percent !== null) percents.push(profile.percent);
      profile.notFound.forEach((skill) => {
        const key = skill.trim().toLowerCase();
        const entry = gaps.get(key) || { skill, count: 0 };
        entry.count += 1;
        gaps.set(key, entry);
      });
    });
    const highMatches = percents.filter((percent) => percent >= HIGH_MATCH_PERCENT).length;
    const partial = percents.filter((percent) => percent >= PARTIAL_MATCH_PERCENT && percent < HIGH_MATCH_PERCENT).length;
    const matchSum = percents.reduce((sum, value) => sum + value, 0);
    return {
      job,
      applicants: forJob.length,
      withMatch: percents.length,
      averageMatch: percents.length ? Math.round(matchSum / percents.length) : null,
      highMatches,
      highMatchShare: percents.length ? Math.round((100 * highMatches) / percents.length) : null,
      advanced: forJob.filter((candidate) => candidate.status === 'Interviewing' || candidate.status === 'Hired').length,
      hired: forJob.filter((candidate) => candidate.status === 'Hired').length,
      bands: { strong: highMatches, partial, low: percents.length - highMatches - partial, noFigure: forJob.length - percents.length },
      matchSum,
      commonGaps: Array.from(gaps.values())
        .sort((a, b) => b.count - a.count || a.skill.localeCompare(b.skill))
        .slice(0, gapLimit),
    };
  });
  // Most strong matches first; ties go to the higher average, then more applicants.
  return insights
    .filter((insight) => insight.applicants > 0)
    .sort((a, b) => b.highMatches - a.highMatches || (b.averageMatch ?? -1) - (a.averageMatch ?? -1) || b.applicants - a.applicants || a.job.title.localeCompare(b.job.title));
}

export type InsightTotals = {
  jobs: number;
  applicants: number;
  withMatch: number;
  averageMatch: number | null;
  highMatches: number;
  highMatchShare: number | null;
  advanced: number;
  /** Jobs whose applicants have match figures but none at HIGH_MATCH_PERCENT or more. */
  jobsWithoutStrong: number;
};

/** One set of headline figures across the given jobs' insights. */
export function insightTotals(insights: JobMatchInsight[]): InsightTotals {
  const sum = (pick: (insight: JobMatchInsight) => number) => insights.reduce((total, insight) => total + pick(insight), 0);
  const withMatch = sum((insight) => insight.withMatch);
  const highMatches = sum((insight) => insight.highMatches);
  return {
    jobs: insights.length,
    applicants: sum((insight) => insight.applicants),
    withMatch,
    averageMatch: withMatch ? Math.round(sum((insight) => insight.matchSum) / withMatch) : null,
    highMatches,
    highMatchShare: withMatch ? Math.round((100 * highMatches) / withMatch) : null,
    advanced: sum((insight) => insight.advanced),
    jobsWithoutStrong: insights.filter((insight) => insight.withMatch > 0 && insight.highMatches === 0).length,
  };
}

export type SkillGapInsight = {
  skill: string;
  /** Applicants with skill evidence who lack this required skill. */
  missing: number;
  /** Applicants with skill evidence to the jobs that require it. */
  assessed: number;
  jobTitles: string[];
};

/** Required skills applicants most often lack, across the given jobs. */
export function skillGapsAcrossJobs(applications: CandidateApplication[], jobs: EmployerJob[], limit = 8): SkillGapInsight[] {
  const gaps = new Map<string, { skill: string; missing: number; assessed: number; jobTitles: Set<string> }>();
  jobs.forEach((job) => {
    applications
      .filter((candidate) => candidate.jobId === job.id && candidate.status !== 'Withdrawn')
      .forEach((candidate) => {
        const profile = profileMatch(candidate, job);
        if (profile.percent === null) return;
        profile.required.forEach((skill) => {
          const key = skill.trim().toLowerCase();
          const entry = gaps.get(key) || { skill, missing: 0, assessed: 0, jobTitles: new Set<string>() };
          entry.assessed += 1;
          if (profile.notFound.includes(skill)) {
            entry.missing += 1;
            entry.jobTitles.add(job.title);
          }
          gaps.set(key, entry);
        });
      });
  });
  return Array.from(gaps.values())
    .filter((entry) => entry.missing > 0)
    .map((entry) => ({ skill: entry.skill, missing: entry.missing, assessed: entry.assessed, jobTitles: Array.from(entry.jobTitles).sort() }))
    .sort((a, b) => b.missing - a.missing || b.missing / b.assessed - a.missing / a.assessed || a.skill.localeCompare(b.skill))
    .slice(0, limit);
}

// ---------- PDF ----------

export type ApplicantReportContent = {
  title: string;
  scopeLabel: string;
  generatedAt: Date;
  insights: JobMatchInsight[];
  rows: ApplicantExportRow[];
};

type JsPdfConstructor = new (options: { unit: 'mm'; format: 'a4' }) => JsPdfDocument;

const PAGE = { margin: 16, width: 210, height: 297 };
const COLORS = { dark: [34, 28, 24], soft: [110, 100, 92], accent: [178, 74, 38], rule: [225, 216, 206] } as const;

export function insightSummary(insight: JobMatchInsight): string {
  const parts = [`${insight.applicants} applicant${insight.applicants === 1 ? '' : 's'}`];
  parts.push(insight.averageMatch === null ? 'no match figures yet' : `average match ${insight.averageMatch}%`);
  parts.push(`${insight.highMatches} at ${HIGH_MATCH_PERCENT}% or more`);
  if (insight.advanced) parts.push(`${insight.advanced} interviewing or hired`);
  return parts.join(', ');
}

/** Lays out the insights, then applicants grouped by job, on A4 pages. */
export function buildApplicantReportPdf(JsPdf: JsPdfConstructor, content: ApplicantReportContent): JsPdfDocument {
  const doc = new JsPdf({ unit: 'mm', format: 'a4' });
  const contentWidth = PAGE.width - PAGE.margin * 2;
  const bottom = PAGE.height - PAGE.margin - 6;
  let y = PAGE.margin;

  const setColor = (color: readonly number[]) => doc.setTextColor(color[0], color[1], color[2]);
  const lineHeight = (size: number) => size * 0.42;
  const ensureSpace = (height: number) => {
    if (y + height > bottom) {
      doc.addPage();
      y = PAGE.margin;
    }
  };
  const write = (text: string, options: { size?: number; bold?: boolean; color?: readonly number[]; indent?: number; gap?: number } = {}) => {
    const size = options.size ?? 10;
    const indent = options.indent ?? 0;
    doc.setFont('helvetica', options.bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    setColor(options.color ?? COLORS.dark);
    for (const line of doc.splitTextToSize(pdfSafeText(text), contentWidth - indent) as string[]) {
      ensureSpace(lineHeight(size));
      y += lineHeight(size);
      doc.text(line, PAGE.margin + indent, y);
    }
    y += options.gap ?? 1.5;
  };
  const heading = (text: string) => {
    ensureSpace(16);
    y += 4;
    write(text, { size: 13, bold: true, color: COLORS.accent, gap: 1 });
    doc.setDrawColor(COLORS.rule[0], COLORS.rule[1], COLORS.rule[2]);
    doc.line(PAGE.margin, y, PAGE.width - PAGE.margin, y);
    y += 3;
  };

  write(content.title, { size: 18, bold: true, gap: 1 });
  write(`${content.scopeLabel}  |  Generated ${content.generatedAt.toLocaleString()}`, { size: 9, color: COLORS.soft, gap: 1 });
  write('Names and locations are shown only for applicants at Interviewing or later, as on screen. Profile match is the share of the job\'s required skills found in the application; it is one input, not a ranking.', { size: 9, color: COLORS.soft });

  heading('Match insights by job');
  if (content.insights.length === 0) write('No applicants in this report.', { color: COLORS.soft });
  for (const insight of content.insights) {
    ensureSpace(12);
    write(insight.job.title, { size: 11, bold: true, gap: 0.5 });
    write(insightSummary(insight), { size: 9, indent: 3, gap: 0.5 });
    if (insight.commonGaps.length) {
      write(`Most often missing: ${insight.commonGaps.map((gap) => `${gap.skill} (${gap.count})`).join(', ')}`, { size: 9, indent: 3, color: COLORS.soft, gap: 0.5 });
    }
    y += 2;
  }

  const byJob = new Map<string, ApplicantExportRow[]>();
  content.rows.forEach((row) => byJob.set(row.jobTitle, [...(byJob.get(row.jobTitle) || []), row]));
  for (const [jobTitle, rows] of byJob) {
    heading(`${jobTitle} (${rows.length})`);
    for (const row of rows) {
      ensureSpace(14);
      const match = row.matchPercent === null ? 'Match n/a' : `Match ${row.matchPercent}% (${row.requiredFound})`;
      write(`${row.applicant}  |  ${row.stage}  |  ${match}`, { size: 10, bold: true, gap: 0.5 });
      const meta = [row.candidateId && row.candidateId !== row.applicant ? row.candidateId : '', row.location, `Applied ${row.appliedDate || 'n/a'}`, `Assessment: ${row.assessment}`, row.reviewedRating ? `Reviewed ${row.reviewedRating}/4` : '']
        .filter(Boolean)
        .join('  |  ');
      write(meta, { size: 9, color: COLORS.soft, indent: 3, gap: 0.5 });
      if (row.skillsFound.length) write(`Found: ${row.skillsFound.join(', ')}`, { size: 9, indent: 3, gap: 0.5 });
      if (row.skillsNotFound.length) write(`Not found: ${row.skillsNotFound.join(', ')}`, { size: 9, indent: 3, gap: 0.5 });
      y += 2;
    }
  }

  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    setColor(COLORS.soft);
    doc.text(`Kareerly applicant report  |  Confidential  |  Page ${page} of ${pageCount}`, PAGE.width / 2, PAGE.height - 10, { align: 'center' });
  }
  return doc;
}

// ---------- Downloads ----------

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadApplicantsCsv(rows: ApplicantExportRow[], scopeLabel: string, generatedAt = new Date()) {
  // The byte-order mark lets Excel read accented names as UTF-8.
  saveBlob(new Blob(['﻿', applicantsCsv(rows)], { type: 'text/csv;charset=utf-8' }), exportFileName(scopeLabel, 'csv', generatedAt));
}

export async function downloadApplicantsPdf(content: ApplicantReportContent): Promise<void> {
  // Loaded on demand so the PDF library stays out of the main bundle.
  const { jsPDF } = await import('jspdf');
  buildApplicantReportPdf(jsPDF, content).save(exportFileName(content.scopeLabel, 'pdf', content.generatedAt));
}

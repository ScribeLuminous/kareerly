import type { jsPDF as JsPdfDocument } from 'jspdf';
import { pdfSafeText } from '../../../../lib/reportPdf';
import { INSIGHTS_DISCLAIMER, type JobInsight, type Kpis, type SkillGap } from '../insightsModel';
import { STRONG_MATCH_PERCENT } from '../matchTiers';
import { insightsFileName } from './exportCsv';

/** Everything the PDF prints. Aggregate figures only, so no applicant can appear in it. */
export type InsightsReportContent = {
  employerName: string;
  generatedAt: Date;
  /** The status filter and job scope the figures cover, in words. */
  filterLabel: string;
  kpis: Kpis;
  jobs: JobInsight[];
  gaps: SkillGap[];
};

type JsPdfConstructor = new (options: { unit: 'mm'; format: 'a4' }) => JsPdfDocument;

const PAGE = { margin: 16, width: 210, height: 297 };
// Dark text and hairline rules only, so the report reads the same in grayscale.
const INK = [34, 28, 24] as const;
const SOFT = [95, 86, 79] as const;
const RULE = [200, 192, 184] as const;

const COLUMNS = [
  { key: 'job', label: 'Job', x: 0, width: 96, align: 'left' },
  { key: 'status', label: 'Status', x: 96, width: 22, align: 'left' },
  { key: 'applicants', label: 'Applicants', x: 118, width: 24, align: 'right' },
  { key: 'strong', label: 'Strong matches', x: 142, width: 38, align: 'right' },
] as const;

export function buildInsightsPdf(JsPdf: JsPdfConstructor, content: InsightsReportContent): JsPdfDocument {
  const doc = new JsPdf({ unit: 'mm', format: 'a4' });
  const contentWidth = PAGE.width - PAGE.margin * 2;
  const bottom = PAGE.height - PAGE.margin - 8;
  let y = PAGE.margin;

  const color = (value: readonly number[]) => doc.setTextColor(value[0], value[1], value[2]);
  const lineHeight = (size: number) => size * 0.42;
  const ensureSpace = (height: number) => {
    if (y + height > bottom) {
      doc.addPage();
      y = PAGE.margin;
    }
  };
  const write = (text: string, options: { size?: number; bold?: boolean; tone?: readonly number[]; indent?: number; gap?: number } = {}) => {
    const size = options.size ?? 10;
    doc.setFont('helvetica', options.bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    color(options.tone ?? INK);
    for (const line of doc.splitTextToSize(pdfSafeText(text), contentWidth - (options.indent ?? 0)) as string[]) {
      ensureSpace(lineHeight(size));
      y += lineHeight(size);
      doc.text(line, PAGE.margin + (options.indent ?? 0), y);
    }
    y += options.gap ?? 1.5;
  };
  const rule = () => {
    doc.setDrawColor(RULE[0], RULE[1], RULE[2]);
    doc.line(PAGE.margin, y, PAGE.width - PAGE.margin, y);
  };
  const heading = (text: string) => {
    ensureSpace(16);
    y += 5;
    write(text, { size: 13, bold: true, gap: 1 });
    rule();
    y += 3;
  };
  const cell = (text: string, column: (typeof COLUMNS)[number], baseline: number, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(9);
    color(INK);
    const x = PAGE.margin + column.x + (column.align === 'right' ? column.width - 2 : 0);
    doc.text(pdfSafeText(text), x, baseline, { align: column.align });
  };

  write('Kareerly Insights Report', { size: 18, bold: true, gap: 1 });
  if (content.employerName) write(content.employerName, { size: 11, gap: 1 });
  write(`Generated ${content.generatedAt.toLocaleString()}  |  ${content.filterLabel}`, { size: 9, tone: SOFT, gap: 1 });

  heading('Summary');
  const { kpis } = content;
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
  write(`${kpis.strong} of ${plural(kpis.applicants, 'applicant')} match ${STRONG_MATCH_PERCENT}% or more of the skills asked for.`, { size: 12, bold: true, gap: 1 });
  write(
    [`${plural(kpis.applicants, 'applicant')} across ${plural(kpis.jobs, 'job')}`, `${kpis.advanced} interviewing or hired`, kpis.applicants > kpis.scored ? `${kpis.applicants - kpis.scored} without skill data yet` : ''].filter(Boolean).join('  |  '),
    { size: 9, tone: SOFT },
  );

  heading('Jobs');
  if (content.jobs.length === 0) write('No applicants in this report.', { tone: SOFT });
  else {
    const header = () => {
      ensureSpace(12);
      y += lineHeight(9);
      COLUMNS.forEach((column) => cell(column.label, column, y, true));
      y += 1.5;
      rule();
      y += 1;
    };
    header();
    content.jobs.forEach((job) => {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      const titleLines = doc.splitTextToSize(pdfSafeText(job.title), COLUMNS[0].width - 3) as string[];
      const rowHeight = titleLines.length * lineHeight(9) + 3;
      if (y + rowHeight > bottom) {
        doc.addPage();
        y = PAGE.margin;
        header();
      }
      const baseline = y + lineHeight(9);
      titleLines.forEach((line, index) => doc.text(line, PAGE.margin, baseline + index * lineHeight(9)));
      cell(job.isOpen ? 'Open' : 'Closed', COLUMNS[1], baseline);
      cell(String(job.applicants), COLUMNS[2], baseline);
      cell(job.scored === 0 ? 'No skill data' : `${job.strong} of ${job.applicants}`, COLUMNS[3], baseline);
      y += rowHeight;
    });
  }

  heading('Skills most often missing');
  if (content.gaps.length === 0) write('No missing required skills recorded.', { tone: SOFT });
  content.gaps.forEach((gap) => {
    ensureSpace(10);
    write(`${gap.skill}: ${gap.missing} of ${gap.assessed} applicant${gap.assessed === 1 ? '' : 's'}`, { size: 10, gap: 1 });
  });
  write('A common gap may mean the skill is scarce, or that it could be trained on the job.', { size: 9, tone: SOFT });

  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    color(SOFT);
    doc.text(INSIGHTS_DISCLAIMER, PAGE.margin, PAGE.height - 10);
    doc.text(`Page ${page} of ${pageCount}`, PAGE.width - PAGE.margin, PAGE.height - 10, { align: 'right' });
  }
  return doc;
}

export async function downloadInsightsPdf(content: InsightsReportContent): Promise<void> {
  // Loaded on demand so the PDF library stays out of the main bundle.
  const { jsPDF } = await import('jspdf');
  buildInsightsPdf(jsPDF, content).save(insightsFileName('pdf', content.generatedAt));
}

import type { jsPDF as JsPdfDocument } from 'jspdf';
import { pdfSafeText } from '../../../../lib/reportPdf';
import { INSIGHTS_DISCLAIMER, type JobInsight, type Kpis, type SkillGap } from '../insightsModel';
import { GOOD_MATCH_PERCENT, MATCH_LEVELS } from '../matchTiers';
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
  { key: 'job', label: 'Job', x: 0, width: 62, align: 'left' },
  { key: 'status', label: 'Status', x: 62, width: 20, align: 'left' },
  { key: 'applicants', label: 'Applicants', x: 82, width: 22, align: 'right' },
  { key: 'avg', label: 'Avg match', x: 104, width: 24, align: 'right' },
  { key: 'level', label: 'Level', x: 128, width: 22, align: 'left' },
  { key: 'strong', label: 'Strong', x: 150, width: 14, align: 'right' },
  { key: 'advanced', label: 'Int./hired', x: 164, width: 16, align: 'right' },
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
  write(`Match level: ${MATCH_LEVELS.filter((item) => item.level !== 'none').map((item) => `${item.label} ${item.range}`).join(', ')}. Strong means ${GOOD_MATCH_PERCENT}% or more of a job's required skills.`, { size: 9, tone: SOFT });

  heading('Summary');
  const { kpis } = content;
  const summary: Array<[string, string]> = [
    ['Total applicants', `${kpis.applicants} across ${kpis.jobs} job${kpis.jobs === 1 ? '' : 's'}`],
    ['Average match', kpis.avgMatch === null ? 'No skill evidence yet' : `${kpis.avgMatch}%`],
    ['Strong matches', String(kpis.strong)],
    ['Interviewing or hired', String(kpis.advanced)],
  ];
  summary.forEach(([label, value]) => {
    ensureSpace(6);
    y += lineHeight(10);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    color(SOFT);
    doc.text(label, PAGE.margin, y);
    doc.setFont('helvetica', 'bold');
    color(INK);
    doc.text(pdfSafeText(value), PAGE.margin + 52, y);
    y += 2;
  });

  heading('Match by job');
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
      cell(job.avgMatch === null ? '-' : `${job.avgMatch}%`, COLUMNS[3], baseline);
      cell(MATCH_LEVELS.find((item) => item.level === job.level)?.label || '', COLUMNS[4], baseline);
      cell(String(job.strong), COLUMNS[5], baseline);
      cell(String(job.advanced), COLUMNS[6], baseline);
      y += rowHeight;
    });
  }

  heading('Skills applicants most often lack');
  if (content.gaps.length === 0) write('No missing required skills recorded.', { tone: SOFT });
  content.gaps.forEach((gap) => {
    ensureSpace(10);
    write(`${gap.skill}: ${gap.missing} of ${gap.assessed} applicant${gap.assessed === 1 ? '' : 's'} (${gap.share}%)${gap.smallSample ? ` - small sample (${gap.assessed} applicant${gap.assessed === 1 ? '' : 's'})` : ''}`, { size: 10, gap: 1 });
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

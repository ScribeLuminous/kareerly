import type { jsPDF as JsPdfDocument } from 'jspdf';

/**
 * Plain content of a Step 4 report, exactly as shown on screen. The PDF is
 * built only from this, so it can never include results the on-screen report
 * hides from the current user.
 */
export type ReportMatchEntry = {
  title: string;
  location: string;
  scoreLabel: string;
  lines: string[];
};

export type ReportSection = {
  heading: string;
  emptyText: string;
  entries: ReportMatchEntry[];
};

export type CareerReportContent = {
  title: string;
  generatedAt: Date;
  accessNote: string;
  summary: Array<{ label: string; value: string; detail: string }>;
  preferences: Array<{ label: string; value: string }>;
  sections: ReportSection[];
};

type JsPdfConstructor = new (options: { unit: 'mm'; format: 'a4' }) => JsPdfDocument;

const PAGE = { margin: 18, width: 210, height: 297 };
const COLORS = { dark: [34, 28, 24], soft: [110, 100, 92], accent: [178, 74, 38], rule: [225, 216, 206] } as const;

// The built-in PDF fonts cover Latin-1 only. Map the few symbols the report
// uses and drop anything else rather than printing unreadable glyphs.
const REPLACEMENTS: Array<[RegExp, string]> = [
  [/₱\s*/g, 'PHP '],
  [/[–—−]/g, '-'],
  [/[‘’′]/g, "'"],
  [/[“”]/g, '"'],
  [/•/g, '|'],
  [/…/g, '...'],
  [/\u00a0/g, ' '],
];

export function pdfSafeText(value: string): string {
  let text = String(value ?? '');
  for (const [pattern, replacement] of REPLACEMENTS) text = text.replace(pattern, replacement);
  // eslint-disable-next-line no-control-regex
  return text.replace(/[^\x09\x0a\x0d\x20-\x7e\xa0-\xff]/g, '').replace(/\s+/g, ' ').trim();
}

export function reportFileName(generatedAt: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const date = `${generatedAt.getFullYear()}-${pad(generatedAt.getMonth() + 1)}-${pad(generatedAt.getDate())}`;
  return `kareerly-career-report-${date}.pdf`;
}

/** Lays the report out on A4 pages; long sections continue on new pages. */
export function buildCareerReportPdf(JsPdf: JsPdfConstructor, content: CareerReportContent): JsPdfDocument {
  const doc = new JsPdf({ unit: 'mm', format: 'a4' });
  const contentWidth = PAGE.width - PAGE.margin * 2;
  const bottom = PAGE.height - PAGE.margin - 6;
  let y = PAGE.margin;

  const setColor = (color: readonly number[]) => doc.setTextColor(color[0], color[1], color[2]);
  const lineHeight = (size: number) => size * 0.42;
  const wrap = (text: string, size: number, width = contentWidth): string[] => {
    doc.setFontSize(size);
    return doc.splitTextToSize(pdfSafeText(text), width) as string[];
  };
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
    setColor(options.color ?? COLORS.dark);
    for (const line of wrap(text, size, contentWidth - indent)) {
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
  write(`Generated ${content.generatedAt.toLocaleString()}`, { size: 9, color: COLORS.soft, gap: 1 });
  if (content.accessNote) write(content.accessNote, { size: 9, color: COLORS.soft });

  heading('Summary');
  for (const item of content.summary) {
    write(`${item.label}: ${item.value}`, { bold: true, gap: 0.5 });
    if (item.detail) write(item.detail, { size: 9, color: COLORS.soft, indent: 4 });
  }

  heading('Your Preferences');
  if (content.preferences.length === 0) write('No preferences were recorded for this report.', { color: COLORS.soft });
  for (const item of content.preferences) write(`${item.label}: ${item.value}`, { gap: 0.8 });

  for (const section of content.sections) {
    heading(section.heading);
    if (section.entries.length === 0) {
      write(section.emptyText, { color: COLORS.soft });
      continue;
    }
    for (const entry of section.entries) {
      // Keep an entry's title with at least its first detail line.
      ensureSpace(14);
      const titleText = entry.scoreLabel ? `${entry.title}  (${entry.scoreLabel})` : entry.title;
      write(titleText, { size: 11, bold: true, gap: 0.5 });
      if (entry.location) write(entry.location, { size: 9, color: COLORS.soft, gap: 0.8 });
      for (const line of entry.lines) write(line, { size: 9, indent: 3, gap: 0.8 });
      y += 2.5;
    }
  }

  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    setColor(COLORS.soft);
    doc.text(`Kareerly career report  |  Page ${page} of ${pageCount}`, PAGE.width / 2, PAGE.height - 10, { align: 'center' });
  }
  return doc;
}

export async function downloadCareerReportPdf(content: CareerReportContent): Promise<void> {
  // Loaded on demand so the PDF library is not part of the onboarding bundle.
  const { jsPDF } = await import('jspdf');
  buildCareerReportPdf(jsPDF, content).save(reportFileName(content.generatedAt));
}

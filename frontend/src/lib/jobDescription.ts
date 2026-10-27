export function formatJobDescription(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/\s+(Key responsibilities|Responsibilities|Qualifications|Requirements|What you'll do|The ideal candidate)(\s*:)?/gi, '\n\n$1$2')
    .replace(/[ \t]+[-•][ \t]+(?=[A-Z])/g, '\n• ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const SECTION_HEADINGS = {
  responsibilities: /(?:^|\n)\s*(?:Key responsibilities|Responsibilities|What you'll do)\s*:\s*/i,
  qualifications: /(?:^|\n)\s*Qualifications\s*:\s*/i,
};

/** One item per line, with any bullet removed. */
export function toListItems(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((item) => item.replace(/^\s*[-–—•*]\s*/, '').trim())
    .filter(Boolean);
}

/**
 * Reads a description written by joinJobContent (or pasted with the same
 * headings) back into its overview, responsibilities and qualifications.
 */
export function splitJobContent(value: string): { description: string; responsibilities: string[]; qualifications: string[] } {
  const normalized = value.replace(/\r\n?/g, '\n').trim();
  const sections = (Object.keys(SECTION_HEADINGS) as Array<keyof typeof SECTION_HEADINGS>)
    .map((key) => {
      const marker = normalized.match(SECTION_HEADINGS[key]);
      return marker && marker.index !== undefined ? { key, start: marker.index, end: marker.index + marker[0].length } : null;
    })
    .filter((section): section is { key: keyof typeof SECTION_HEADINGS; start: number; end: number } => section !== null)
    .sort((a, b) => a.start - b.start);

  const result = { description: normalized, responsibilities: [] as string[], qualifications: [] as string[] };
  if (sections.length === 0) return result;
  result.description = normalized.slice(0, sections[0].start).trim();
  sections.forEach((section, index) => {
    const next = sections[index + 1];
    result[section.key] = toListItems(normalized.slice(section.end, next ? next.start : undefined));
  });
  return result;
}

export function joinJobContent(description: string, responsibilities: string, qualifications = ''): string {
  const parts = [description.trim()];
  const duties = toListItems(responsibilities);
  const requirements = toListItems(qualifications);
  if (duties.length > 0) parts.push(`Responsibilities:\n${duties.map((item) => `- ${item}`).join('\n')}`);
  if (requirements.length > 0) parts.push(`Qualifications:\n${requirements.map((item) => `- ${item}`).join('\n')}`);
  return parts.filter(Boolean).join('\n\n');
}

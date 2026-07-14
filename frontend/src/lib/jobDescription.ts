export function formatJobDescription(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/\s+(Key responsibilities|Responsibilities|Qualifications|Requirements|What you'll do|The ideal candidate)(\s*:)?/gi, '\n\n$1$2')
    .replace(/[ \t]+[-•][ \t]+(?=[A-Z])/g, '\n• ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function splitJobContent(value: string): { description: string; responsibilities: string[] } {
  const normalized = value.replace(/\r\n?/g, '\n').trim();
  const marker = normalized.match(/(?:^|\n)\s*(?:Key responsibilities|Responsibilities|What you'll do)\s*:\s*/i);
  if (!marker || marker.index === undefined) return { description: normalized, responsibilities: [] };

  const responsibilitiesStart = marker.index + marker[0].length;
  const description = normalized.slice(0, marker.index).trim();
  const responsibilities = normalized
    .slice(responsibilitiesStart)
    .split(/\n+/)
    .map((item) => item.replace(/^\s*[-–—•*]\s*/, '').trim())
    .filter(Boolean);
  return { description, responsibilities };
}

export function joinJobContent(description: string, responsibilities: string): string {
  const overview = description.trim();
  const items = responsibilities
    .split(/\r?\n/)
    .map((item) => item.replace(/^\s*[-–—•*]\s*/, '').trim())
    .filter(Boolean);
  if (items.length === 0) return overview;
  return `${overview}\n\nResponsibilities:\n${items.map((item) => `- ${item}`).join('\n')}`;
}

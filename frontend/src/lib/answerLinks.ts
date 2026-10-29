// Links in a candidate's written answer, so a reviewer can open them and the
// review can show which were opened.

export type AnswerPart = { type: 'text' | 'link'; value: string };

const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/gi;
const TRAILING = /[.,;:!?]+$/;

/** The answer as text and link pieces. Only http(s) links become links; punctuation after a link stays text. */
export function splitAnswerLinks(text: string): AnswerPart[] {
  const parts: AnswerPart[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    const url = match[0].replace(TRAILING, '');
    if (start > last) parts.push({ type: 'text', value: text.slice(last, start) });
    parts.push({ type: 'link', value: url });
    last = start + url.length;
  }
  if (last < text.length) parts.push({ type: 'text', value: text.slice(last) });
  return parts;
}

/** The distinct links in the answers, in order. */
export function linksIn(texts: string[]): string[] {
  const seen: string[] = [];
  texts.forEach((text) => splitAnswerLinks(text).forEach((part) => {
    if (part.type === 'link' && !seen.includes(part.value)) seen.push(part.value);
  }));
  return seen;
}

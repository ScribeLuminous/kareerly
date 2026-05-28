import type { MatchResultItem } from '../types';

export type MatchScoreContext = 'fit_now' | 'aspiration' | 'generic';

type MatchRecord = Record<string, unknown>;

function toMatchRecord(match: unknown): MatchRecord {
  if (!match || typeof match !== 'object') return {};
  return match as MatchRecord;
}

export function parseNumericValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const cleaned = trimmed.replace(/%/g, '');
    const parsed = Number(cleaned);
    if (Number.isFinite(parsed)) return parsed;
  }

  return null;
}

export function normalizePercentValue(value: unknown): number | null {
  const numeric = parseNumericValue(value);
  if (numeric === null) return null;

  const percentValue = numeric >= 0 && numeric <= 1 ? numeric * 100 : numeric;
  if (!Number.isFinite(percentValue)) return null;

  return Math.max(0, Math.min(100, percentValue));
}

function scoreKeysForContext(context: MatchScoreContext): string[] {
  if (context === 'fit_now') {
    return ['fit_now_percentage', 'match_percentage', 'match_score', 'fit_score', 'score', 'fit_now_score', 'aspiration_percentage', 'aspiration_score'];
  }
  if (context === 'aspiration') {
    return ['aspiration_percentage', 'match_percentage', 'match_score', 'fit_score', 'score', 'aspiration_score', 'fit_now_percentage', 'fit_now_score'];
  }

  return ['match_percentage', 'match_score', 'score', 'fit_score', 'fit_now_percentage', 'aspiration_percentage', 'fit_now_score', 'aspiration_score'];
}

export function extractMatchPercent(match: unknown, context: MatchScoreContext = 'generic'): number | null {
  const record = toMatchRecord(match);

  for (const key of scoreKeysForContext(context)) {
    const normalized = normalizePercentValue(record[key]);
    if (normalized !== null) return normalized;
  }

  return null;
}

export function formatMatchPercentLabel(percent: number | null, fallback = 'Match pending'): string {
  if (percent === null) return fallback;
  return `${Math.round(percent)}%`;
}

export function normalizeMatchItemPercentages(match: MatchResultItem, context: MatchScoreContext): MatchResultItem {
  const record = toMatchRecord(match);
  const normalizedMatch = { ...match } as MatchResultItem;
  const dynamic = normalizedMatch as MatchResultItem & MatchRecord;

  const fitNowPercent = normalizePercentValue(record.fit_now_percentage);
  if (fitNowPercent !== null) normalizedMatch.fit_now_percentage = fitNowPercent;

  const aspirationPercent = normalizePercentValue(record.aspiration_percentage);
  if (aspirationPercent !== null) normalizedMatch.aspiration_percentage = aspirationPercent;

  const matchPercent = normalizePercentValue(record.match_percentage);
  if (matchPercent !== null) normalizedMatch.match_percentage = matchPercent;

  const fitNowScore = parseNumericValue(record.fit_now_score);
  if (fitNowScore !== null) normalizedMatch.fit_now_score = fitNowScore;

  const aspirationScore = parseNumericValue(record.aspiration_score);
  if (aspirationScore !== null) normalizedMatch.aspiration_score = aspirationScore;

  const textSimilarity = parseNumericValue(record.text_similarity);
  if (textSimilarity !== null) normalizedMatch.text_similarity = textSimilarity;

  const skillCoverage = parseNumericValue(record.skill_coverage);
  if (skillCoverage !== null) normalizedMatch.skill_coverage = skillCoverage;

  const resolvedPercent = extractMatchPercent(dynamic, context);
  if (resolvedPercent !== null) {
    normalizedMatch.match_percentage = resolvedPercent;
    if (context === 'fit_now' && typeof normalizedMatch.fit_now_percentage !== 'number') {
      normalizedMatch.fit_now_percentage = resolvedPercent;
    }
    if (context === 'aspiration' && typeof normalizedMatch.aspiration_percentage !== 'number') {
      normalizedMatch.aspiration_percentage = resolvedPercent;
    }
  }

  return normalizedMatch;
}

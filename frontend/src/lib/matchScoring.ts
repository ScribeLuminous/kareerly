import type { MatchResultItem, PrioritizedSkillGap } from '../types';

export type MatchScoreContext = 'fit_now' | 'aspiration' | 'generic';

type MatchRecord = Record<string, unknown>;
const NUMERIC_PATTERN = '[-+]?(?:\\d+\\.?\\d*|\\.\\d+)';
const RATIO_PATTERN = new RegExp(`^\\s*(${NUMERIC_PATTERN})\\s*\\/\\s*(${NUMERIC_PATTERN})\\s*$`);
const NUMBER_TOKEN_PATTERN = new RegExp(NUMERIC_PATTERN);

function toMatchRecord(match: unknown): MatchRecord {
  if (!match || typeof match !== 'object') return {};
  return match as MatchRecord;
}

function parseRatioValue(raw: string): number | null {
  const ratioMatch = raw.match(RATIO_PATTERN);
  if (!ratioMatch) return null;

  const numerator = Number(ratioMatch[1]);
  const denominator = Number(ratioMatch[2]);

  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  return numerator / denominator;
}

export function parseNumericValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;

    const ratioValue = parseRatioValue(trimmed);
    if (ratioValue !== null) return ratioValue;

    const cleaned = trimmed
      .replace(/,/g, '')
      .replace(/%/g, '')
      .replace(/\bpercent(?:age)?\b/gi, '')
      .replace(/\bpct\b/gi, '')
      .trim();

    const parsed = Number(cleaned);
    if (Number.isFinite(parsed)) return parsed;

    const tokenMatch = cleaned.match(NUMBER_TOKEN_PATTERN);
    if (tokenMatch) {
      const tokenParsed = Number(tokenMatch[0]);
      if (Number.isFinite(tokenParsed)) return tokenParsed;
    }

    return null;
  }

  if (value && typeof value === 'object') {
    const record = value as MatchRecord;
    for (const key of ['value', 'score', 'percent', 'percentage']) {
      const nested = record[key];
      if (nested === value) continue;
      const parsed = parseNumericValue(nested);
      if (parsed !== null) return parsed;
    }
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
    return [
      'fit_now_percentage',
      'fitNowPercentage',
      'fit_now_percent',
      'fitNowPercent',
      'match_percentage',
      'matchPercentage',
      'employer_alignment_percentage',
      'employerAlignmentPercentage',
      'overall_match_percentage',
      'overallMatchPercentage',
      'percentage',
      'percent',
      'fit_now_score',
      'fitNowScore',
      'match_score',
      'matchScore',
      'fit_score',
      'fitScore',
      'employer_alignment_score',
      'employerAlignmentScore',
      'overall_match_score',
      'overallMatchScore',
      'score',
      'aspiration_percentage',
      'aspiration_score',
    ];
  }
  if (context === 'aspiration') {
    return [
      'aspiration_percentage',
      'aspirationPercentage',
      'aspiration_percent',
      'aspirationPercent',
      'match_percentage',
      'matchPercentage',
      'overall_match_percentage',
      'overallMatchPercentage',
      'percentage',
      'percent',
      'aspiration_score',
      'aspirationScore',
      'match_score',
      'matchScore',
      'fit_score',
      'fitScore',
      'overall_match_score',
      'overallMatchScore',
      'score',
      'fit_now_percentage',
      'fit_now_score',
      'employer_alignment_percentage',
      'employer_alignment_score',
    ];
  }

  return [
    'match_percentage',
    'matchPercentage',
    'overall_match_percentage',
    'overallMatchPercentage',
    'fit_now_percentage',
    'fitNowPercentage',
    'aspiration_percentage',
    'aspirationPercentage',
    'employer_alignment_percentage',
    'employerAlignmentPercentage',
    'percentage',
    'percent',
    'match_score',
    'matchScore',
    'overall_match_score',
    'overallMatchScore',
    'fit_score',
    'fitScore',
    'fit_now_score',
    'fitNowScore',
    'aspiration_score',
    'aspirationScore',
    'employer_alignment_score',
    'employerAlignmentScore',
    'score',
  ];
}

function fallbackScoreKeys(record: MatchRecord, context: MatchScoreContext): string[] {
  const candidateKeys = Object.keys(record).filter((key) => /(percent|score)/i.test(key));
  if (candidateKeys.length === 0) return [];

  const contextPattern =
    context === 'fit_now'
      ? /(fit|match|alignment)/i
      : context === 'aspiration'
        ? /(aspiration|match)/i
        : /(match|fit|aspiration|alignment)/i;

  const preferred = candidateKeys.filter((key) => contextPattern.test(key));
  const remaining = candidateKeys.filter((key) => !contextPattern.test(key));

  return [...preferred, ...remaining];
}

export function extractMatchPercent(match: unknown, context: MatchScoreContext = 'generic'): number | null {
  const record = toMatchRecord(match);

  for (const key of scoreKeysForContext(context)) {
    const normalized = normalizePercentValue(record[key]);
    if (normalized !== null) return normalized;
  }

  for (const key of fallbackScoreKeys(record, context)) {
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

const SKILL_GAP_COUNT_KEYS = [
  'appears_in_top_matches',
  'appearsInTopMatches',
  'missing_count',
  'missingCount',
  'match_count',
  'matchCount',
  'matches_count',
  'matchesCount',
  'affected_matches',
  'affectedMatches',
  'frequency',
];

const SKILL_GAP_PERCENT_KEYS = [
  'match_percentage',
  'matchPercentage',
  'missing_percentage',
  'missingPercentage',
  'skill_gap_percentage',
  'skillGapPercentage',
  'affected_match_percentage',
  'affectedMatchPercentage',
  'percentage',
  'percent',
  'ratio',
];

export function extractSkillGapMatchCount(gap: unknown): number | null {
  const record = toMatchRecord(gap);

  for (const key of SKILL_GAP_COUNT_KEYS) {
    const numeric = parseNumericValue(record[key]);
    if (numeric !== null) {
      return Math.max(0, Math.round(numeric));
    }
  }

  const fallbackCountKeys = Object.keys(record).filter((key) =>
    /(count|matches?|frequency|occurrences?)/i.test(key) && !/(percent|percentage|ratio|score)/i.test(key),
  );

  for (const key of fallbackCountKeys) {
    const numeric = parseNumericValue(record[key]);
    if (numeric !== null) {
      return Math.max(0, Math.round(numeric));
    }
  }

  return null;
}

export function extractSkillGapMatchPercent(gap: unknown, totalMatchCount?: number): number | null {
  const record = toMatchRecord(gap);

  for (const key of SKILL_GAP_PERCENT_KEYS) {
    const normalized = normalizePercentValue(record[key]);
    if (normalized !== null) return normalized;
  }

  const fallbackPercentKeys = Object.keys(record).filter((key) => /(percent|percentage|ratio)/i.test(key));
  for (const key of fallbackPercentKeys) {
    const normalized = normalizePercentValue(record[key]);
    if (normalized !== null) return normalized;
  }

  const count = extractSkillGapMatchCount(record);
  if (count === null || typeof totalMatchCount !== 'number' || !Number.isFinite(totalMatchCount) || totalMatchCount <= 0) {
    return null;
  }

  return normalizePercentValue((count / totalMatchCount) * 100);
}

export function normalizeSkillGapPercentages(gap: PrioritizedSkillGap, totalMatchCount?: number): PrioritizedSkillGap {
  const normalizedGap = { ...gap } as PrioritizedSkillGap & MatchRecord;
  const explicitCount = extractSkillGapMatchCount(gap);
  const explicitPercent = extractSkillGapMatchPercent(gap);

  if (explicitCount !== null) {
    normalizedGap.appears_in_top_matches = explicitCount;
    normalizedGap.missing_count = explicitCount;
  }

  if (explicitPercent !== null) {
    normalizedGap.match_percentage = explicitPercent;
    normalizedGap.missing_percentage = explicitPercent;
    normalizedGap.skill_gap_percentage = explicitPercent;
    normalizedGap.affected_match_percentage = explicitPercent;
  }

  if (explicitCount === null && explicitPercent !== null && typeof totalMatchCount === 'number' && totalMatchCount > 0) {
    const derivedCount = Math.max(0, Math.round((explicitPercent / 100) * totalMatchCount));
    normalizedGap.appears_in_top_matches = derivedCount;
    normalizedGap.missing_count = derivedCount;
  }

  if (explicitPercent === null && explicitCount !== null && typeof totalMatchCount === 'number' && totalMatchCount > 0) {
    const derivedPercent = normalizePercentValue((explicitCount / totalMatchCount) * 100);
    if (derivedPercent !== null) {
      normalizedGap.match_percentage = derivedPercent;
      normalizedGap.missing_percentage = derivedPercent;
      normalizedGap.skill_gap_percentage = derivedPercent;
      normalizedGap.affected_match_percentage = derivedPercent;
    }
  }

  return normalizedGap;
}

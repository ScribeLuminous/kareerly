// The one place match thresholds live. The Candidates page, Home and Insights
// all read from here, so a tier means the same thing everywhere. The bands
// follow the thesis manuscript (Table 11): Top 90%+, Good 75-89%, Partial
// under 75%. An applicant with no recorded skill evidence has no band at all.

export const TOP_MATCH_PERCENT = 90;
export const GOOD_MATCH_PERCENT = 75;

/** "Strong" means Top or Good: at or above this share of a job's required skills. */
export const STRONG_MATCH_PERCENT = GOOD_MATCH_PERCENT;

/** Fewer assessed applicants than this is too few to call a skill gap a pattern. */
export const SMALL_SAMPLE_MAX = 5;
/** A skill gap turns to the accent colour when this share of a large enough sample lacks it. */
export const GAP_ALERT_SHARE_PERCENT = 60;

export type MatchTier = 'top' | 'good' | 'partial';
export type MatchLevel = MatchTier | 'none';

export const MATCH_LEVELS: Array<{ level: MatchLevel; label: string; range: string }> = [
  { level: 'top', label: 'Top', range: `${TOP_MATCH_PERCENT}% or more` },
  { level: 'good', label: 'Good', range: `${GOOD_MATCH_PERCENT}–${TOP_MATCH_PERCENT - 1}%` },
  { level: 'partial', label: 'Partial', range: `under ${GOOD_MATCH_PERCENT}%` },
  { level: 'none', label: 'No evidence', range: 'no skill evidence yet' },
];

export const MATCH_LEVEL_LABEL: Record<MatchLevel, string> = { top: 'Top', good: 'Good', partial: 'Partial', none: 'No evidence' };

/** The band a match percentage falls in; null (no skill evidence) has none. */
export function getTier(score: number | null): MatchLevel {
  if (score === null || Number.isNaN(score)) return 'none';
  if (score >= TOP_MATCH_PERCENT) return 'top';
  if (score >= GOOD_MATCH_PERCENT) return 'good';
  return 'partial';
}

import { MATCH_LEVEL_LABEL, type MatchLevel } from '../matchTiers';

const TONE: Record<MatchLevel, string> = {
  top: 'k-badge k-badge-success',
  good: 'k-badge k-badge-info',
  partial: 'k-badge k-badge-outline',
  none: 'k-badge k-badge-outline',
};

/** The level in words plus the figure. With no skill evidence there is no figure, never 0%. */
export function MatchBadge({ level, avgMatch }: { level: MatchLevel; avgMatch: number | null }) {
  if (avgMatch === null) return <span className={`${TONE.none} italic`}>No evidence yet</span>;
  return <span className={TONE[level]}>{MATCH_LEVEL_LABEL[level]} · {avgMatch}%</span>;
}

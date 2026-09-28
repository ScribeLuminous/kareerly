import { MATCH_LEVEL_LABEL, type MatchLevel } from '../matchTiers';
import { LEVEL_FILL } from './levelFill';

const ORDER: MatchLevel[] = ['top', 'good', 'partial', 'none'];

export function LevelSwatch({ level }: { level: MatchLevel }) {
  return <span className="inline-block h-2.5 w-4 shrink-0 rounded-sm" style={LEVEL_FILL[level]} aria-hidden="true" />;
}

/** How a job's applicants split across match levels, with the same split in words underneath. */
export function TierBar({ counts, total, title }: { counts: Record<MatchLevel, number>; total: number; title: string }) {
  const present = ORDER.filter((level) => counts[level] > 0);
  const words = present.map((level) => `${counts[level]} ${MATCH_LEVEL_LABEL[level].toLowerCase()}`).join(' · ');
  return (
    <div>
      <p className="k-meta mb-1.5">Applicants by match level</p>
      <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full" role="img" aria-label={`${title}: ${words}`}>
        {present.map((level) => (
          <span key={level} className="h-full min-w-[4px]" style={{ ...LEVEL_FILL[level], width: `${(100 * counts[level]) / total}%` }} />
        ))}
      </div>
      <p className="k-secondary mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
        {present.map((level) => (
          <span key={level} className="inline-flex items-center gap-1.5"><LevelSwatch level={level} />{counts[level]} {MATCH_LEVEL_LABEL[level].toLowerCase()}</span>
        ))}
      </p>
    </div>
  );
}

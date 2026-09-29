import { useState } from 'react';
import type { SkillGap } from '../insightsModel';

const COLLAPSED_COUNT = 5;

/** A skill, how many applicants lack it, and one quiet bar. No colour carries meaning here. */
export function SkillGapList({ gaps }: { gaps: SkillGap[] }) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? gaps : gaps.slice(0, COLLAPSED_COUNT);
  return (
    <>
      <ul className="k-card grid grid-cols-[minmax(0,1fr)] gap-4">
        {shown.map((gap) => {
          const count = `${gap.missing} of ${gap.assessed} applicant${gap.assessed === 1 ? '' : 's'}`;
          return (
            <li key={gap.skill.toLowerCase()}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="k-label">{gap.skill}</span>
                <span className="k-meta k-num shrink-0">{count}</span>
              </div>
              <span className="k-meter mt-1.5" role="meter" aria-valuemin={0} aria-valuemax={gap.assessed} aria-valuenow={gap.missing} aria-label={`${gap.skill}: missing for ${count}`}>
                <span style={{ width: `${gap.share}%`, background: 'var(--forest-m)' }} />
              </span>
            </li>
          );
        })}
      </ul>
      {gaps.length > COLLAPSED_COUNT && (
        <button className="k-btn k-btn-ghost mt-2 min-h-[44px]" type="button" aria-expanded={showAll} onClick={() => setShowAll((value) => !value)}>
          {showAll ? 'Show fewer' : `Show all (${gaps.length})`}
        </button>
      )}
    </>
  );
}

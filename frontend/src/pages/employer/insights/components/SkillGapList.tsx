import { useState } from 'react';
import type { SkillGap } from '../insightsModel';

const COLLAPSED_COUNT = 5;

/** Skill on the left, how many applicants lack it on the right. */
export function SkillGapList({ gaps }: { gaps: SkillGap[] }) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? gaps : gaps.slice(0, COLLAPSED_COUNT);
  return (
    <>
      <ul className="k-card p-0">
        {shown.map((gap) => (
          <li key={gap.skill.toLowerCase()} className="flex min-h-[48px] items-center justify-between gap-4 border-b border-bdr px-4 py-2 last:border-b-0">
            <span className="k-label">{gap.skill}</span>
            <span className="k-num shrink-0 text-dark">
              {gap.missing}<span className="k-meta"> of {gap.assessed}</span>
            </span>
          </li>
        ))}
      </ul>
      {gaps.length > COLLAPSED_COUNT && (
        <button className="k-btn k-btn-ghost mt-2 min-h-[44px]" type="button" aria-expanded={showAll} onClick={() => setShowAll((value) => !value)}>
          {showAll ? 'Show fewer' : `Show all (${gaps.length})`}
        </button>
      )}
    </>
  );
}

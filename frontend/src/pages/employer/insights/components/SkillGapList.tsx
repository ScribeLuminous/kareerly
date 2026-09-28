import { useState } from 'react';
import type { SkillGap } from '../insightsModel';

const COLLAPSED_COUNT = 5;

/** Bars are neutral; the accent is only for a widespread gap in a sample big enough to trust. */
function GapItem({ gap }: { gap: SkillGap }) {
  const count = `${gap.missing} of ${gap.assessed} applicant${gap.assessed === 1 ? '' : 's'}`;
  return (
    <li>
      <div className="flex items-baseline justify-between gap-3">
        <span className="k-label">{gap.skill}</span>
        <span className="k-meta k-num shrink-0">{gap.alert && <span className="mr-2 font-semibold text-rust">Common gap</span>}{count}</span>
      </div>
      {gap.smallSample ? (
        <p className="k-meta mt-1">Small sample ({gap.assessed} applicant{gap.assessed === 1 ? '' : 's'})</p>
      ) : (
        <span className="k-meter mt-1.5" role="meter" aria-valuemin={0} aria-valuemax={gap.assessed} aria-valuenow={gap.missing} aria-label={`${gap.skill}: missing for ${count}`}>
          <span style={{ width: `${gap.share}%`, background: gap.alert ? 'var(--rust)' : 'var(--forest-m)' }} />
        </span>
      )}
      <details className="mt-1">
        <summary className="k-meta flex min-h-[32px] cursor-pointer items-center">Missing in {gap.jobTitles.length} job{gap.jobTitles.length === 1 ? '' : 's'}</summary>
        <p className="k-meta pb-1">{gap.jobTitles.join(' · ')}</p>
      </details>
    </li>
  );
}

export function SkillGapList({ gaps }: { gaps: SkillGap[] }) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? gaps : gaps.slice(0, COLLAPSED_COUNT);
  return (
    <>
      <ul className="k-card grid grid-cols-[minmax(0,1fr)] gap-4">
        {shown.map((gap) => <GapItem key={gap.skill.toLowerCase()} gap={gap} />)}
      </ul>
      {gaps.length > COLLAPSED_COUNT && (
        <button className="k-btn k-btn-ghost mt-2 min-h-[44px]" type="button" aria-expanded={showAll} onClick={() => setShowAll((value) => !value)}>
          {showAll ? 'Show fewer' : `Show all (${gaps.length})`}
        </button>
      )}
    </>
  );
}

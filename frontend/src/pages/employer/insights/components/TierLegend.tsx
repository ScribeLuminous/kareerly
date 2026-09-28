import { MATCH_LEVELS } from '../matchTiers';
import { LevelSwatch } from './TierBar';

/** One line of labelled pills; each level carries its range in text. */
export function TierLegend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5" aria-label="Match levels">
      {MATCH_LEVELS.map((item) => (
        <li key={item.level} className="k-meta inline-flex items-center gap-1.5">
          <LevelSwatch level={item.level} />
          <span><span className="font-semibold text-mid">{item.label}</span> {item.level === 'none' ? '' : item.range}</span>
        </li>
      ))}
    </ul>
  );
}

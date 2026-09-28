import type { CSSProperties } from 'react';
import type { MatchLevel } from '../matchTiers';

// Each level has its own fill and pattern, so no level is told apart by colour alone.
export const LEVEL_FILL: Record<MatchLevel, CSSProperties> = {
  top: { background: 'var(--forest)' },
  good: { background: 'var(--forest-m)' },
  partial: { background: 'repeating-linear-gradient(135deg, var(--forest-m) 0 2px, #fff 2px 5px)', boxShadow: 'inset 0 0 0 1px var(--forest-m)' },
  none: { background: 'repeating-linear-gradient(135deg, #b8ab9b 0 1px, #fff 1px 4px)', boxShadow: 'inset 0 0 0 1px #b8ab9b' },
};


import type { ReactNode } from 'react';
import { buttonClass } from './adminShared';

export function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'good' | 'warn' | 'bad' | 'neutral' }) {
  const tones = {
    good: 'border-green bg-green-l text-green',
    warn: 'border-amber bg-amber-l text-amber',
    bad: 'border-red bg-red-l text-red',
    neutral: 'border-bdr bg-bg text-mid',
  };
  return <span className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-bold ${tones[tone]}`}>{children}</span>;
}

export function PanelMessage({ children }: { children: ReactNode }) {
  return <div className="border-t border-bdr px-4 py-8 text-center text-sm text-soft-text">{children}</div>;
}

export function SearchBox({ value, onChange, onSubmit, placeholder }: { value: string; onChange: (value: string) => void; onSubmit: () => void; placeholder: string }) {
  return (
    <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
      <input
        className="w-full min-w-0 rounded-lg border border-bdr bg-card px-3 py-2 text-sm sm:w-72"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
      <button className="rounded-lg border border-bdr bg-card px-3 py-2 text-sm font-bold text-mid hover:border-rust hover:text-rust" type="submit">Search</button>
    </form>
  );
}

export function Pager({ offset, limit, hasMore, onPage }: { offset: number; limit: number; hasMore: boolean; onPage: (offset: number) => void }) {
  if (offset === 0 && !hasMore) return null;
  return (
    <div className="flex items-center justify-end gap-2 border-t border-bdr px-4 py-3 text-xs text-soft-text">
      <button className={buttonClass} type="button" disabled={offset === 0} onClick={() => onPage(Math.max(0, offset - limit))}>Previous</button>
      <span>Showing {offset + 1}-{offset + limit}</span>
      <button className={buttonClass} type="button" disabled={!hasMore} onClick={() => onPage(offset + limit)}>Next</button>
    </div>
  );
}

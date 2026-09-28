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

/** Light text filters above a table: plain labels with an underline on the active one. */
export function FilterTabs<T extends string>({ label, items, value, onChange }: {
  label: string;
  items: Array<{ id: T; label: string; count?: number }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1" role="group" aria-label={label}>
      {items.map((item) => {
        const active = value === item.id;
        return (
          <button
            key={item.id}
            className={`inline-flex items-center gap-1.5 border-b-2 py-1.5 text-sm font-semibold transition-colors ${active ? 'border-rust text-dark' : 'border-transparent text-soft-text hover:text-dark'}`}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(item.id)}
          >
            {item.label}
            {typeof item.count === 'number' && <span className={`text-xs ${active ? 'text-rust' : 'text-soft-text'}`}>{item.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** A compact labelled dropdown filter. */
export function FilterSelect<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs font-bold text-soft-text">
      <span className="whitespace-nowrap">{label}</span>
      <select
        className="rounded-lg border border-bdr bg-card px-2.5 py-2 text-sm font-semibold text-dark focus:border-rust focus:outline-none"
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
      >
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

/** Search input with a clear button; filters as the admin types. */
export function AdminSearch({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <div className="relative w-full sm:w-72">
      <svg className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-soft" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.8" />
        <path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      <input
        className="w-full rounded-lg border border-bdr bg-card py-2 pl-8 pr-8 text-sm focus:border-rust focus:outline-none"
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
      {value && (
        <button className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded px-1.5 text-base leading-none text-soft-text hover:text-dark" type="button" aria-label="Clear search" onClick={() => onChange('')}>
          ×
        </button>
      )}
    </div>
  );
}

/** Row of search and filters shown at the top of each admin table. */
export function AdminToolbar({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-bdr px-4 py-3">
      <div className="flex min-w-0 flex-wrap items-center gap-3">{children}</div>
      {aside && <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto">{aside}</div>}
    </div>
  );
}

export function SelectBox({ checked, indeterminate = false, onChange, label, disabled }: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <input
      ref={(node) => { if (node) node.indeterminate = indeterminate; }}
      className="h-4 w-4 cursor-pointer accent-rust disabled:cursor-not-allowed disabled:opacity-40"
      type="checkbox"
      checked={checked}
      disabled={disabled}
      aria-label={label}
      onChange={(event) => onChange(event.target.checked)}
    />
  );
}

/** Appears above a table while rows are selected and holds the bulk actions. */
export function BulkBar({ count, onClear, busy, children }: { count: number; onClear: () => void; busy?: boolean; children: ReactNode }) {
  if (count === 0) return null;
  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-t border-rust-m bg-rust-l px-4 py-2" role="region" aria-label="Bulk actions">
      <span className="mr-1 text-sm font-extrabold text-dark">{count} selected</span>
      <button className="text-xs font-bold text-soft-text underline-offset-2 hover:text-dark hover:underline" type="button" onClick={onClear} disabled={busy}>Clear</button>
      <span className="mx-1 hidden h-4 w-px bg-rust-m sm:inline-block" aria-hidden="true" />
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
      {busy && <span className="text-xs font-semibold text-soft-text">Working…</span>}
    </div>
  );
}

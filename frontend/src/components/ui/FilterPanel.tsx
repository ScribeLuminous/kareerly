import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faSliders, faXmark } from '@fortawesome/free-solid-svg-icons';

type FilterPanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeCount: number;
  onClear: () => void;
  title?: string;
  children: ReactNode;
};

/**
 * A "Filters" button whose options open as a bottom sheet on phones and a
 * popover from 640px. Filters apply as they change; Done closes the panel.
 */
export default function FilterPanel({ open, onOpenChange, activeCount, onClear, title = 'Filters', children }: FilterPanelProps) {
  const id = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(() => onOpenChange(false));
  useEffect(() => {
    closeRef.current = () => onOpenChange(false);
  });

  useEffect(() => {
    if (!open) return undefined;
    panelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeRef.current();
        buttonRef.current?.focus();
      }
    };
    const onPointer = (event: MouseEvent) => {
      if (anchorRef.current && !anchorRef.current.contains(event.target as Node)) closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
    };
  }, [open]);

  return (
    <div ref={anchorRef} className="k-popover-anchor">
      <button
        ref={buttonRef}
        className={`k-btn k-btn-secondary ${activeCount > 0 ? 'k-filter-active' : ''}`}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => onOpenChange(!open)}
      >
        <FontAwesomeIcon icon={faSliders} aria-hidden="true" />
        Filters
        {activeCount > 0 && <span className="k-count k-count-alert" aria-label={`${activeCount} active`}>{activeCount}</span>}
      </button>
      {open && (
        <>
          <div className="k-filter-backdrop" aria-hidden="true" onClick={() => onOpenChange(false)} />
          <div id={id} ref={panelRef} className="k-filter-panel" role="dialog" aria-modal="false" aria-label={title} tabIndex={-1}>
            <div className="k-filter-panel-head">
              <h2 className="k-section-title">{title}</h2>
              <button className="k-icon-btn" type="button" aria-label={`Close ${title.toLowerCase()}`} onClick={() => onOpenChange(false)}>
                <FontAwesomeIcon icon={faXmark} aria-hidden="true" />
              </button>
            </div>
            <div className="k-filter-panel-body">{children}</div>
            <div className="k-filter-panel-foot">
              <button className="k-btn k-btn-ghost" type="button" onClick={onClear} disabled={activeCount === 0}>Reset</button>
              <button className="k-btn k-btn-primary" type="button" onClick={() => { onOpenChange(false); buttonRef.current?.focus(); }}>Done</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** A labelled group of single-choice options inside the filter panel. */
export function FilterChoice<T extends string>({ legend, name, value, options, onChange }: {
  legend: string;
  name: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="k-filter-group">
      <legend className="k-label">{legend}</legend>
      <div className="k-chip-row mt-2">
        {options.map((option) => (
          <label key={option.value || 'all'} className="k-chip k-chip-radio">
            <input
              className="sr-only"
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

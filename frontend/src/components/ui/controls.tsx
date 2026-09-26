import { useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { faCircleInfo, faMagnifyingGlass, faXmark } from '@fortawesome/free-solid-svg-icons';
import { rovingKeyDown, useDismiss } from './hooks';

export type TabItem<T extends string> = { id: T; label: ReactNode; count?: number; alert?: boolean };

/** Underline tabs: navigation between closely related views. */
export function Tabs<T extends string>({ label, items, value, onChange, idPrefix }: {
  label: string;
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  idPrefix: string;
}) {
  const ids = items.map((item) => item.id);
  return (
    <div className="k-tabs" role="tablist" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.id}
          id={`${idPrefix}-tab-${item.id}`}
          className="k-tab"
          type="button"
          role="tab"
          aria-selected={value === item.id}
          aria-controls={`${idPrefix}-panel`}
          tabIndex={value === item.id ? 0 : -1}
          onClick={() => onChange(item.id)}
          onKeyDown={(event) => rovingKeyDown(event, ids, value, onChange, (id) => `${idPrefix}-tab-${id}`)}
        >
          {item.label}
          {typeof item.count === 'number' && <span className={`k-count ${item.alert ? 'k-count-alert' : ''}`}>{item.count}</span>}
        </button>
      ))}
    </div>
  );
}

export type SegmentOption<T extends string> = { value: T; label: ReactNode; count?: number };

/** Two or three mutually exclusive views of the same list. */
export function Segmented<T extends string>({ label, options, value, onChange }: {
  label: string;
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  const id = useId();
  const values = options.map((option) => option.value);
  return (
    <div className="k-seg" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          id={`${id}-${option.value}`}
          className="k-seg-btn"
          type="button"
          role="radio"
          aria-checked={value === option.value}
          tabIndex={value === option.value ? 0 : -1}
          onClick={() => onChange(option.value)}
          onKeyDown={(event) => rovingKeyDown(event, values, value, onChange, (v) => `${id}-${v}`)}
        >
          {option.label}
          {typeof option.count === 'number' && <span className="k-num">{option.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function SearchField({ value, onChange, label, placeholder }: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="k-search" role="search">
      <FontAwesomeIcon icon={faMagnifyingGlass} aria-hidden="true" />
      <input
        ref={inputRef}
        className="k-input"
        type="search"
        enterKeyHint="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder || label}
        aria-label={label}
      />
      {value && (
        <button
          className="k-icon-btn"
          type="button"
          aria-label="Clear search"
          onClick={() => {
            onChange('');
            inputRef.current?.focus();
          }}
        >
          <FontAwesomeIcon icon={faXmark} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/** An ⓘ button that reveals secondary explanation on tap or click. */
export function InfoTip({ label, children, align = 'right' }: { label: string; children: ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const id = useId();
  useDismiss(ref, open, () => setOpen(false));
  return (
    <span ref={ref} className="k-popover-anchor inline-flex align-middle">
      <button
        className="k-icon-btn k-infotip-btn"
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((current) => !current)}
      >
        <FontAwesomeIcon icon={faCircleInfo} aria-hidden="true" />
      </button>
      {open && (
        <span id={id} role="note" className="k-popover k-infotip-panel" style={align === 'left' ? { left: 0, right: 'auto' } : undefined}>
          {children}
        </span>
      )}
    </span>
  );
}

export type MenuItem = {
  label: string;
  icon?: IconDefinition;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Why the item is unavailable; read out and shown as a tooltip. */
  hint?: string;
};

/** An overflow (⋯) or account menu. */
export function Menu({ label, trigger, items, header, align = 'right' }: {
  label: string;
  trigger: ReactNode;
  items: MenuItem[];
  header?: ReactNode;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const id = useId();
  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };
  useDismiss(ref, open, () => setOpen(false));
  return (
    <div ref={ref} className="k-popover-anchor">
      <button
        ref={buttonRef}
        className="k-icon-btn"
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            setOpen(true);
            window.setTimeout(() => document.querySelector<HTMLElement>(`#${CSS.escape(id)} [role="menuitem"]:not(:disabled)`)?.focus(), 0);
          }
        }}
      >
        {trigger}
      </button>
      {open && (
        <div
          id={id}
          className="k-popover"
          role="menu"
          aria-label={label}
          style={align === 'left' ? { left: 0, right: 'auto' } : undefined}
          onKeyDown={(event) => {
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const list = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)'));
            const index = list.indexOf(document.activeElement as HTMLElement);
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? list.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length;
            list[next]?.focus();
          }}
        >
          {header}
          {items.map((item) => (
            <button
              key={item.label}
              className={`k-menu-item ${item.danger ? 'k-menu-item-danger' : ''}`}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              title={item.disabled ? item.hint : undefined}
              onClick={() => {
                close();
                item.onSelect();
              }}
            >
              {item.icon && <FontAwesomeIcon icon={item.icon} aria-hidden="true" />}
              <span className="min-w-0 flex-1">
                {item.label}
                {item.disabled && item.hint && <span className="k-meta block">{item.hint}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

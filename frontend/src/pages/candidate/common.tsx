import { useEffect, useRef, type ReactNode } from 'react';
import { UIIcon, type IconName } from './icons';
import type { ApplicationStatus } from './model';

export function NavItem({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: IconName; children: ReactNode }) {
  return (
    <button className={`cand-nav-item ${active ? 'active' : ''}`} type="button" onClick={onClick}>
      <UIIcon name={icon} className="cand-nav-icon" />
      <span>{children}</span>
    </button>
  );
}

export function FilterPanel({
  open,
  panelId,
  title,
  labelledBy,
  onClose,
  onApply,
  onClear,
  children,
}: {
  open: boolean;
  panelId: string;
  title: string;
  labelledBy: string;
  onClose: () => void;
  onApply: () => void;
  onClear: () => void;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <>
      <button className="cand-filter-backdrop" type="button" aria-label="Close filters" onClick={onClose} />
      <div id={panelId} ref={panelRef} className="cand-filter-panel" role="dialog" aria-modal="true" aria-labelledby={labelledBy} tabIndex={-1}>
        <div className="cand-filter-panel-header">
          <div>
            <div id={labelledBy} className="cand-filter-panel-title">{title}</div>
            <div className="cand-filter-panel-subtitle">Refine results with the filters below.</div>
          </div>
          <button className="cand-filter-close" type="button" aria-label={`Close ${title}`} onClick={onClose}>
            <UIIcon name="close" />
          </button>
        </div>
        <form onSubmit={(event) => { event.preventDefault(); onApply(); }}>
          <div className="cand-filter-panel-body">{children}</div>
          <div className="cand-filter-panel-actions">
            <button className="cand-filter-clear" type="button" onClick={onClear}>Clear all</button>
            <button className="cand-btn-primary cand-btn-sm" type="submit">Apply filters</button>
          </div>
        </form>
      </div>
    </>
  );
}

export function ActiveFilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button className="cand-active-filter-chip" type="button" onClick={onRemove} aria-label={`Remove ${label} filter`}>
      <span>{label}</span>
      <UIIcon name="close" className="cand-active-filter-chip-icon" />
    </button>
  );
}

export function StatusBadge({ status }: { status: ApplicationStatus }) {
  return <span className={`app-status-badge status-${status.toLowerCase()}`}>{status}</span>;
}

export function FormField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="cand-form-label">{label}</span>
      {children}
    </label>
  );
}

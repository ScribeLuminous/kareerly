import { useId, useRef, useState } from 'react';
import { faDownload } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useDismiss } from '../../../../components/ui';

export type ReportKind = 'pdf' | 'csv';
export type ReportScope = 'current' | 'all';

/** Report menu: choose the scope, then PDF or CSV. Icon-only on a phone. */
export function DownloadMenu({ busy, currentLabel, onDownload }: {
  busy: boolean;
  /** The active filter in words, e.g. "Open jobs". */
  currentLabel: string;
  onDownload: (kind: ReportKind, scope: ReportScope) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<ReportScope>('current');
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useDismiss(ref, open, () => setOpen(false));
  const run = async (kind: ReportKind) => {
    await onDownload(kind, scope);
    setOpen(false);
  };
  return (
    <div ref={ref} className="k-popover-anchor">
      <button
        className="k-btn k-btn-secondary min-h-[44px] min-w-[44px]"
        type="button"
        aria-label="Download report"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
        aria-busy={busy}
        disabled={busy}
        onClick={() => setOpen((value) => !value)}
      >
        <FontAwesomeIcon icon={faDownload} aria-hidden="true" />
        <span className="hidden sm:inline">{busy ? 'Preparing report…' : 'Download report'}</span>
      </button>
      {open && (
        <div id={id} className="k-popover w-[min(300px,calc(100vw-32px))]" role="dialog" aria-label="Download report">
          <fieldset className="px-2 pb-2 pt-1">
            <legend className="k-meta mb-1">Include</legend>
            {([['current', currentLabel], ['all', 'All jobs']] as Array<[ReportScope, string]>).map(([value, label]) => (
              <label key={value} className="flex min-h-[44px] cursor-pointer items-center gap-2 text-[14px] text-dark">
                <input type="radio" name={`${id}-scope`} value={value} checked={scope === value} onChange={() => setScope(value)} />
                {value === 'current' ? `Current filter (${label})` : label}
              </label>
            ))}
          </fieldset>
          <button className="k-menu-item" type="button" disabled={busy} onClick={() => void run('pdf')}>PDF summary</button>
          <button className="k-menu-item" type="button" disabled={busy} onClick={() => void run('csv')}>CSV data</button>
        </div>
      )}
    </div>
  );
}

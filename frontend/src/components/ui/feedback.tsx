import type { ReactNode } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { faCircleCheck, faCircleExclamation, faCircleInfo, faTriangleExclamation, faXmark } from '@fortawesome/free-solid-svg-icons';

type Tone = 'info' | 'warn' | 'error' | 'success';

const toneIcon: Record<Tone, IconDefinition> = {
  info: faCircleInfo,
  warn: faTriangleExclamation,
  error: faCircleExclamation,
  success: faCircleCheck,
};

/** One-line status message with an optional action. */
export function Banner({ tone = 'info', children, actions, onDismiss, className = '' }: {
  tone?: Tone;
  children: ReactNode;
  actions?: ReactNode;
  onDismiss?: () => void;
  className?: string;
}) {
  return (
    <div className={`k-banner k-banner-${tone} ${className}`} role={tone === 'error' ? 'alert' : 'status'}>
      <FontAwesomeIcon icon={toneIcon[tone]} aria-hidden="true" />
      <div className="k-banner-body">
        <div>{children}</div>
        {actions && <div className="k-banner-actions">{actions}</div>}
      </div>
      {onDismiss && (
        <button className="k-icon-btn" type="button" onClick={onDismiss} aria-label="Dismiss">
          <FontAwesomeIcon icon={faXmark} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/** What is missing and what to do next: one sentence and one action. */
export function EmptyState({ icon, title, text, actions, className = '' }: {
  icon?: IconDefinition;
  title: string;
  text?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`k-empty ${className}`}>
      {icon && <FontAwesomeIcon icon={icon} aria-hidden="true" />}
      <p className="k-empty-title">{title}</p>
      {text && <p className="k-empty-text">{text}</p>}
      {actions && <div className="k-button-row">{actions}</div>}
    </div>
  );
}

/** Placeholder rows shaped like the list they stand in for. */
export function SkeletonRows({ count = 3, label = 'Loading' }: { count?: number; label?: string }) {
  return (
    <div className="k-list" role="status" aria-label={label} aria-busy="true">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="k-row" aria-hidden="true">
          <div className="k-row-main">
            <div className="k-skel h-4 w-3/5" />
            <div className="k-skel mt-2 h-3 w-2/5" />
          </div>
          <div className="k-skel h-6 w-12" />
        </div>
      ))}
    </div>
  );
}

export type ToastState = { message: string; type: '' | 'success' | 'warn' | 'danger'; action?: { label: string; onClick: () => void } } | null;

/** Always-mounted live region so screen readers announce each toast. */
export function ToastRegion({ toast, onClose }: { toast: ToastState; onClose: () => void }) {
  return (
    <div role="status" aria-live="polite">
      {toast && (
        <div className={`k-toast ${toast.type === 'danger' ? 'k-toast-danger' : toast.type === 'warn' ? 'k-toast-warn' : ''}`}>
          <span>{toast.message}</span>
          {toast.action && (
            <button
              className="k-link"
              type="button"
              onClick={() => {
                toast.action?.onClick();
                onClose();
              }}
            >
              {toast.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

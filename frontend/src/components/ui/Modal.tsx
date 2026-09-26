import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowLeft, faXmark } from '@fortawesome/free-solid-svg-icons';

// Open dialogs, most recent last: only the top one reacts to Escape and Tab.
const openDialogs: string[] = [];

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type ModalProps = {
  title: ReactNode;
  /** Short line under the title, only when it adds something the title cannot. */
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'md' | 'lg';
  /** Full screen on phones (long forms and detail views); a bottom sheet otherwise. */
  fullOnMobile?: boolean;
  /** Show a back arrow instead of ✕ (detail views opened from a list). */
  closeStyle?: 'close' | 'back';
  closeLabel?: string;
  headerActions?: ReactNode;
  role?: 'dialog' | 'alertdialog';
};

export default function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  size = 'md',
  fullOnMobile = false,
  closeStyle = 'close',
  closeLabel,
  headerActions,
  role = 'dialog',
}: ModalProps) {
  const id = useId();
  const titleId = `${id}-title`;
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    openDialogs.push(id);
    const panel = panelRef.current;
    (panel?.querySelector<HTMLElement>('[data-autofocus]') || panel)?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (openDialogs[openDialogs.length - 1] !== id || !panel) return;
      if (event.key === 'Escape') {
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((item) => item.offsetParent !== null);
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      const index = openDialogs.indexOf(id);
      if (index >= 0) openDialogs.splice(index, 1);
      if (openDialogs.length === 0) document.body.style.overflow = overflow;
      if (previous && document.contains(previous)) previous.focus();
    };
  }, [id]);

  return (
    <div
      className="k-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={`k-modal ${size === 'lg' ? 'k-modal-lg' : ''} ${fullOnMobile ? 'k-modal-full' : ''}`}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="k-modal-header">
          {closeStyle === 'back' && (
            <button className="k-icon-btn" type="button" onClick={onClose} aria-label={closeLabel || 'Back'}>
              <FontAwesomeIcon icon={faArrowLeft} aria-hidden="true" />
            </button>
          )}
          <div className="k-modal-header-main">
            <h2 id={titleId} className="k-modal-title">{title}</h2>
            {subtitle && <div className="k-secondary mt-0.5">{subtitle}</div>}
          </div>
          {headerActions}
          {closeStyle === 'close' && (
            <button className="k-icon-btn" type="button" onClick={onClose} aria-label={closeLabel || 'Close'}>
              <FontAwesomeIcon icon={faXmark} aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="k-modal-body">{children}</div>
        {footer && <div className="k-modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

type ConfirmDialogProps = {
  title: string;
  message?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  /** Keeps the action off until the dialog's own fields are complete. */
  confirmDisabled?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
  children?: ReactNode;
};

/** A short confirmation: one sentence, Cancel, and the action named on the button. */
export function ConfirmDialog({ title, message, confirmLabel, cancelLabel = 'Cancel', danger = false, busy = false, confirmDisabled = false, onConfirm, onCancel, children }: ConfirmDialogProps) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      role="alertdialog"
      footer={(
        <>
          <button className="k-btn k-btn-ghost" type="button" onClick={onCancel} disabled={busy} data-autofocus={danger ? true : undefined}>{cancelLabel}</button>
          <button className={`k-btn ${danger ? 'k-btn-danger' : 'k-btn-primary'}`} type="button" onClick={() => void onConfirm()} disabled={busy || confirmDisabled} data-autofocus={danger ? undefined : true}>
            {confirmLabel}
          </button>
        </>
      )}
    >
      {message && <p className="k-secondary">{message}</p>}
      {children}
    </Modal>
  );
}

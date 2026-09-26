import type { ReactNode } from 'react';
import { applicationBadgeClass, type ApplicationStatus } from './model';

/** Title and the page's own actions; no subtitle unless it adds something. */
export function PageHeader({ title, actions, children }: { title: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="k-page-header">
      <div>
        <h1 className="k-page-title">{title}</h1>
        {children}
      </div>
      {actions && <div className="k-button-row">{actions}</div>}
    </div>
  );
}

export function FormField({ label, children, help, className = '' }: { label: string; children: ReactNode; help?: ReactNode; className?: string }) {
  return (
    <label className={`k-field block ${className}`}>
      <span className="k-label">{label}</span>
      {children}
      {help && <span className="k-help block">{help}</span>}
    </label>
  );
}

export function StatusBadge({ status }: { status: ApplicationStatus }) {
  return <span className={applicationBadgeClass(status)}>{status}</span>;
}

/** A section heading with an optional trailing link. */
export function SectionHead({ title, count, action, id }: { title: string; count?: number; action?: ReactNode; id?: string }) {
  return (
    <div className="k-section-head">
      <h2 id={id} className="k-section-title">
        {title}
        {typeof count === 'number' && <span className="k-meta ml-2 align-middle">{count}</span>}
      </h2>
      {action}
    </div>
  );
}

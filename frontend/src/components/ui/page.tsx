import { cloneElement, isValidElement, useId, type ReactNode } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowRight, faChevronRight } from '@fortawesome/free-solid-svg-icons';

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

/**
 * A labelled control. A single input, select or textarea child is linked with
 * htmlFor/id so its accessible name is just the label (a wrapping label would
 * also read out a select's current option).
 */
export function FormField({ label, children, help, className = '' }: { label: string; children: ReactNode; help?: ReactNode; className?: string }) {
  const autoId = useId();
  if (isValidElement<{ id?: string; 'aria-describedby'?: string }>(children)) {
    const id = children.props.id || `field-${autoId}`;
    const helpId = help ? `${id}-help` : undefined;
    const describedBy = [children.props['aria-describedby'], helpId].filter(Boolean).join(' ') || undefined;
    return (
      <div className={`k-field ${className}`}>
        <label className="k-label block" htmlFor={id}>{label}</label>
        {cloneElement(children, { id, 'aria-describedby': describedBy })}
        {help && <span id={helpId} className="k-help block">{help}</span>}
      </div>
    );
  }
  return (
    <label className={`k-field block ${className}`}>
      <span className="k-label">{label}</span>
      {children}
      {help && <span className="k-help block">{help}</span>}
    </label>
  );
}

/** A section heading with an optional count and trailing link. */
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

export function SeeAllLink({ label = 'See all', onClick }: { label?: string; onClick: () => void }) {
  return (
    <button className="k-link" type="button" onClick={onClick}>
      {label}<FontAwesomeIcon icon={faArrowRight} aria-hidden="true" />
    </button>
  );
}

export type NextStep = { id: string; title: string; detail?: string; actionLabel: string; onAction: () => void };

/** The single most useful action on a Home page, with the rest one tap away. */
export function NextStepCard({ steps }: { steps: NextStep[] }) {
  const [primary, ...more] = steps;
  if (!primary) return null;
  return (
    <section className="k-card border-l-4 border-l-rust" aria-labelledby="next-step-title">
      <p className="k-eyebrow">Next step</p>
      <h2 id="next-step-title" className="k-section-title mt-1">{primary.title}</h2>
      {primary.detail && <p className="k-secondary mt-1">{primary.detail}</p>}
      <div className="mt-4">
        <button className="k-btn k-btn-primary" type="button" onClick={primary.onAction}>{primary.actionLabel}</button>
      </div>
      {more.length > 0 && (
        <details className="mt-4 border-t border-bdr pt-3">
          <summary className="k-link cursor-pointer">{more.length} more step{more.length === 1 ? '' : 's'}</summary>
          <ul className="mt-2">
            {more.map((step) => (
              <li key={step.id}>
                <button className="k-row -mx-4 w-[calc(100%+2rem)] rounded-none px-4" type="button" onClick={step.onAction}>
                  <span className="k-row-main">
                    <span className="k-label block">{step.title}</span>
                    {step.detail && <span className="k-meta mt-0.5 block">{step.detail}</span>}
                  </span>
                  <FontAwesomeIcon className="k-row-chevron" icon={faChevronRight} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

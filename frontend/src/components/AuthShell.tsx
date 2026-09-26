import { useState, type ReactNode } from 'react';
import { faCheck, faEye, faEyeSlash } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import Logo from './Logo';

type AuthShellProps = {
  title: string;
  subtitle?: string;
  /** Short audience label beside the logo, e.g. "Employer". */
  badge?: string;
  panelTitle: string;
  panelSubtitle?: string;
  panelItems: string[];
  /** A line under the card, e.g. "Already have an account? Log in". */
  footer?: ReactNode;
  children: ReactNode;
  onHome: () => void;
};

/**
 * Sign-in and sign-up frame. Phones get the form alone under a slim top bar;
 * desktop adds a short "why Kareerly" panel beside the card.
 */
export default function AuthShell({ title, subtitle, badge, panelTitle, panelSubtitle, panelItems, footer, children, onHome }: AuthShellProps) {
  const badgeEl = badge && <span className="k-badge k-badge-info">{badge}</span>;
  return (
    <main className="min-h-screen bg-bg text-dark">
      <header className="flex h-14 items-center gap-2 border-b border-bdr bg-card px-4 lg:hidden">
        <Logo size="module" onClick={onHome} />
        {badgeEl}
      </header>

      <div className="mx-auto grid w-full max-w-6xl lg:min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)] lg:items-center lg:gap-16 lg:px-10 lg:py-10">
        <aside className="hidden lg:block">
          <div className="flex items-center gap-3">
            <Logo size="auth" onClick={onHome} />
            {badgeEl}
          </div>
          <p className="mt-10 max-w-md font-display text-[32px] font-bold leading-10 tracking-[-0.5px] text-dark">{panelTitle}</p>
          {panelSubtitle && <p className="k-body mt-3 max-w-md text-mid">{panelSubtitle}</p>}
          <ul className="mt-6 space-y-3">
            {panelItems.map((item) => (
              <li key={item} className="k-body flex items-center gap-3 text-mid">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-forest-l text-[12px] text-forest">
                  <FontAwesomeIcon icon={faCheck} aria-hidden="true" />
                </span>
                {item}
              </li>
            ))}
          </ul>
        </aside>

        <section className="px-4 pb-10 pt-6 sm:px-6 sm:pt-10 lg:p-0">
          <div className="mx-auto w-full max-w-md sm:rounded-[var(--k-radius-card)] sm:border sm:border-bdr sm:bg-card sm:p-8">
            <h1 className="k-page-title">{title}</h1>
            {subtitle && <p className="k-secondary mt-1">{subtitle}</p>}
            <div className="mt-6">{children}</div>
          </div>
          {footer && <div className="k-secondary mx-auto mt-5 max-w-md text-center">{footer}</div>}
        </section>
      </div>
    </main>
  );
}

type PasswordInputProps = {
  id: string;
  name?: string;
  autoComplete: 'current-password' | 'new-password';
  value?: string;
  onChange?: (value: string) => void;
  describedBy?: string;
  minLength?: number;
  pattern?: string;
};

/** A password field with a show/hide toggle. */
export function PasswordInput({ id, name = 'password', autoComplete, value, onChange, describedBy, minLength, pattern }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input
        id={id}
        name={name}
        className="k-input pr-12"
        type={visible ? 'text' : 'password'}
        autoComplete={autoComplete}
        required
        minLength={minLength}
        pattern={pattern}
        value={value}
        onChange={onChange ? (event) => onChange(event.target.value) : undefined}
        aria-describedby={describedBy}
      />
      <button
        className="k-icon-btn absolute right-0.5 top-1/2 -translate-y-1/2"
        type="button"
        onClick={() => setVisible((current) => !current)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        aria-controls={id}
      >
        <FontAwesomeIcon icon={visible ? faEyeSlash : faEye} aria-hidden="true" />
      </button>
    </div>
  );
}

const PASSWORD_RULES: Array<{ label: string; test: (value: string) => boolean }> = [
  { label: '14 or more characters', test: (value) => value.length >= 14 },
  { label: 'An uppercase letter', test: (value) => /[A-Z]/.test(value) },
  { label: 'A number', test: (value) => /[0-9]/.test(value) },
  { label: 'A symbol', test: (value) => /[^A-Za-z0-9]/.test(value) },
];

/** Live checklist under a new password so the rule is never a surprise. */
export function PasswordRules({ id, value }: { id: string; value: string }) {
  return (
    <ul id={id} className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1" aria-label="Password needs">
      {PASSWORD_RULES.map((rule) => {
        const met = rule.test(value);
        return (
          <li key={rule.label} className={`flex items-center gap-1.5 text-[13px] leading-5 ${met ? 'text-forest' : 'text-soft-text'}`}>
            <FontAwesomeIcon icon={faCheck} className={met ? '' : 'opacity-30'} aria-hidden="true" />
            {rule.label}
            <span className="sr-only">{met ? '(done)' : '(needed)'}</span>
          </li>
        );
      })}
    </ul>
  );
}

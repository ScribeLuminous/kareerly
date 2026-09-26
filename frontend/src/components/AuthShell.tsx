import type { ReactNode } from 'react';
import { faCheck } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import Logo from './Logo';

type AuthShellProps = {
  title: string;
  subtitle: string;
  panelTitle: string;
  panelSubtitle: string;
  panelItems: string[];
  children: ReactNode;
  onHome: () => void;
};

export default function AuthShell({ title, subtitle, panelTitle, panelSubtitle, panelItems, children, onHome }: AuthShellProps) {
  return (
    <main className="min-h-screen bg-bg text-dark">
      <section className="mx-auto grid min-h-screen w-full max-w-6xl bg-card lg:grid-cols-[1fr_1fr]">
        <aside className="flex min-h-[260px] flex-col items-center justify-center bg-gradient-to-br from-rust-l via-bg to-forest-l px-6 py-5 text-center lg:px-8 lg:py-4">
          <div className="mb-4">
            <Logo size="auth" layout="stack" onClick={onHome} />
          </div>
          <h1 className="max-w-md font-display text-2xl font-extrabold leading-tight text-dark sm:text-3xl">{panelTitle}</h1>
          <p className="mt-2 max-w-md text-sm leading-snug text-mid">{panelSubtitle}</p>
          <div className="mt-4 space-y-1.5 text-left">
            {panelItems.map((item) => (
              <div key={item} className="flex items-center gap-3 text-sm font-medium leading-tight text-mid">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-card font-bold text-rust">
                  <FontAwesomeIcon icon={faCheck} aria-hidden="true" />
                </span>
                <span>{item}</span>
              </div>
            ))}
          </div>
        </aside>

        <section className="flex items-start justify-center px-5 py-5 sm:px-6 sm:py-6 lg:items-start lg:py-5">
          <div className="w-full max-w-md">
            <h2 className="font-display text-2xl font-extrabold leading-tight text-dark sm:text-3xl">{title}</h2>
            <p className="mt-2 text-base text-soft-text">{subtitle}</p>
            <div className="mt-4">{children}</div>
          </div>
        </section>
      </section>
    </main>
  );
}

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
        <aside className="flex flex-col items-center justify-center bg-gradient-to-br from-rust-l via-bg to-forest-l px-6 py-5 text-center lg:min-h-0 lg:px-8 lg:py-4">
          <div className="lg:mb-4">
            <Logo size="auth" layout="stack" onClick={onHome} />
          </div>
          <p className="hidden max-w-md font-display text-3xl font-extrabold leading-tight text-dark lg:block">{panelTitle}</p>
          <p className="mt-2 hidden max-w-md text-sm leading-snug text-mid lg:block">{panelSubtitle}</p>
          <div className="mt-4 hidden space-y-1.5 text-left lg:block">
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

        <section className="flex items-start justify-center px-4 py-6 sm:px-6 lg:items-center lg:py-10">
          <div className="w-full max-w-md">
            <h1 className="font-display text-2xl font-extrabold leading-tight text-dark sm:text-3xl">{title}</h1>
            <p className="mt-2 text-[15px] text-mid">{subtitle}</p>
            <div className="mt-4">{children}</div>
          </div>
        </section>
      </section>
    </main>
  );
}

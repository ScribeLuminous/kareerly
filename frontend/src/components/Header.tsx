import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import Logo from './Logo';

type HeaderProps = {
  onHome?: () => void;
  onLogin?: () => void;
  onSignUp?: () => void;
  rightContent?: ReactNode;
};

export default function Header({ onHome, onLogin = () => undefined, onSignUp = () => undefined, rightContent }: HeaderProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mobileMenuOpen) return;

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!mobileMenuRef.current?.contains(event.target as Node)) setMobileMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileMenuOpen(false);
    };

    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [mobileMenuOpen]);

  return (
    <header className="sticky top-0 z-30 bg-card border-b border-bdr">
      <div className="flex items-center justify-between h-16 px-5 sm:px-8">
        <Logo className="flex-shrink-0" size="header" onClick={onHome} />

        {rightContent ?? (
          <div className="relative ml-auto" ref={mobileMenuRef}>
            <div className="hidden items-center gap-3 sm:flex">
              <button
                type="button"
                onClick={onLogin}
                className="text-mid font-semibold hover:text-rust transition-colors duration-150"
              >
                Log in
              </button>
              <button
                type="button"
                onClick={onSignUp}
                className="bg-rust text-white text-sm font-semibold px-5 py-2.5 rounded-lg hover:opacity-90 transition-opacity duration-150"
              >
                Sign up free
              </button>
            </div>

            <button
              type="button"
              className="flex h-11 w-11 items-center justify-center rounded-lg border border-bdr bg-card text-dark transition-colors hover:border-rust hover:text-rust sm:hidden"
              aria-label="Open account menu"
              aria-expanded={mobileMenuOpen}
              aria-controls="mobile-account-menu"
              onClick={() => setMobileMenuOpen((open) => !open)}
            >
              <span className="sr-only">Account menu</span>
              <span aria-hidden="true" className="flex flex-col gap-1.5">
                <span className="block h-0.5 w-5 rounded bg-current" />
                <span className="block h-0.5 w-5 rounded bg-current" />
                <span className="block h-0.5 w-5 rounded bg-current" />
              </span>
            </button>

            {mobileMenuOpen && (
              <div
                id="mobile-account-menu"
                className="absolute right-0 top-[calc(100%+0.6rem)] z-50 w-48 rounded-xl border border-bdr bg-card p-2 shadow-[0_12px_30px_rgba(42,31,20,0.16)] sm:hidden"
              >
                <button
                  type="button"
                  className="w-full rounded-lg px-4 py-3 text-left text-sm font-bold text-dark transition-colors hover:bg-bg hover:text-rust"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    onLogin();
                  }}
                >
                  Log in
                </button>
                <button
                  type="button"
                  className="mt-1 w-full rounded-lg bg-rust px-4 py-3 text-left text-sm font-bold text-white transition-opacity hover:opacity-90"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    onSignUp();
                  }}
                >
                  Sign up free
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}

import type { ReactNode } from 'react';
import Logo from './Logo';

type HeaderProps = {
  onHome?: () => void;
  onLogin?: () => void;
  onSignUp?: () => void;
  rightContent?: ReactNode;
};

export default function Header({ onHome, onLogin = () => undefined, onSignUp = () => undefined, rightContent }: HeaderProps) {
  return (
    <header className="sticky top-0 z-30 bg-card border-b border-bdr">
      <div className="flex items-center justify-between h-16 px-5 sm:px-8">
        <Logo className="flex-shrink-0" size="header" onClick={onHome} />

        {rightContent ?? (
          <div className="ml-auto flex items-center gap-3">
            <button
              onClick={onLogin}
              className="hidden sm:block text-mid font-semibold hover:text-rust transition-colors duration-150"
            >
              Log in
            </button>
            <button
              onClick={onSignUp}
              className="bg-rust text-white text-sm font-semibold px-5 py-2.5 rounded-lg hover:opacity-90 transition-opacity duration-150"
            >
              Sign up free
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

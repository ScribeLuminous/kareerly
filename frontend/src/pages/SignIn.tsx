import AuthShell from '../components/AuthShell';
import { useState } from 'react';
import { getFriendlyAuthErrorMessage, signInWithEmail } from '../lib/auth';
import type { KareerlyUser } from '../lib/auth';

type SignInProps = {
  expectedRole?: 'candidate' | 'employer' | 'admin';
  onAuthenticated: (user: KareerlyUser) => void;
  onCreateAccount: () => void;
  onSwitchRole?: () => void;
  onResetPassword: () => void;
  onHome: () => void;
};

export default function SignIn({ expectedRole = 'candidate', onAuthenticated, onCreateAccount, onSwitchRole, onResetPassword, onHome }: SignInProps) {
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isEmployerLogin = expectedRole === 'employer';
  const isAdminLogin = expectedRole === 'admin';
  const emailInputId = isAdminLogin ? 'admin-login-email' : isEmployerLogin ? 'employer-login-email' : 'candidate-login-email';
  const passwordInputId = isAdminLogin ? 'admin-login-password' : isEmployerLogin ? 'employer-login-password' : 'candidate-login-password';

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') || '').trim().toLowerCase();
    const password = String(form.get('password') || '');

    setError(null);
    setIsSubmitting(true);

    try {
      const user = await signInWithEmail(email, password, expectedRole);
      onAuthenticated(user);
    } catch (error) {
      console.warn('Sign-in failed:', error);
      const message = getFriendlyAuthErrorMessage(error);
      setError(message.startsWith('Invalid email or password') ? `Invalid email or password for this ${isAdminLogin ? 'admin' : isEmployerLogin ? 'employer' : 'candidate'} account. Please check your details or reset your password.` : message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthShell
      title={isAdminLogin ? 'Admin login' : isEmployerLogin ? 'Employer login' : 'Candidate login'}
      subtitle={isAdminLogin ? 'Log in to monitor Kareerly operations' : isEmployerLogin ? 'Log in to manage jobs and applicants' : 'Log in to your account to continue'}
      panelTitle=" "
      panelSubtitle="Join thousands of Filipino job seekers and employers"
      panelItems={['AI-powered job matching', 'Identify skill gaps & learning paths', 'Upskilling recommendations that fits you', 'Fair hiring with skills-first focus']}
      onHome={onHome}
    >
      <form onSubmit={handleSubmit}>
        <label className="form-label" htmlFor={emailInputId}>Email address</label>
        <input
          id={emailInputId}
          name="email"
          className="input-base mb-3 border-2 bg-bg py-2.5 text-base outline-none focus:border-rust focus:bg-card"
          placeholder="email@email.com"
          required
          type="email"
          autoComplete="username"
        />

        <label className="form-label" htmlFor={passwordInputId}>Password</label>
        <input
          id={passwordInputId}
          name="password"
          className="input-base mb-3 border-2 bg-bg py-2.5 text-base outline-none focus:border-rust focus:bg-card"
          placeholder="••••••••"
          required
          type="password"
          autoComplete="current-password"
        />
        {error && <div className="mb-3 rounded-lg border border-red bg-red-l px-3 py-2 text-sm font-semibold text-red">{error}</div>}

        <div className="mb-4 flex items-center gap-3 text-sm text-mid">
          <input id="remember-me" className="h-5 w-5 cursor-pointer rounded accent-rust" type="checkbox" />
          <label className="cursor-pointer" htmlFor="remember-me">Remember me</label>
        </div>

        <button className="mb-4 w-full rounded-xl bg-rust px-5 py-3 text-base font-bold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60" type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Logging in...' : 'Log in'}
        </button>
      </form>

      <div className="text-center">
        <button className="text-sm text-soft hover:text-rust" type="button" onClick={onResetPassword}>Forgot your password?</button>
      </div>

      {onSwitchRole && (
        <div className="mt-3 text-center">
          <button className="text-sm font-semibold text-rust hover:underline" type="button" onClick={onSwitchRole}>
            {isEmployerLogin ? 'Log in as job seeker instead' : 'Log in as employer instead'}
          </button>
        </div>
      )}

      <div className="mt-4 border-t border-bdr pt-4 text-center text-sm text-mid">
        Don&apos;t have an account?{' '}
        <button className="font-bold text-rust hover:underline" type="button" onClick={onCreateAccount}>
          {isAdminLogin ? 'Go to sign up' : isEmployerLogin ? 'Create employer account' : 'Sign up free'}
        </button>
      </div>
    </AuthShell>
  );
}

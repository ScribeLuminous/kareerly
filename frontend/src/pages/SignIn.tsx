import AuthShell, { PasswordInput } from '../components/AuthShell';
import { useState } from 'react';
import { Banner } from '../components/ui';
import { getFriendlyAuthErrorMessage, isEmailNotConfirmedError, resendConfirmationEmail, signInWithEmail } from '../lib/auth';
import type { KareerlyUser } from '../lib/auth';

type SignInProps = {
  expectedRole?: 'candidate' | 'employer' | 'admin';
  onAuthenticated: (user: KareerlyUser) => void;
  onCreateAccount: () => void;
  onSwitchRole?: () => void;
  onResetPassword: () => void;
  onHome: () => void;
};

const COPY = {
  candidate: {
    title: 'Log in',
    subtitle: 'Pick up your matches, skills and applications.',
    badge: undefined,
    panelTitle: 'Jobs that fit the skills you have',
    panelItems: ['Matches scored on your real skills', 'The gaps worth closing, with free learning', 'Applications and messages in one place'],
    signUp: 'Create an account',
  },
  employer: {
    title: 'Log in',
    subtitle: 'Manage your jobs and applicants.',
    badge: 'Employer',
    panelTitle: 'Hire on skills, not guesswork',
    panelItems: ['Applicants ranked by skill match', 'Identity masked until you interview', 'Jobs, candidates and messages in one place'],
    signUp: 'Create an employer account',
  },
  admin: {
    title: 'Admin log in',
    subtitle: 'Monitor Kareerly operations.',
    badge: 'Admin',
    panelTitle: 'Kareerly operations',
    panelItems: ['Users and job posts', 'Match quality and reports', 'Moderation'],
    signUp: 'Go to sign up',
  },
} as const;

export default function SignIn({ expectedRole = 'candidate', onAuthenticated, onCreateAccount, onSwitchRole, onResetPassword, onHome }: SignInProps) {
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [unconfirmedEmail, setUnconfirmedEmail] = useState<string | null>(null);
  const [resendStatus, setResendStatus] = useState<string | null>(null);
  const copy = COPY[expectedRole];
  const emailInputId = `${expectedRole}-login-email`;
  const passwordInputId = `${expectedRole}-login-password`;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') || '').trim().toLowerCase();
    const password = String(form.get('password') || '');

    setError(null);
    setUnconfirmedEmail(null);
    setResendStatus(null);
    setIsSubmitting(true);

    try {
      const user = await signInWithEmail(email, password, expectedRole);
      onAuthenticated(user);
    } catch (error) {
      console.warn('Sign-in failed:', error);
      if (isEmailNotConfirmedError(error)) setUnconfirmedEmail(email);
      const message = getFriendlyAuthErrorMessage(error);
      setError(message.startsWith('Invalid email or password') ? `That email and password don't match a${expectedRole === 'admin' ? 'n admin' : expectedRole === 'employer' ? 'n employer' : ' candidate'} account. Check them or reset your password.` : message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthShell
      title={copy.title}
      subtitle={copy.subtitle}
      badge={copy.badge}
      panelTitle={copy.panelTitle}
      panelItems={[...copy.panelItems]}
      onHome={onHome}
      footer={(
        <>
          New to Kareerly?{' '}
          <button className="k-link" type="button" onClick={onCreateAccount}>{copy.signUp}</button>
        </>
      )}
    >
      <form onSubmit={handleSubmit}>
        {error && <div role="alert"><Banner tone="error" className="mb-4">{error}</Banner></div>}
        {unconfirmedEmail && (
          <p className="k-secondary mb-4">
            {resendStatus || (
              <button
                className="k-link"
                type="button"
                onClick={async () => {
                  try {
                    await resendConfirmationEmail(unconfirmedEmail);
                    setResendStatus(`Confirmation email sent to ${unconfirmedEmail}. Check your inbox and spam folder.`);
                  } catch (resendError) {
                    setResendStatus(getFriendlyAuthErrorMessage(resendError));
                  }
                }}
              >
                Resend confirmation email
              </button>
            )}
          </p>
        )}

        <div className="k-field">
          <label className="k-label block" htmlFor={emailInputId}>Email</label>
          <input id={emailInputId} name="email" className="k-input" required type="email" inputMode="email" autoComplete="username" />
        </div>

        <div className="k-field">
          <div className="flex items-baseline justify-between gap-3">
            <label className="k-label block" htmlFor={passwordInputId}>Password</label>
            <button className="k-link text-[13px]" type="button" onClick={onResetPassword}>Forgot password?</button>
          </div>
          <PasswordInput id={passwordInputId} autoComplete="current-password" />
        </div>

        <button className="k-btn k-btn-primary k-btn-block mt-6" type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Logging in…' : 'Log in'}
        </button>
      </form>

      {onSwitchRole && (
        <p className="k-secondary mt-5 border-t border-bdr pt-4 text-center">
          {expectedRole === 'employer' ? 'Looking for a job?' : 'Hiring?'}{' '}
          <button className="k-link" type="button" onClick={onSwitchRole}>
            {expectedRole === 'employer' ? 'Log in as a job seeker' : 'Log in as an employer'}
          </button>
        </p>
      )}
    </AuthShell>
  );
}

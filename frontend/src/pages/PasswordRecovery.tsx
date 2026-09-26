import AuthShell from '../components/AuthShell';
import { useState } from 'react';
import { requestPasswordReset } from '../lib/auth';

type PasswordRecoveryProps = {
  onBackToLogin: () => void;
  onHome: () => void;
};

export default function PasswordRecovery({ onBackToLogin, onHome }: PasswordRecoveryProps) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSent, setIsSent] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setError('Please enter your email address.');
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setError('Please enter a valid email address.');
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      await requestPasswordReset(normalizedEmail);
      setIsSent(true);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to send reset link.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthShell
      title="Reset your password"
      subtitle="We'll send you a link to reset your password"
      panelTitle="Password recovery"
      panelSubtitle="Don't worry, we'll help you get back into your account"
      panelItems={['Enter your email to receive reset link', 'Check your inbox for instructions', 'Create a new password']}
      onHome={onHome}
    >
      {!isSent ? (
        <>
          <form onSubmit={handleSubmit}>
            <label className="form-label" htmlFor="recovery-email">Email address</label>
            <input
              id="recovery-email"
              name="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="k-input mb-3"
              placeholder="email@email.com"
              required
              type="email"
            />

            {error && <div className="mb-4 rounded-lg border border-red bg-red-l px-3 py-2 text-sm font-semibold text-red">{error}</div>}

            <button
              className="k-btn k-btn-primary k-btn-block"
              type="submit"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Sending reset link...' : 'Send reset link'}
            </button>
          </form>

          <div className="mt-8 border-t border-bdr pt-6 text-center">
            <button className="font-bold text-rust hover:underline" type="button" onClick={onBackToLogin}>
              ← Back to login
            </button>
          </div>
        </>
      ) : (
        <div className="rounded-xl border border-forest-m bg-forest-l p-5">
          <div className="mb-2 text-sm font-bold text-forest">Reset link sent</div>
          <p className="text-sm text-mid">
            If an account exists for <span className="font-semibold text-dark">{email.trim()}</span>, a password reset link has been sent.
          </p>
          <button
            className="k-btn k-btn-primary k-btn-block mt-4"
            type="button"
            onClick={onBackToLogin}
          >
            Back to login
          </button>
          <button
            className="mt-3 w-full rounded-xl border border-bdr bg-bg px-5 py-3 text-base font-bold text-mid transition-all hover:border-rust hover:text-rust"
            type="button"
            onClick={() => {
              setIsSent(false);
              setError(null);
            }}
          >
            Send another link
          </button>
        </div>
      )}
    </AuthShell>
  );
}

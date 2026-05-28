import AuthShell from '../components/AuthShell';
import { useState } from 'react';

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

    await new Promise((resolve) => window.setTimeout(resolve, 900));

    setIsSubmitting(false);
    setIsSent(true);
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
              className="input-base mb-3 border-2 bg-bg py-4 text-base outline-none focus:border-rust focus:bg-card"
              placeholder="you@example.com"
              required
              type="email"
            />

            {error && <div className="mb-4 rounded-lg border border-red bg-red-l px-3 py-2 text-sm font-semibold text-red">{error}</div>}

            <button
              className="w-full rounded-xl bg-rust px-5 py-4 text-base font-bold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
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
            className="mt-4 w-full rounded-xl bg-rust px-5 py-3 text-base font-bold text-white transition-opacity hover:opacity-90"
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

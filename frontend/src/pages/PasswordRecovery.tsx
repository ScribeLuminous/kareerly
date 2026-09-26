import AuthShell from '../components/AuthShell';
import { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowLeft } from '@fortawesome/free-solid-svg-icons';
import { Banner } from '../components/ui';
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
      title={isSent ? 'Check your email' : 'Reset your password'}
      subtitle={isSent ? undefined : "Enter your account email and we'll send you a reset link."}
      panelTitle="Back into your account in a minute"
      panelItems={['Enter the email you signed up with', 'Open the link we send you', 'Choose a new password']}
      onHome={onHome}
      footer={(
        <button className="k-link" type="button" onClick={onBackToLogin}>
          <FontAwesomeIcon icon={faArrowLeft} aria-hidden="true" />Back to log in
        </button>
      )}
    >
      {!isSent ? (
        <form onSubmit={handleSubmit} noValidate>
          {error && <div role="alert"><Banner tone="error" className="mb-4">{error}</Banner></div>}
          <div className="k-field">
            <label className="k-label block" htmlFor="recovery-email">Email</label>
            <input
              id="recovery-email"
              name="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="k-input"
              required
              type="email"
              inputMode="email"
              autoComplete="email"
            />
          </div>
          <button className="k-btn k-btn-primary k-btn-block mt-6" type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Sending…' : 'Send reset link'}
          </button>
        </form>
      ) : (
        <div role="status">
          <Banner tone="success">
            If an account exists for <strong className="[overflow-wrap:anywhere]">{email.trim()}</strong>, a reset link is on its way.
          </Banner>
          <div className="mt-6 grid gap-2">
            <button className="k-btn k-btn-primary k-btn-block" type="button" onClick={onBackToLogin}>Back to log in</button>
            <button
              className="k-btn k-btn-ghost k-btn-block"
              type="button"
              onClick={() => {
                setIsSent(false);
                setError(null);
              }}
            >
              Send another link
            </button>
          </div>
        </div>
      )}
    </AuthShell>
  );
}

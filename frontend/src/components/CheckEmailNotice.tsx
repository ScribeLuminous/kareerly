import { useState } from 'react';
import { Banner } from './ui';
import { getFriendlyAuthErrorMessage, resendConfirmationEmail } from '../lib/auth';

/** Sends the sign-up confirmation link again and says where it went. */
export function ResendConfirmationButton({ email, className = '' }: { email: string; className?: string }) {
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);

  const handleResend = async () => {
    setStatus('sending');
    setError(null);
    try {
      await resendConfirmationEmail(email);
      setStatus('sent');
    } catch (resendError) {
      setError(getFriendlyAuthErrorMessage(resendError));
      setStatus('idle');
    }
  };

  if (status === 'sent') {
    return (
      <p className={`k-secondary ${className}`} role="status">
        A new confirmation link is on its way to <strong className="text-dark [overflow-wrap:anywhere]">{email}</strong>.
      </p>
    );
  }

  return (
    <div className={className}>
      <button className="k-link" type="button" onClick={handleResend} disabled={status === 'sending'}>
        {status === 'sending' ? 'Sending…' : 'Resend confirmation email'}
      </button>
      {error && <p className="k-secondary mt-2 text-rust" role="alert">{error}</p>}
    </div>
  );
}

/**
 * Shown right after sign-up while the account waits on its confirmation link,
 * so people verify now instead of finding out at their next log in.
 */
export default function CheckEmailNotice({ email, onSignIn }: { email: string; onSignIn: () => void }) {
  return (
    <div>
      <Banner tone="success">
        Account created. We sent a confirmation link to <strong className="[overflow-wrap:anywhere]">{email}</strong>.
      </Banner>

      <p className="k-body mt-5 font-semibold text-dark">Verify your email before you log in</p>
      <ol className="k-secondary mt-2 list-decimal space-y-2 pl-5">
        <li>Open the email from Kareerly. If it isn&apos;t in your inbox, check Spam or Promotions.</li>
        <li>Click the confirmation link to verify your email address.</li>
        <li>Log in with your email and password. Once verified, you won&apos;t need to do this again.</li>
      </ol>

      <button className="k-btn k-btn-primary k-btn-block mt-6" type="button" onClick={onSignIn}>
        Go to log in
      </button>

      <div className="k-secondary mt-5 border-t border-bdr pt-4 text-center">
        <p>Didn&apos;t get the email after a few minutes?</p>
        <ResendConfirmationButton email={email} className="mt-1" />
      </div>
    </div>
  );
}

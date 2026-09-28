import { useEffect, useState } from 'react';
import AuthShell, { PasswordInput, PasswordRules } from '../components/AuthShell';
import { Banner } from '../components/ui';
import { supabase } from '../lib/supabase';
import { STRONG_PASSWORD_PATTERN } from '../lib/passwordRules';
import { describeRecoveryError, type RecoveryLink } from '../lib/passwordRecoveryLink';

type ResetPasswordProps = {
  link: RecoveryLink;
  onRequestNewLink: () => void;
  onComplete: () => void;
  onHome: () => void;
};

type Stage = 'checking' | 'confirm' | 'ready' | 'invalid' | 'done';

const INVALID_LINK = 'This reset link is not valid or has expired. Request a new link below.';

export default function ResetPassword({ link, onRequestNewLink, onComplete, onHome }: ResetPasswordProps) {
  const [stage, setStage] = useState<Stage>(() => {
    if (link.kind === 'error') return 'invalid';
    if (link.kind === 'token') return 'confirm';
    return 'checking';
  });
  const [linkError, setLinkError] = useState<string | null>(link.kind === 'error' ? describeRecoveryError(link.code) : null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // The auth client signs the user in from the link on load; wait for it.
  useEffect(() => {
    if (stage !== 'checking') return;
    let isMounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!isMounted) return;
      if (data.session) {
        setStage('ready');
      } else {
        setLinkError(INVALID_LINK);
        setStage('invalid');
      }
    });
    return () => {
      isMounted = false;
    };
  }, [stage]);

  // A one-time token is only spent when the person clicks, so an email
  // scanner opening the link first cannot use it up.
  const verifyToken = async () => {
    if (link.kind !== 'token') return;
    setIsSubmitting(true);
    const { error: verifyError } = await supabase.auth.verifyOtp({ type: 'recovery', token_hash: link.tokenHash });
    setIsSubmitting(false);
    if (verifyError) {
      setLinkError(describeRecoveryError(/expired|invalid/i.test(verifyError.message) ? 'otp_expired' : 'invalid'));
      setStage('invalid');
      return;
    }
    setStage('ready');
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!new RegExp(STRONG_PASSWORD_PATTERN).test(password)) {
      setError('Your new password does not meet the rules below.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      setStage('done');
    } catch (updateError) {
      const message = updateError instanceof Error ? updateError.message : '';
      setError(/different from the old/i.test(message)
        ? 'Choose a password different from your current one.'
        : message || 'Unable to update your password.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const title = stage === 'done' ? 'Password updated' : stage === 'invalid' ? 'Reset link not valid' : 'Choose a new password';

  return (
    <AuthShell
      title={title}
      panelTitle="Back into your account in a minute"
      panelItems={['Enter the email you signed up with', 'Open the link we send you', 'Choose a new password']}
      onHome={onHome}
    >
      {stage === 'checking' && <p className="k-secondary" role="status">Checking your reset link…</p>}

      {stage === 'confirm' && (
        <div>
          <p className="k-secondary">Continue to set a new password for your account.</p>
          <button className="k-btn k-btn-primary k-btn-block mt-6" type="button" onClick={verifyToken} disabled={isSubmitting}>
            {isSubmitting ? 'Checking…' : 'Continue'}
          </button>
        </div>
      )}

      {stage === 'invalid' && (
        <div>
          <Banner tone="error">{linkError || INVALID_LINK}</Banner>
          <button className="k-btn k-btn-primary k-btn-block mt-6" type="button" onClick={onRequestNewLink}>
            Request a new link
          </button>
        </div>
      )}

      {stage === 'ready' && (
        <form onSubmit={handleSubmit} noValidate>
          {error && <Banner tone="error" className="mb-4">{error}</Banner>}
          <div className="k-field">
            <label className="k-label block" htmlFor="reset-password">New password</label>
            <PasswordInput
              id="reset-password"
              autoComplete="new-password"
              value={password}
              onChange={setPassword}
              minLength={14}
              pattern={STRONG_PASSWORD_PATTERN}
              describedBy="reset-password-rules"
            />
            <PasswordRules id="reset-password-rules" value={password} />
          </div>
          <div className="k-field mt-4">
            <label className="k-label block" htmlFor="reset-password-confirm">Confirm new password</label>
            <PasswordInput
              id="reset-password-confirm"
              name="confirm"
              autoComplete="new-password"
              value={confirm}
              onChange={setConfirm}
            />
          </div>
          <button className="k-btn k-btn-primary k-btn-block mt-6" type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Saving…' : 'Save new password'}
          </button>
        </form>
      )}

      {stage === 'done' && (
        <div>
          <Banner tone="success">Your password has been changed. You're signed in.</Banner>
          <button className="k-btn k-btn-primary k-btn-block mt-6" type="button" onClick={onComplete}>
            Continue to Kareerly
          </button>
        </div>
      )}
    </AuthShell>
  );
}

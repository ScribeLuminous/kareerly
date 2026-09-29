import AuthShell, { PasswordInput, PasswordRules } from '../components/AuthShell';
import { useState } from 'react';
import { Banner, FormField } from '../components/ui';
import { getFriendlySignUpErrorMessage, signUpCandidate } from '../lib/auth';
import type { KareerlyUser } from '../lib/auth';
import { STRONG_PASSWORD_PATTERN } from '../lib/passwordRules';

type SignUpProps = {
  onAuthenticated: (user: KareerlyUser) => void;
  onSignIn: () => void;
  onHome: () => void;
};

export default function SignUp({ onAuthenticated, onSignIn, onHome }: SignUpProps) {
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [password, setPassword] = useState('');

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const firstName = String(form.get('firstName') || '').trim();
    const lastName = String(form.get('lastName') || '').trim();
    const email = String(form.get('email') || '').trim().toLowerCase();
    const birthday = String(form.get('birthday') || '').trim();
    const password = String(form.get('password') || '');

    setError(null);
    setIsSubmitting(true);

    try {
      const user = await signUpCandidate({ firstName, lastName, email, password, birthday });
      onAuthenticated(user);
    } catch (error) {
      setError(getFriendlySignUpErrorMessage(error, 'Unable to create account.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthShell
      title="Create your account"
      subtitle="Free for job seekers."
      panelTitle="Jobs that fit the skills you have"
      panelSubtitle="Upload your resume once. Kareerly matches you to jobs, shows the gaps worth closing and tracks your applications."
      panelItems={['Matches scored on your real skills', 'Free learning for the skills you are missing', 'Apply and track in one place']}
      onHome={onHome}
      footer={(
        <>
          Already have an account?{' '}
          <button className="k-link" type="button" onClick={onSignIn}>Log in</button>
        </>
      )}
    >
      <form onSubmit={handleSubmit}>
        {error && <div role="alert"><Banner tone="error" className="mb-4">{error}</Banner></div>}

        <div className="k-form-grid">
          <FormField label="First name">
            <input id="signup-first-name" name="firstName" className="k-input" required type="text" autoComplete="given-name" />
          </FormField>
          <FormField label="Last name">
            <input id="signup-last-name" name="lastName" className="k-input" required type="text" autoComplete="family-name" />
          </FormField>
        </div>

        <FormField label="Email" className="mt-4">
          <input id="signup-email" name="email" className="k-input" required type="email" inputMode="email" autoComplete="email" />
        </FormField>

        <FormField label="Birthday" help="You need to be 18 or older.">
          <input id="signup-birthday" name="birthday" className="k-input" required type="date" autoComplete="bday" />
        </FormField>

        <div className="k-field">
          <label className="k-label block" htmlFor="signup-password">Password</label>
          <PasswordInput
            id="signup-password"
            autoComplete="new-password"
            value={password}
            onChange={setPassword}
            minLength={14}
            pattern={STRONG_PASSWORD_PATTERN}
            describedBy="signup-password-rules"
          />
          <PasswordRules id="signup-password-rules" value={password} />
        </div>

        <label className="k-secondary mt-5 flex cursor-pointer items-start gap-3">
          <input id="agree-terms" className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer rounded accent-rust" required type="checkbox" />
          <span>I agree to the <strong className="text-dark">Terms of Service</strong> and <strong className="text-dark">Privacy Policy</strong>.</span>
        </label>

        <button className="k-btn k-btn-primary k-btn-block mt-6" type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Creating account…' : 'Create account'}
        </button>
      </form>
    </AuthShell>
  );
}

import AuthShell, { PasswordInput, PasswordRules } from '../components/AuthShell';
import { useState } from 'react';
import CheckEmailNotice from '../components/CheckEmailNotice';
import { Banner, FormField } from '../components/ui';
import { getFriendlySignUpErrorMessage, signUpEmployer } from '../lib/auth';
import type { KareerlyUser } from '../lib/auth';
import { EMPLOYER_COMPANY_SIZES, EMPLOYER_INDUSTRIES } from '../lib/employerOptions';
import { STRONG_PASSWORD_PATTERN } from '../lib/passwordRules';

type EmployerSignUpProps = {
  onAuthenticated: (employer: KareerlyUser & { company: string }) => void;
  onSignIn: () => void;
  onHome: () => void;
};

export default function EmployerSignUp({ onAuthenticated, onSignIn, onHome }: EmployerSignUpProps) {
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [password, setPassword] = useState('');
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const company = String(form.get('company') || '').trim();
    const companySize = String(form.get('companySize') || '').trim();
    const industry = String(form.get('industry') || '').trim();
    const firstName = String(form.get('firstName') || '').trim();
    const lastName = String(form.get('lastName') || '').trim();
    const email = String(form.get('email') || '').trim().toLowerCase();
    const password = String(form.get('password') || '');

    setError(null);
    setIsSubmitting(true);

    try {
      const { user, needsEmailConfirmation } = await signUpEmployer({ company, companySize, industry, firstName, lastName, email, password });
      if (needsEmailConfirmation) {
        setPendingEmail(email);
        return;
      }
      onAuthenticated({ ...user, company: user.company || company });
    } catch (error) {
      setError(getFriendlySignUpErrorMessage(error, 'Unable to create employer account.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthShell
      title={pendingEmail ? 'Check your email' : 'Create an employer account'}
      subtitle={pendingEmail ? 'One more step before you can log in.' : 'Post jobs and review matched applicants.'}
      badge="Employer"
      panelTitle="Hire on skills, not guesswork"
      panelSubtitle="Kareerly scores every applicant against your required skills and keeps identity hidden until you choose to interview."
      panelItems={['Applicants ranked by skill match', 'Identity masked until Interviewing', 'Jobs, candidates and messages in one place']}
      onHome={onHome}
      footer={pendingEmail ? undefined : (
        <>
          Already have an account?{' '}
          <button className="k-link" type="button" onClick={onSignIn}>Log in</button>
        </>
      )}
    >
      {pendingEmail ? <CheckEmailNotice email={pendingEmail} onSignIn={onSignIn} /> : (
        <form onSubmit={handleSubmit}>
          {error && <div role="alert"><Banner tone="error" className="mb-4">{error}</Banner></div>}

          <FormField label="Company name">
            <input id="company-name" name="company" className="k-input" required type="text" autoComplete="organization" />
          </FormField>

          <div className="k-form-grid mt-4">
            <FormField label="Industry" help="Matches the skill areas candidates choose from.">
              <select id="industry" name="industry" className="k-select" required defaultValue="">
                <option value="" disabled>Select an industry</option>
                {EMPLOYER_INDUSTRIES.map((option) => <option key={option}>{option}</option>)}
              </select>
            </FormField>
            <FormField label="Company size">
              <select id="company-size" name="companySize" className="k-select" required defaultValue="">
                <option value="" disabled>Select a size</option>
                {EMPLOYER_COMPANY_SIZES.map((option) => <option key={option}>{option}</option>)}
              </select>
            </FormField>
            <FormField label="Your first name">
              <input id="employer-first-name" name="firstName" className="k-input" required type="text" autoComplete="given-name" />
            </FormField>
            <FormField label="Your last name">
              <input id="employer-last-name" name="lastName" className="k-input" required type="text" autoComplete="family-name" />
            </FormField>
          </div>

          <FormField label="Work email" className="mt-4">
            <input id="business-email" name="email" className="k-input" required type="email" inputMode="email" autoComplete="email" />
          </FormField>

          <div className="k-field">
            <label className="k-label block" htmlFor="employer-password">Password</label>
            <PasswordInput
              id="employer-password"
              autoComplete="new-password"
              value={password}
              onChange={setPassword}
              minLength={14}
              pattern={STRONG_PASSWORD_PATTERN}
              describedBy="employer-password-rules"
            />
            <PasswordRules id="employer-password-rules" value={password} />
          </div>

          <label className="k-secondary mt-5 flex cursor-pointer items-start gap-3">
            <input id="employer-terms" className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer rounded accent-rust" required type="checkbox" />
            <span>I agree to the <strong className="text-dark">Terms of Service</strong> and <strong className="text-dark">Privacy Policy</strong>.</span>
          </label>

          <button className="k-btn k-btn-primary k-btn-block mt-6" type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Creating account…' : 'Create employer account'}
          </button>
        </form>
      )}
    </AuthShell>
  );
}

import AuthShell from '../components/AuthShell';
import { useState } from 'react';
import { signUpCandidate } from '../lib/auth';
import type { KareerlyUser } from '../lib/auth';

type SignUpProps = {
  onAuthenticated: (user: KareerlyUser) => void;
  onSignIn: () => void;
  onHome: () => void;
};

export default function SignUp({ onAuthenticated, onSignIn, onHome }: SignUpProps) {
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

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
      setError(error instanceof Error ? error.message : 'Unable to create account.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthShell
      title="Create your account"
      subtitle="Join thousands of job seekers"
      panelTitle="Join as a Job Seeker"
      panelSubtitle="Create your account and upload your resume to get started"
      panelItems={['Find jobs matched to your skills', 'See skill gaps & learning paths', 'Apply with one click', 'Track your applications']}
      onHome={onHome}
    >
      <form onSubmit={handleSubmit}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="form-label" htmlFor="signup-first-name">First name</label>
            <input id="signup-first-name" name="firstName" className="input-base border-2 bg-bg py-2.5 text-base outline-none focus:border-rust focus:bg-card" placeholder="First Name" required type="text" />
          </div>
          <div>
            <label className="form-label" htmlFor="signup-last-name">Last name</label>
            <input id="signup-last-name" name="lastName" className="input-base border-2 bg-bg py-2.5 text-base outline-none focus:border-rust focus:bg-card" placeholder="Last Name" required type="text" />
          </div>
        </div>

        <label className="form-label mt-3" htmlFor="signup-email">Email address</label>
        <input id="signup-email" name="email" className="input-base border-2 bg-bg py-2.5 text-base outline-none focus:border-rust focus:bg-card" placeholder="email@email.com" required type="email" />

        <label className="form-label mt-3" htmlFor="signup-birthday">Birthday</label>
        <input id="signup-birthday" name="birthday" className="input-base border-2 bg-bg py-2.5 text-base outline-none focus:border-rust focus:bg-card" required type="date" />
        <div className="mt-1.5 text-sm text-soft">You must be at least 18 years old to create an account.</div>

        <label className="form-label mt-3" htmlFor="signup-password">Password</label>
        <input id="signup-password" name="password" className="input-base border-2 bg-bg py-2.5 text-base outline-none focus:border-rust focus:bg-card" placeholder="••••••••" required minLength={14} pattern="^(?=.*[A-Z])(?=.*[0-9])(?=.*[^A-Za-z0-9]).{14,}$" type="password" />
        <div className="mt-1.5 text-sm text-soft">● At least 14 characters, with uppercase, number, and special character</div>

        <div className="my-4 flex items-start gap-3 text-sm text-mid">
          <input id="agree-terms" className="mt-0.5 h-5 w-5 cursor-pointer rounded accent-rust" required type="checkbox" />
          <label className="cursor-pointer" htmlFor="agree-terms">
            I agree to the <span className="font-bold text-rust">Terms of Service</span> and <span className="font-bold text-rust">Privacy Policy</span>
          </label>
        </div>

        {error && <div className="mb-3 rounded-lg border border-red bg-red-l px-3 py-2 text-sm font-semibold text-red">{error}</div>}

        <button className="w-full rounded-xl bg-rust px-5 py-3 text-base font-bold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60" type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Creating account...' : 'Create account'}
        </button>
      </form>

      <div className="mt-4 text-center text-sm text-mid">
        Already have an account?{' '}
        <button className="font-bold text-rust hover:underline" type="button" onClick={onSignIn}>
          Log in
        </button>
      </div>
    </AuthShell>
  );
}

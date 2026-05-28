import AuthShell from '../components/AuthShell';
import { useState } from 'react';

type SignInProps = {
  onAuthenticated: (user: { name: string; email: string }) => void;
  onCreateAccount: () => void;
  onResetPassword: () => void;
  onHome: () => void;
};

export default function SignIn({ onAuthenticated, onCreateAccount, onResetPassword, onHome }: SignInProps) {
  const [error, setError] = useState<string | null>(null);
  const sampleAccounts = {
    candidate: { email: 'candidate@test.com', password: 'Password123' },
    employer: { email: 'employer@test.com', password: 'Password123' },
  } as const;

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') || '').trim().toLowerCase();
    const password = String(form.get('password') || '');
    const sampleEmail = Object.values(sampleAccounts).find((account) => account.email === email);

    // Frontend-only sample account validation for prototype testing.
    if (sampleEmail && password !== sampleEmail.password) {
      setError('Incorrect password for the sample account. Use Password123.');
      return;
    }

    setError(null);
    onAuthenticated({ name: email.split('@')[0] || 'Candidate', email });
  };

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Log in to your account to continue"
      panelTitle=" "
      panelSubtitle="Join thousands of Filipino job seekers and employers"
      panelItems={['AI-powered job matching', 'Identify skill gaps & learning paths', 'Upskilling recommendations that fits you', 'Fair hiring with skills-first focus']}
      onHome={onHome}
    >
      <form onSubmit={handleSubmit}>
        <label className="form-label" htmlFor="signin-email">Email address</label>
        <input id="signin-email" name="email" className="input-base mb-3 border-2 bg-bg py-2.5 text-base outline-none focus:border-rust focus:bg-card" placeholder="you@example.com" required type="email" />

        <label className="form-label" htmlFor="signin-password">Password</label>
        <input id="signin-password" name="password" className="input-base mb-3 border-2 bg-bg py-2.5 text-base outline-none focus:border-rust focus:bg-card" placeholder="••••••••" required type="password" />
        <div className="mb-3 space-y-1 rounded-lg bg-bg px-3 py-2 text-xs text-soft">
          <div>
            Candidate sample: <span className="font-bold text-mid">{sampleAccounts.candidate.email}</span> / <span className="font-bold text-mid">{sampleAccounts.candidate.password}</span>
          </div>
          <div>
            Employer sample: <span className="font-bold text-mid">{sampleAccounts.employer.email}</span> / <span className="font-bold text-mid">{sampleAccounts.employer.password}</span>
          </div>
        </div>

        {error && <div className="mb-3 rounded-lg border border-red bg-red-l px-3 py-2 text-sm font-semibold text-red">{error}</div>}

        <div className="mb-4 flex items-center gap-3 text-sm text-mid">
          <input id="remember-me" className="h-5 w-5 cursor-pointer rounded accent-rust" type="checkbox" />
          <label className="cursor-pointer" htmlFor="remember-me">Remember me</label>
        </div>

        <button className="mb-4 w-full rounded-xl bg-rust px-5 py-3 text-base font-bold text-white transition-opacity hover:opacity-90" type="submit">
          Log in
        </button>
      </form>

      <div className="text-center">
        <button className="text-sm text-soft hover:text-rust" type="button" onClick={onResetPassword}>Forgot your password?</button>
      </div>

      <div className="mt-4 border-t border-bdr pt-4 text-center text-sm text-mid">
        Don&apos;t have an account?{' '}
        <button className="font-bold text-rust hover:underline" type="button" onClick={onCreateAccount}>
          Sign up free
        </button>
      </div>
    </AuthShell>
  );
}

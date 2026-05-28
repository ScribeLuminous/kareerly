import AuthShell from '../components/AuthShell';

type SignUpProps = {
  onAuthenticated: (user: { name: string; email: string }) => void;
  onSignIn: () => void;
  onHome: () => void;
};

export default function SignUp({ onAuthenticated, onSignIn, onHome }: SignUpProps) {
  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const firstName = String(form.get('firstName') || '').trim();
    const lastName = String(form.get('lastName') || '').trim();
    const email = String(form.get('email') || '').trim().toLowerCase();
    onAuthenticated({ name: `${firstName} ${lastName}`.trim() || email.split('@')[0], email });
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
            <input id="signup-first-name" name="firstName" className="input-base border-2 bg-bg py-2.5 text-base outline-none focus:border-rust focus:bg-card" placeholder="John" required type="text" />
          </div>
          <div>
            <label className="form-label" htmlFor="signup-last-name">Last name</label>
            <input id="signup-last-name" name="lastName" className="input-base border-2 bg-bg py-2.5 text-base outline-none focus:border-rust focus:bg-card" placeholder="Doe" required type="text" />
          </div>
        </div>

        <label className="form-label mt-3" htmlFor="signup-email">Email address</label>
        <input id="signup-email" name="email" className="input-base border-2 bg-bg py-2.5 text-base outline-none focus:border-rust focus:bg-card" placeholder="you@example.com" required type="email" />

        <label className="form-label mt-3" htmlFor="signup-password">Password</label>
        <input id="signup-password" name="password" className="input-base border-2 bg-bg py-2.5 text-base outline-none focus:border-rust focus:bg-card" placeholder="••••••••" required minLength={8} type="password" />
        <div className="mt-1.5 text-sm text-soft">● At least 8 characters, with uppercase and numbers</div>

        <div className="my-4 flex items-start gap-3 text-sm text-mid">
          <input id="agree-terms" className="mt-0.5 h-5 w-5 cursor-pointer rounded accent-rust" required type="checkbox" />
          <label className="cursor-pointer" htmlFor="agree-terms">
            I agree to the <span className="font-bold text-rust">Terms of Service</span> and <span className="font-bold text-rust">Privacy Policy</span>
          </label>
        </div>

        <button className="w-full rounded-xl bg-rust px-5 py-3 text-base font-bold text-white transition-opacity hover:opacity-90" type="submit">
          Create account
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

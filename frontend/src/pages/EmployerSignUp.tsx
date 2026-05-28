import AuthShell from '../components/AuthShell';

type EmployerSignUpProps = {
  onAuthenticated: (employer: { name: string; email: string; company: string }) => void;
  onSignIn: () => void;
  onHome: () => void;
};

export default function EmployerSignUp({ onAuthenticated, onSignIn, onHome }: EmployerSignUpProps) {
  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const company = String(form.get('company') || '').trim();
    const firstName = String(form.get('firstName') || '').trim();
    const lastName = String(form.get('lastName') || '').trim();
    const email = String(form.get('email') || '').trim().toLowerCase();
    onAuthenticated({ name: `${firstName} ${lastName}`.trim() || email.split('@')[0], email, company });
  };

  return (
    <AuthShell
      title="Create employer account"
      subtitle="Hire the right talent faster"
      panelTitle="Join as an Employer"
      panelSubtitle="Post jobs and find the right talent with AI-powered matching"
      panelItems={['Smart candidate screening', 'Skill-based match ranking', 'Blind applicant review', 'Streamlined hiring pipeline']}
      onHome={onHome}
    >
      <form onSubmit={handleSubmit}>
        <label className="form-label" htmlFor="company-name">Company name</label>
        <input id="company-name" name="company" className="input-base border-2 bg-bg py-2.5 text-base outline-none focus:border-rust focus:bg-card" placeholder="TechCorp Philippines" required type="text" />

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="form-label" htmlFor="employer-first-name">First name</label>
            <input id="employer-first-name" name="firstName" className="input-base border-2 bg-bg py-2.5 text-base outline-none focus:border-rust focus:bg-card" placeholder="John" required type="text" />
          </div>
          <div>
            <label className="form-label" htmlFor="employer-last-name">Last name</label>
            <input id="employer-last-name" name="lastName" className="input-base border-2 bg-bg py-2.5 text-base outline-none focus:border-rust focus:bg-card" placeholder="Doe" required type="text" />
          </div>
        </div>

        <label className="form-label mt-3" htmlFor="business-email">Business email</label>
        <input id="business-email" name="email" className="input-base border-2 bg-bg py-2.5 text-base outline-none focus:border-rust focus:bg-card" placeholder="hr@company.com" required type="email" />

        <label className="form-label mt-3" htmlFor="company-size">Company size</label>
        <select id="company-size" name="companySize" className="input-base border-2 bg-bg py-2.5 text-base outline-none focus:border-rust focus:bg-card" required defaultValue="">
          <option value="" disabled>Select company size</option>
          <option>1-10 employees</option>
          <option>11-50 employees</option>
          <option>51-200 employees</option>
          <option>201+ employees</option>
        </select>

        <label className="form-label mt-3" htmlFor="industry">Industry</label>
        <select id="industry" name="industry" className="input-base border-2 bg-bg py-2.5 text-base outline-none focus:border-rust focus:bg-card" required defaultValue="">
          <option value="" disabled>Select industry</option>
          <option>Technology & Software</option>
          <option>BPO & Customer Service</option>
          <option>Finance & Banking</option>
          <option>Healthcare</option>
        </select>

        <label className="form-label mt-3" htmlFor="employer-password">Password</label>
        <input id="employer-password" name="password" className="input-base border-2 bg-bg py-2.5 text-base outline-none focus:border-rust focus:bg-card" placeholder="••••••••" required minLength={8} type="password" />
        <div className="mt-1.5 text-sm text-soft">● At least 8 characters, with uppercase and numbers</div>

        <div className="my-4 flex items-start gap-3 text-sm text-mid">
          <input id="employer-terms" className="mt-0.5 h-5 w-5 cursor-pointer rounded accent-rust" required type="checkbox" />
          <label className="cursor-pointer" htmlFor="employer-terms">
            I agree to the <span className="font-bold text-rust">Terms of Service</span> and <span className="font-bold text-rust">Privacy Policy</span>
          </label>
        </div>

        <button className="w-full rounded-xl bg-rust px-5 py-3 text-base font-bold text-white transition-opacity hover:opacity-90" type="submit">
          Create employer account
        </button>
      </form>

      <div className="mt-5 text-center text-sm text-mid">
        Already have an account?{' '}
        <button className="font-bold text-rust hover:underline" type="button" onClick={onSignIn}>
          Log in
        </button>
      </div>
    </AuthShell>
  );
}

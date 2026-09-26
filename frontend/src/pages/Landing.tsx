import Header from '../components/Header';

type LandingProps = {
  onHome: () => void;
  onCandidateStart: () => void;
  onEmployerStart: () => void;
  onLogin: () => void;
  onSignUp: () => void;
  onAdminLogin: () => void;
};

export default function Landing({ onHome, onCandidateStart, onEmployerStart, onLogin, onSignUp, onAdminLogin }: LandingProps) {
  return (
    <div className="min-h-screen bg-bg text-dark">
      <Header onHome={onHome} onLogin={onLogin} onSignUp={onSignUp} />

      <main className="flex min-h-[calc(100vh-64px)] items-center justify-center px-5 py-6 lg:py-4">
        <section className="w-full max-w-5xl">
          <div className="mb-7 text-center lg:mb-5">
            <div className="mb-3 inline-flex items-center rounded-full bg-forest-l px-3.5 py-1 text-xs font-bold text-forest">
              Made for Filipino job seekers and employers
            </div>
            <h1 className="font-display text-4xl font-extrabold leading-tight text-dark sm:text-5xl">
              Find the job that <span className="text-rust">fits you</span>
            </h1>
            <p className="mx-auto mt-2 max-w-2xl text-sm leading-normal text-mid sm:text-base">
              Choose your path to get started with skill-first matching, learning recommendations, and hiring tools.
            </p>
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <button
              type="button"
              onClick={onCandidateStart}
              className="group rounded-2xl border-2 border-bdr bg-card p-5 text-left transition-all hover:-translate-y-1 hover:border-rust-m hover:shadow-[0_12px_30px_rgba(196,83,26,0.12)] sm:p-6"
            >
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-rust-l text-2xl">👤</div>
              <h2 className="font-display text-2xl font-extrabold text-dark">Job Seeker</h2>
              <p className="mt-2 text-sm leading-normal text-mid">
                Upload your resume, review your skills, and discover roles that fit your strengths.
              </p>
              <div className="my-4 rounded-xl bg-bg p-3">
                {['Resume analysis', 'Skill gap report', 'Fit-now and aspiration matches', 'Learning recommendations'].map((item) => (
                  <div key={item} className="mb-1.5 flex items-center gap-2 text-sm leading-tight text-mid last:mb-0">
                    <span className="font-bold text-green">✓</span>
                    <span>{item}</span>
                  </div>
                ))}
              </div>
              <span className="block rounded-xl bg-rust px-5 py-2.5 text-center text-sm font-bold text-white transition-opacity group-hover:opacity-90">
                Get Started as Job Seeker
              </span>
            </button>

            <button
              type="button"
              onClick={onEmployerStart}
              className="group rounded-2xl border-2 border-bdr bg-card p-5 text-left transition-all hover:-translate-y-1 hover:border-forest-m hover:shadow-[0_12px_30px_rgba(45,74,62,0.12)] sm:p-6"
            >
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-forest-l text-2xl">🏢</div>
              <h2 className="font-display text-2xl font-extrabold text-dark">Employer</h2>
              <p className="mt-2 text-sm leading-normal text-mid">
                Register your company and prepare to screen applicants with skills-first matching.
              </p>
              <div className="my-4 rounded-xl bg-bg p-3">
                {['Smart candidate screening', 'Skill-based match ranking', 'Blind applicant review', 'Hiring pipeline tools'].map((item) => (
                  <div key={item} className="mb-1.5 flex items-center gap-2 text-sm leading-tight text-mid last:mb-0">
                    <span className="font-bold text-green">✓</span>
                    <span>{item}</span>
                  </div>
                ))}
              </div>
              <span className="block rounded-xl bg-rust px-5 py-2.5 text-center text-sm font-bold text-white transition-colors group-hover:bg-forest">
                Get Started as Employer
              </span>
            </button>
          </div>

          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={onAdminLogin}
              className="text-xs font-semibold text-mid underline-offset-2 transition-colors hover:text-forest hover:underline"
            >
              Administrator sign in
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}

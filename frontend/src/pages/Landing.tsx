import Header from '../components/Header';

type LandingProps = {
  onHome: () => void;
  onCandidateStart: () => void;
  onEmployerStart: () => void;
  onLogin: () => void;
  onSignUp: () => void;
};

export default function Landing({ onHome, onCandidateStart, onEmployerStart, onLogin, onSignUp }: LandingProps) {
  return (
    <div className="min-h-screen bg-bg text-dark">
      <Header onHome={onHome} onLogin={onLogin} onSignUp={onSignUp} />

      <main className="flex min-h-[calc(100vh-64px)] items-center justify-center px-5 py-12">
        <section className="w-full max-w-5xl">
          <div className="mb-12 text-center">
            <div className="mb-6 inline-flex items-center rounded-full bg-forest-l px-3.5 py-1.5 text-xs font-bold text-forest">
              Made for Filipino job seekers and employers
            </div>
            <h1 className="font-display text-4xl font-extrabold leading-tight text-dark sm:text-5xl">
              Find the job that <span className="text-rust">fits you</span>
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-mid">
              Choose your path to get started with skill-first matching, learning recommendations, and hiring tools.
            </p>
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <button
              type="button"
              onClick={onCandidateStart}
              className="group rounded-2xl border-2 border-bdr bg-card p-8 text-left transition-all hover:-translate-y-1 hover:border-rust-m hover:shadow-[0_12px_30px_rgba(196,83,26,0.12)]"
            >
              <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-rust-l text-2xl">👤</div>
              <h2 className="font-display text-2xl font-extrabold text-dark">Job Seeker</h2>
              <p className="mt-3 text-sm leading-relaxed text-mid">
                Upload your resume, review your skills, and discover roles that fit your strengths.
              </p>
              <div className="my-6 rounded-xl bg-bg p-4">
                {['Resume analysis', 'Skill gap report', 'Fit-now and aspiration matches', 'Learning recommendations'].map((item) => (
                  <div key={item} className="mb-2 flex items-center gap-2 text-sm text-mid last:mb-0">
                    <span className="font-bold text-green">✓</span>
                    <span>{item}</span>
                  </div>
                ))}
              </div>
              <span className="block rounded-xl bg-rust px-5 py-3 text-center text-sm font-bold text-white transition-opacity group-hover:opacity-90">
                Get Started as Job Seeker
              </span>
            </button>

            <button
              type="button"
              onClick={onEmployerStart}
              className="group rounded-2xl border-2 border-bdr bg-card p-8 text-left transition-all hover:-translate-y-1 hover:border-forest-m hover:shadow-[0_12px_30px_rgba(45,74,62,0.12)]"
            >
              <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-forest-l text-2xl">🏢</div>
              <h2 className="font-display text-2xl font-extrabold text-dark">Employer</h2>
              <p className="mt-3 text-sm leading-relaxed text-mid">
                Register your company and prepare to screen applicants with skills-first matching.
              </p>
              <div className="my-6 rounded-xl bg-bg p-4">
                {['Smart candidate screening', 'Skill-based match ranking', 'Blind applicant review', 'Hiring pipeline tools'].map((item) => (
                  <div key={item} className="mb-2 flex items-center gap-2 text-sm text-mid last:mb-0">
                    <span className="font-bold text-green">✓</span>
                    <span>{item}</span>
                  </div>
                ))}
              </div>
              <span className="block rounded-xl bg-rust px-5 py-3 text-center text-sm font-bold text-white transition-colors group-hover:bg-forest">
                Get Started as Employer
              </span>
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}

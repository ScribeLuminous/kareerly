import Logo from '../components/Logo';
import { faBuilding, faUser } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

type SignUpDefaultProps = {
  onJobSeekerSignUp: () => void;
  onEmployerSignUp: () => void;
  onLogin: () => void;
  onHome: () => void;
};

export default function SignUpDefault({ onJobSeekerSignUp, onEmployerSignUp, onLogin, onHome }: SignUpDefaultProps) {
  return (
    <main className="min-h-screen bg-bg text-dark">
      <section className="mx-auto grid min-h-screen w-full lg:h-screen lg:min-h-0 lg:grid-cols-2">
        <aside className="bg-[#ECEAE4] px-4 py-6 sm:px-6 lg:px-10 lg:py-6">
          <div className="mx-auto flex h-full w-full max-w-lg flex-col justify-center">
            <div className="mb-7 flex justify-center">
              <Logo size="auth" layout="stack" className="scale-90 sm:scale-95" onClick={onHome} />
            </div>

            <h1 className="font-display text-xl font-extrabold leading-tight tracking-tight text-dark sm:text-2xl">
              What brings you here?
            </h1>
            <p className="mt-2.5 max-w-[520px] text-sm leading-relaxed text-mid sm:text-[15px]">
              Choose your role to create an account and get started
            </p>

            <div className="mt-6 space-y-3.5">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-bdr bg-card text-rust">
                  <FontAwesomeIcon icon={faUser} aria-hidden="true" />
                </span>
                <p className="text-sm leading-relaxed text-mid sm:text-base">
                  <span className="font-extrabold text-mid">Job Seeker:</span> Find jobs matched to your skills
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-bdr bg-card text-rust">
                  <FontAwesomeIcon icon={faBuilding} aria-hidden="true" />
                </span>
                <p className="text-sm leading-relaxed text-mid sm:text-base">
                  <span className="font-extrabold text-mid">Employer:</span> Hire talent with AI-powered matching
                </p>
              </div>
            </div>
          </div>
        </aside>

        <section className="bg-card px-4 py-6 sm:px-6 lg:px-10 lg:py-6">
          <div className="mx-auto flex h-full w-full max-w-lg flex-col justify-center">
            <h2 className="font-display text-2xl font-extrabold leading-tight tracking-tight text-dark sm:text-3xl">Create account</h2>
            <p className="mt-2.5 text-sm leading-relaxed text-soft sm:text-[15px]">Choose your role to get started</p>

            <div className="mt-6 space-y-2.5">
              <button
                type="button"
                onClick={onJobSeekerSignUp}
                className="inline-flex min-h-[56px] w-full items-center justify-center gap-2 rounded-2xl bg-rust px-4 py-3 text-base font-extrabold text-white transition-opacity hover:opacity-90 sm:text-lg"
              >
                <FontAwesomeIcon icon={faUser} aria-hidden="true" />
                <span>Sign up as Job Seeker</span>
              </button>

              <button
                type="button"
                onClick={onEmployerSignUp}
                className="inline-flex min-h-[56px] w-full items-center justify-center gap-2 rounded-2xl border border-bdr bg-bg px-4 py-3 text-base font-extrabold text-mid transition-colors hover:border-rust hover:text-rust sm:text-lg"
              >
                <FontAwesomeIcon icon={faBuilding} aria-hidden="true" />
                <span>Sign up as Employer</span>
              </button>
            </div>

            <div className="my-5 h-px w-full bg-bdr" />

            <div className="text-center text-sm text-mid sm:text-base">
              Already have an account?{' '}
              <button type="button" onClick={onLogin} className="font-extrabold text-rust hover:underline">
                Log in
              </button>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}

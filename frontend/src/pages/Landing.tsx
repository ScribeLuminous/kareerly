import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowRight, faBuilding, faCheck, faUser } from '@fortawesome/free-solid-svg-icons';
import Header from '../components/Header';

type LandingProps = {
  onHome: () => void;
  onCandidateStart: () => void;
  onEmployerStart: () => void;
  onLogin: () => void;
  onSignUp: () => void;
};

const roles = [
  {
    key: 'candidate',
    icon: faUser,
    title: 'Job seeker',
    text: 'Upload your resume and see which jobs fit your skills.',
    items: ['Fit Now and Aspiration matches', 'The skills you are missing', 'Where to learn them'],
    cta: 'Get started',
    primary: true,
  },
  {
    key: 'employer',
    icon: faBuilding,
    title: 'Employer',
    text: 'Post jobs and review applicants ranked by skills.',
    items: ['Skill-based candidate ranking', 'Blind applicant review', 'Hiring pipeline'],
    cta: 'Start hiring',
    primary: false,
  },
] as const;

export default function Landing({ onHome, onCandidateStart, onEmployerStart, onLogin, onSignUp }: LandingProps) {
  return (
    <div className="min-h-screen bg-bg text-dark">
      <Header onHome={onHome} onLogin={onLogin} onSignUp={onSignUp} />
      <main className="mx-auto flex min-h-[calc(100dvh-64px)] w-full max-w-4xl flex-col justify-center px-4 py-10 sm:px-6">
        <div className="mb-8 text-center">
          <h1 className="font-display text-[32px] font-extrabold leading-tight text-dark sm:text-5xl">
            Find the job that <span className="text-rust">fits you</span>
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-mid sm:text-base">
            Skill-first job matching for Filipino job seekers and employers.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 md:gap-5">
          {roles.map((role) => (
            <button
              key={role.key}
              type="button"
              onClick={role.key === 'candidate' ? onCandidateStart : onEmployerStart}
              className={`group flex flex-col rounded-2xl border bg-card p-5 text-left transition-colors hover:border-rust sm:p-6 ${role.primary ? 'border-rust-m' : 'border-bdr'}`}
            >
              <span className="flex items-center gap-3">
                <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${role.primary ? 'bg-rust-l text-rust' : 'bg-forest-l text-forest'}`}>
                  <FontAwesomeIcon icon={role.icon} aria-hidden="true" />
                </span>
                <span className="font-display text-xl font-bold text-dark">{role.title}</span>
              </span>
              <span className="mt-3 text-[15px] leading-relaxed text-mid">{role.text}</span>
              <span className="mt-4 flex flex-col gap-2">
                {role.items.map((item) => (
                  <span key={item} className="flex items-center gap-2 text-sm text-mid">
                    <FontAwesomeIcon icon={faCheck} className="text-green" aria-hidden="true" />
                    {item}
                  </span>
                ))}
              </span>
              <span className={`k-btn mt-5 ${role.primary ? 'k-btn-primary' : 'k-btn-secondary'} group-hover:no-underline`}>
                {role.cta}<FontAwesomeIcon icon={faArrowRight} aria-hidden="true" />
              </span>
            </button>
          ))}
        </div>
      </main>
    </div>
  );
}

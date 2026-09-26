import AuthShell from '../components/AuthShell';
import { faBuilding, faChevronRight, faUser } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

type SignUpDefaultProps = {
  onJobSeekerSignUp: () => void;
  onEmployerSignUp: () => void;
  onLogin: () => void;
  onHome: () => void;
};

export default function SignUpDefault({ onJobSeekerSignUp, onEmployerSignUp, onLogin, onHome }: SignUpDefaultProps) {
  const roles = [
    { id: 'candidate', icon: faUser, title: "I'm looking for a job", detail: 'Get matched on your skills and see what to learn next.', onSelect: onJobSeekerSignUp },
    { id: 'employer', icon: faBuilding, title: "I'm hiring", detail: 'Post jobs and review applicants ranked by skill match.', onSelect: onEmployerSignUp },
  ];
  return (
    <AuthShell
      title="Create an account"
      subtitle="Choose how you'll use Kareerly."
      panelTitle="Skills-first hiring for Filipino job seekers and employers"
      panelItems={['Matches scored on real skills', 'Free learning for the gaps', 'Fair, identity-masked applicant review']}
      onHome={onHome}
      footer={(
        <>
          Already have an account?{' '}
          <button className="k-link" type="button" onClick={onLogin}>Log in</button>
        </>
      )}
    >
      <ul className="k-list">
        {roles.map((role) => (
          <li key={role.id}>
            <button className="k-row items-start py-4" type="button" onClick={role.onSelect}>
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rust-l text-rust" aria-hidden="true">
                <FontAwesomeIcon icon={role.icon} />
              </span>
              <span className="k-row-main">
                <span className="k-item-title block">{role.title}</span>
                <span className="k-secondary mt-0.5 block">{role.detail}</span>
              </span>
              <FontAwesomeIcon className="k-row-chevron mt-3" icon={faChevronRight} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </AuthShell>
  );
}

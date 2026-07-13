import SignIn from './SignIn';
import type { KareerlyUser } from '../lib/auth';

type CandidateLoginProps = {
  onAuthenticated: (user: KareerlyUser) => void;
  onCreateAccount: () => void;
  onEmployerLogin: () => void;
  onResetPassword: () => void;
  onHome: () => void;
};

export default function CandidateLogin({
  onAuthenticated,
  onCreateAccount,
  onEmployerLogin,
  onResetPassword,
  onHome,
}: CandidateLoginProps) {
  return (
    <SignIn
      expectedRole="candidate"
      onAuthenticated={onAuthenticated}
      onCreateAccount={onCreateAccount}
      onSwitchRole={onEmployerLogin}
      onResetPassword={onResetPassword}
      onHome={onHome}
    />
  );
}

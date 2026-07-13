import SignIn from './SignIn';
import type { KareerlyUser } from '../lib/auth';

type EmployerLoginProps = {
  onAuthenticated: (user: KareerlyUser) => void;
  onCreateAccount: () => void;
  onCandidateLogin: () => void;
  onResetPassword: () => void;
  onHome: () => void;
};

export default function EmployerLogin({
  onAuthenticated,
  onCreateAccount,
  onCandidateLogin,
  onResetPassword,
  onHome,
}: EmployerLoginProps) {
  return (
    <SignIn
      expectedRole="employer"
      onAuthenticated={onAuthenticated}
      onCreateAccount={onCreateAccount}
      onSwitchRole={onCandidateLogin}
      onResetPassword={onResetPassword}
      onHome={onHome}
    />
  );
}

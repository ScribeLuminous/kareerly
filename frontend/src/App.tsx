import { useEffect, useState } from 'react';
import { OnboardingProvider } from './context/OnboardingContext';
import { useOnboarding } from './hooks/useOnboarding';
import Dashboard from './pages/Dashboard';
import EmployerDashboard from './pages/EmployerDashboard';
import EmployerSignUp from './pages/EmployerSignUp';
import Landing from './pages/Landing';
import Onboarding from './pages/Onboarding';
import PasswordRecovery from './pages/PasswordRecovery';
import SignIn from './pages/SignIn';
import SignUp from './pages/SignUp';
import SignUpDefault from './pages/SignUpDefault';
import './index.css';

type AppView = 'landing' | 'onboarding' | 'signin' | 'signup-default' | 'candidate-signup' | 'employer-signup' | 'dashboard' | 'employer-dashboard' | 'password-recovery';
type AuthRole = 'candidate' | 'employer';
type AuthUser = {
  name: string;
  email: string;
};
type EmployerUser = AuthUser & {
  company: string;
};

const SAMPLE_CANDIDATE_EMAIL = 'candidate@test.com';
const SAMPLE_EMPLOYER_EMAIL = 'employer@test.com';
const SAMPLE_EMPLOYER_COMPANY = 'TechCorp Inc';

function AppContent() {
  const { state, reset, goToStep } = useOnboarding();
  const [view, setView] = useState<AppView>('landing');
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [currentEmployer, setCurrentEmployer] = useState<EmployerUser | null>(null);
  const [authRole, setAuthRole] = useState<AuthRole>('candidate');
  const resumeCandidateName = state.resumeAnalysis?.candidate_profile?.full_name?.trim() || '';

  useEffect(() => {
    if (!resumeCandidateName || authRole !== 'candidate') return;

    setCurrentUser((previous) => {
      if (!previous) return previous;
      if (previous.name.trim() === resumeCandidateName) return previous;
      return { ...previous, name: resumeCandidateName };
    });
  }, [authRole, resumeCandidateName]);

  const hasOnboardingSessionData = Boolean(
    state.resumeFile ||
      state.resumeAnalysis ||
      state.matchResults ||
      state.selectedSkills.length > 0 ||
      state.surveyAnswers,
  );

  const showHome = () => {
    reset();
    setView('landing');
  };
  const startOnboarding = (options?: { preserveState?: boolean; step?: 1 | 2 | 3 | 4 }) => {
    if (!options?.preserveState) {
      reset();
    } else if (options.step) {
      goToStep(options.step);
    }
    setView('onboarding');
  };
  const showCandidateSignIn = () => {
    setAuthRole('candidate');
    setView('signin');
  };
  const showEmployerSignIn = () => {
    setAuthRole('employer');
    setView('signin');
  };
  const showCandidateSignUp = () => {
    setAuthRole('candidate');
    setView('candidate-signup');
  };
  const showEmployerSignUp = () => {
    setAuthRole('employer');
    setView('employer-signup');
  };
  const showSignUpDefault = () => {
    setView('signup-default');
  };
  const showDashboard = () => {
    if (!currentUser) {
      showCandidateSignIn();
      return;
    }
    setView('dashboard');
  };
  const handleCandidateLoginAuthenticated = (user: AuthUser) => {
    setCurrentUser(user);
    if (hasOnboardingSessionData) {
      setView('onboarding');
      return;
    }
    startOnboarding();
  };
  const handleCandidateSignUpAuthenticated = (user: AuthUser) => {
    setCurrentUser(user);
    if (hasOnboardingSessionData) {
      setView('onboarding');
      return;
    }
    startOnboarding();
  };
  const handleEmployerAuthenticated = (employer: EmployerUser) => {
    setCurrentEmployer(employer);
    setView('employer-dashboard');
  };
  const handleCandidateLogout = () => {
    setCurrentUser(null);
    setAuthRole('candidate');
    reset();
    setView('landing');
  };
  const handleEmployerLogout = () => {
    setCurrentEmployer(null);
    setAuthRole('employer');
    showHome();
  };
  const startOnboardingResumeUpdate = () => {
    if (!currentUser) {
      showCandidateSignIn();
      return;
    }
    startOnboarding({ preserveState: true, step: 2 });
  };
  const handleLoginAuthenticated = (user: AuthUser) => {
    const normalizedEmail = user.email.trim().toLowerCase();
    if (normalizedEmail === SAMPLE_CANDIDATE_EMAIL) {
      setAuthRole('candidate');
      handleCandidateLoginAuthenticated({
        ...user,
        email: normalizedEmail,
        name: user.name || 'Candidate Test',
      });
      return;
    }
    if (normalizedEmail === SAMPLE_EMPLOYER_EMAIL) {
      setAuthRole('employer');
      handleEmployerAuthenticated({
        ...user,
        email: normalizedEmail,
        name: user.name || 'Employer Test',
        company: SAMPLE_EMPLOYER_COMPANY,
      });
      return;
    }
    if (authRole === 'employer') {
      handleEmployerAuthenticated({ ...user, company: 'Employer Workspace' });
      return;
    }
    handleCandidateLoginAuthenticated(user);
  };

  return (
    <>
      {view === 'landing' && (
        <Landing
          onHome={showHome}
          onCandidateStart={startOnboarding}
          onEmployerStart={showEmployerSignUp}
          onLogin={showCandidateSignIn}
          onSignUp={showSignUpDefault}
        />
      )}
      {view === 'signin' && (
        <SignIn
          onAuthenticated={handleLoginAuthenticated}
          onCreateAccount={showSignUpDefault}
          onResetPassword={() => setView('password-recovery')}
          onHome={showHome}
        />
      )}
      {view === 'signup-default' && (
        <SignUpDefault
          onJobSeekerSignUp={showCandidateSignUp}
          onEmployerSignUp={showEmployerSignUp}
          onLogin={showCandidateSignIn}
          onHome={showHome}
        />
      )}
      {view === 'password-recovery' && <PasswordRecovery onBackToLogin={() => setView('signin')} onHome={showHome} />}
      {view === 'candidate-signup' && (
        <SignUp onAuthenticated={handleCandidateSignUpAuthenticated} onSignIn={showCandidateSignIn} onHome={showHome} />
      )}
      {view === 'employer-signup' && (
        <EmployerSignUp onAuthenticated={handleEmployerAuthenticated} onSignIn={showEmployerSignIn} onHome={showHome} />
      )}
      {view === 'dashboard' && (
        <Dashboard
          currentUser={currentUser}
          onHome={showHome}
          onLogin={showCandidateSignIn}
          onSignUp={showSignUpDefault}
          onUpdateResume={startOnboardingResumeUpdate}
          onLogout={handleCandidateLogout}
        />
      )}
      {view === 'employer-dashboard' && (
        <EmployerDashboard
          employer={currentEmployer}
          onHome={showHome}
          onLogin={showEmployerSignIn}
          onSignUp={showEmployerSignUp}
          onLogout={handleEmployerLogout}
        />
      )}
      {view === 'onboarding' && (
        <Onboarding
          isLoggedIn={Boolean(currentUser)}
          onHome={showHome}
          onLogin={showCandidateSignIn}
          onSignUp={showSignUpDefault}
          onViewDashboard={showDashboard}
        />
      )}
    </>
  );
}

function App() {
  return (
    <OnboardingProvider>
      <AppContent />
    </OnboardingProvider>
  );
}

export default App;

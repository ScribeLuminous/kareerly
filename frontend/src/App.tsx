import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { OnboardingProvider } from './context/OnboardingContext';
import { useOnboarding } from './hooks/useOnboarding';
import AdminDashboard from './pages/AdminDashboard';
import CandidateLogin from './pages/CandidateLogin';
import Dashboard from './pages/Dashboard';
import EmployerDashboard from './pages/EmployerDashboard';
import EmployerLogin from './pages/EmployerLogin';
import EmployerSignUp from './pages/EmployerSignUp';
import Landing from './pages/Landing';
import Onboarding from './pages/Onboarding';
import PasswordRecovery from './pages/PasswordRecovery';
import SignIn from './pages/SignIn';
import SignUp from './pages/SignUp';
import SignUpDefault from './pages/SignUpDefault';
import { getAuthStatus, getCurrentKareerlyUser, signOutCurrentUser } from './lib/auth';
import type { KareerlyUser } from './lib/auth';
import { supabase } from './lib/supabase';
import './index.css';

type AppView =
  | 'landing'
  | 'onboarding'
  | 'candidate-login'
  | 'employer-login'
  | 'admin-login'
  | 'signup-default'
  | 'candidate-signup'
  | 'employer-signup'
  | 'dashboard'
  | 'employer-dashboard'
  | 'admin-dashboard'
  | 'password-recovery';
type AuthRole = 'candidate' | 'employer' | 'admin';
type AuthUser = KareerlyUser;
type EmployerUser = KareerlyUser & { company: string };

function AppContent() {
  const navigate = useNavigate();
  const location = useLocation();
  const { state, reset, goToStep } = useOnboarding();
  const [view, setView] = useState<AppView>('landing');
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [currentEmployer, setCurrentEmployer] = useState<EmployerUser | null>(null);
  const [currentAdmin, setCurrentAdmin] = useState<AuthUser | null>(null);
  const [authRole, setAuthRole] = useState<AuthRole>('candidate');
  const [isRestoringSession, setIsRestoringSession] = useState(true);
  const resumeCandidateName = state.resumeAnalysis?.candidate_profile?.full_name?.trim() || '';

  const applyAuthenticatedUser = (user: KareerlyUser, options?: { preserveView?: boolean }) => {
    if (user.role === 'admin') {
      setAuthRole('admin');
      setCurrentUser(null);
      setCurrentEmployer(null);
      setCurrentAdmin(user);
      if (!options?.preserveView) {
        setView('admin-dashboard');
        navigate('/admin/dashboard', { replace: true });
      }
      return;
    }

    if (user.role === 'employer') {
      setAuthRole('employer');
      setCurrentUser(null);
      setCurrentAdmin(null);
      setCurrentEmployer({ ...user, company: user.company || 'Employer Workspace' });
      if (!options?.preserveView) {
        setView('employer-dashboard');
        navigate('/employer/dashboard', { replace: true });
      }
      return;
    }

    setAuthRole('candidate');
    setCurrentEmployer(null);
    setCurrentAdmin(null);
    setCurrentUser(user);
    if (!options?.preserveView) {
      setView(hasOnboardingSessionData ? 'onboarding' : 'dashboard');
      navigate(hasOnboardingSessionData ? '/candidate/onboarding' : '/candidate/dashboard', { replace: true });
    }
  };

  useEffect(() => {
    let isMounted = true;

    getCurrentKareerlyUser()
      .then((user) => {
        if (!isMounted) return;
        if (user) {
          applyAuthenticatedUser(user);
        } else if (location.pathname === '/candidate/login') {
          setAuthRole('candidate');
          setView('candidate-login');
        } else if (location.pathname === '/employer/login') {
          setAuthRole('employer');
          setView('employer-login');
        } else if (location.pathname !== '/') {
          setView('landing');
          navigate('/', { replace: true });
        }
      })
      .catch((error) => {
        console.warn('Unable to restore Supabase session:', error);
      })
      .finally(() => {
        if (isMounted) setIsRestoringSession(false);
      });

    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        const status = getAuthStatus();
        if (status === 'verifying_role' || status === 'role_mismatch') return;
        setCurrentUser(null);
        setCurrentEmployer(null);
        setCurrentAdmin(null);
        setAuthRole('candidate');
        reset();
        if (window.location.pathname.endsWith('/login')) return;
        setView('landing');
        navigate('/', { replace: true });
      }
    });

    return () => {
      isMounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (window.location.hash === '#admin' && !currentAdmin) {
      setAuthRole('admin');
      setView('admin-login');
    }
  }, [currentAdmin]);

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
    navigate('/');
  };
  const showAuthenticatedHome = () => {
    if (currentEmployer) {
      setView('employer-dashboard');
      navigate('/employer/dashboard');
      return;
    }
    if (currentUser) {
      setView('dashboard');
      navigate('/candidate/dashboard');
      return;
    }
    showHome();
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
    setView('candidate-login');
    navigate('/candidate/login');
  };
  const showEmployerSignIn = () => {
    setAuthRole('employer');
    setView('employer-login');
    navigate('/employer/login');
  };
  const showAdminSignIn = () => {
    setAuthRole('admin');
    setView('admin-login');
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
    navigate('/employer/dashboard', { replace: true });
  };
  const handleCandidateLogout = async () => {
    await signOutCurrentUser().catch((error) => console.warn('Unable to sign out:', error));
    setCurrentUser(null);
    setAuthRole('candidate');
    reset();
    setView('landing');
  };
  const handleEmployerLogout = async () => {
    await signOutCurrentUser().catch((error) => console.warn('Unable to sign out:', error));
    setCurrentEmployer(null);
    setAuthRole('employer');
    showHome();
  };
  const handleAdminLogout = async () => {
    await signOutCurrentUser().catch((error) => console.warn('Unable to sign out:', error));
    setCurrentAdmin(null);
    setAuthRole('admin');
    setView('admin-login');
  };
  const startOnboardingResumeUpdate = () => {
    if (!currentUser) {
      showCandidateSignIn();
      return;
    }
    startOnboarding({ preserveState: true, step: 2 });
  };
  const handleLoginAuthenticated = (user: AuthUser) => {
    if (user.role === 'admin') {
      setCurrentAdmin(user);
      setCurrentEmployer(null);
      setCurrentUser(null);
      setAuthRole('admin');
    setView('admin-dashboard');
      navigate('/admin/dashboard', { replace: true });
      return;
    }
    if (user.role === 'employer') {
      handleEmployerAuthenticated({ ...user, company: user.company || 'Employer Workspace' });
      return;
    }
    handleCandidateLoginAuthenticated(user);
  };

  if (isRestoringSession) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg px-6 text-center text-mid">
        <div>
          <div className="font-display text-2xl font-extrabold text-dark">Kareerly</div>
          <div className="mt-2 text-sm">Restoring your session...</div>
        </div>
      </main>
    );
  }

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
      {view === 'candidate-login' && (
        <CandidateLogin
          onAuthenticated={handleLoginAuthenticated}
          onCreateAccount={showSignUpDefault}
          onEmployerLogin={showEmployerSignIn}
          onResetPassword={() => setView('password-recovery')}
          onHome={showHome}
        />
      )}
      {view === 'employer-login' && (
        <EmployerLogin
          onAuthenticated={handleLoginAuthenticated}
          onCreateAccount={showEmployerSignUp}
          onCandidateLogin={showCandidateSignIn}
          onResetPassword={() => setView('password-recovery')}
          onHome={showHome}
        />
      )}
      {view === 'admin-login' && (
        <SignIn
          expectedRole="admin"
          onAuthenticated={handleLoginAuthenticated}
          onCreateAccount={showSignUpDefault}
          onSwitchRole={showCandidateSignIn}
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
      {view === 'password-recovery' && (
        <PasswordRecovery onBackToLogin={authRole === 'admin' ? showAdminSignIn : authRole === 'employer' ? showEmployerSignIn : showCandidateSignIn} onHome={showHome} />
      )}
      {view === 'candidate-signup' && (
        <SignUp onAuthenticated={handleCandidateSignUpAuthenticated} onSignIn={showCandidateSignIn} onHome={showHome} />
      )}
      {view === 'employer-signup' && (
        <EmployerSignUp onAuthenticated={handleEmployerAuthenticated} onSignIn={showEmployerSignIn} onHome={showHome} />
      )}
      {view === 'dashboard' && (
        <Dashboard
          currentUser={currentUser}
          onHome={showAuthenticatedHome}
          onLogin={showCandidateSignIn}
          onSignUp={showSignUpDefault}
          onUpdateResume={startOnboardingResumeUpdate}
          onLogout={handleCandidateLogout}
        />
      )}
      {view === 'employer-dashboard' && (
        <EmployerDashboard
          employer={currentEmployer}
          onHome={showAuthenticatedHome}
          onLogin={showEmployerSignIn}
          onSignUp={showEmployerSignUp}
          onLogout={handleEmployerLogout}
        />
      )}
      {view === 'admin-dashboard' && (
        <AdminDashboard
          admin={currentAdmin}
          onHome={showHome}
          onLogout={handleAdminLogout}
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

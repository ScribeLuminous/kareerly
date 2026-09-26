import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { OnboardingProvider } from './context/OnboardingContext';
import { useOnboarding } from './hooks/useOnboarding';
import BackendVersionBanner from './components/BackendVersionBanner';
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
import { clearGuestOnboarding, stashGuestOnboarding } from './lib/guestOnboarding';
import { loadLatestResume, saveMatchHistory, saveResumeAnalysis } from './lib/userData';
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
  const { state, reset, goToStep, restoreGuestReport, setSavedResumeId, setError } = useOnboarding();
  const [view, setView] = useState<AppView>('landing');
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [currentEmployer, setCurrentEmployer] = useState<EmployerUser | null>(null);
  const [currentAdmin, setCurrentAdmin] = useState<AuthUser | null>(null);
  const [authRole, setAuthRole] = useState<AuthRole>('candidate');
  const [isRestoringSession, setIsRestoringSession] = useState(true);
  const resumeCandidateName = state.resumeAnalysis?.candidate_profile?.full_name?.trim() || '';
  // The account the guest report was last saved for. Saving runs once per
  // sign-in (a renamed user object must not save a second copy); a failed save
  // is retried when the candidate logs in again.
  const guestReportSaveFor = useRef<string | null>(null);

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
        clearGuestOnboarding();
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

  // A guest's report exists only in memory. Keep it in browser storage so it
  // survives a reload or the email-confirmation tab until they sign up or log in.
  useEffect(() => {
    if (isRestoringSession || currentUser || !state.resumeAnalysis || state.savedResumeId) return;
    void stashGuestOnboarding({
      analysis: state.resumeAnalysis,
      selectedSkills: state.selectedSkills,
      surveyAnswers: state.surveyAnswers,
      matchResults: state.matchResults || null,
      file: state.resumeFile,
    });
  }, [isRestoringSession, currentUser, state.resumeAnalysis, state.savedResumeId, state.selectedSkills, state.surveyAnswers, state.matchResults, state.resumeFile]);

  // Signing up or logging in from the guest flow saves that resume, its skills,
  // the Step 3 preferences and the report to the account. A signed-in
  // candidate's own uploads are saved as they happen, so an analysis without a
  // saved resume id in the onboarding flow is always a guest's.
  useEffect(() => {
    if (!currentUser?.id || view !== 'onboarding') return;
    const { resumeAnalysis: analysis, resumeFile, matchResults, surveyAnswers } = state;
    if (!analysis || state.savedResumeId || guestReportSaveFor.current === currentUser.id) return;
    guestReportSaveFor.current = currentUser.id;
    const userId = currentUser.id;
    void (async () => {
      try {
        // Sign-up returns no session while the email address awaits confirmation;
        // the report stays in storage and is saved once they log in.
        const { data: sessionData } = await supabase.auth.getSession();
        if (sessionData.session?.user.id !== userId) {
          setError('Confirm your email address, then log in to save this report to your account.');
          return;
        }
        const resumeId = await saveResumeAnalysis({
          userId,
          fileName: resumeFile?.name,
          file: resumeFile,
          analysis,
        });
        setSavedResumeId(resumeId);
        if (matchResults) {
          await saveMatchHistory({ userId, resumeId, preferences: surveyAnswers || {}, results: matchResults });
        }
        clearGuestOnboarding();
        setError(null);
      } catch (error) {
        console.warn('Unable to save the guest report to the new account:', error);
        setError(error instanceof Error ? error.message : 'Unable to save your resume to your account.');
      }
    })();
  }, [currentUser?.id, view, state, setSavedResumeId, setError]);

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
      clearGuestOnboarding();
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
  const handleCandidateLoginAuthenticated = async (user: AuthUser) => {
    guestReportSaveFor.current = null;
    setCurrentUser(user);
    // A guest who left the report (Home, reload) still has it in storage.
    if (hasOnboardingSessionData || restoreGuestReport()) {
      setView('onboarding');
      return;
    }
    // A returning candidate goes to the dashboard, which restores their saved
    // resume, matches and preferences; only a new candidate starts at Step 1.
    if (await loadLatestResume({ userId: user.id })) {
      setView('dashboard');
      navigate('/candidate/dashboard', { replace: true });
      return;
    }
    startOnboarding();
  };
  const handleCandidateSignUpAuthenticated = (user: AuthUser) => {
    guestReportSaveFor.current = null;
    setCurrentUser(user);
    if (hasOnboardingSessionData || restoreGuestReport()) {
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
    clearGuestOnboarding();
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
    void handleCandidateLoginAuthenticated(user);
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
      <BackendVersionBanner />
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

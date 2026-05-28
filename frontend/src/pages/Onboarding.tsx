import { Header, Hero, StepProgress, UploadZone, SurveyStep, SnapshotStep, LoadingOverlay } from '../components';
import { useEffect } from 'react';
import { useOnboarding } from '../hooks/useOnboarding';

type OnboardingProps = {
  isLoggedIn: boolean;
  onHome: () => void;
  onLogin: () => void;
  onSignUp: () => void;
  onViewDashboard: () => void;
};

export default function Onboarding({ isLoggedIn, onHome, onLogin, onSignUp, onViewDashboard }: OnboardingProps) {
  const { state } = useOnboarding();

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [state.step]);

  const rightContent = isLoggedIn ? (
    <button
      type="button"
      onClick={onViewDashboard}
      className="ml-auto rounded-lg border border-forest-m bg-forest px-4 py-2 text-sm font-bold text-white transition-opacity hover:opacity-90"
    >
      View Saved Dashboard
    </button>
  ) : undefined;

  return (
    <div className="min-h-screen bg-bg">
      <Header onHome={onHome} onLogin={onLogin} onSignUp={onSignUp} rightContent={rightContent} />
      <StepProgress currentStep={state.step} />
      <main>
        {state.step === 1 && <Hero />}

        {state.step === 1 && <UploadZone />}
        {(state.step === 2 || state.step === 3) && <SurveyStep isLoggedIn={isLoggedIn} />}
        {state.step === 4 && <SnapshotStep isLoggedIn={isLoggedIn} onViewDashboard={onViewDashboard} />}
      </main>

      <LoadingOverlay />
    </div>
  );
}

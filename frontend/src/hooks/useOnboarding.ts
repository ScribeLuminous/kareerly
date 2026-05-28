import { useContext } from 'react';
import { OnboardingContext } from '../context/OnboardingContextCore';

export const useOnboarding = () => {
  const context = useContext(OnboardingContext);
  if (context === undefined) {
    throw new Error('useOnboarding must be used within OnboardingProvider');
  }
  return context;
};

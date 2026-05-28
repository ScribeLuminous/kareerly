import { useOnboarding } from '../hooks/useOnboarding';

export default function LoadingOverlay() {
  const { state } = useOnboarding();

  if (!state.isLoading) return null;

  return (
    <div className="fixed inset-0 bg-bg/92 backdrop-blur z-50 flex flex-col items-center justify-center gap-4.5">
      <div className="w-14 h-14 border-4 border-bdr border-t-rust rounded-full animate-spin"></div>
      <div className="font-display font-bold text-lg text-dark text-center">Analyzing your resume...</div>
      <div className="text-xs text-soft text-center">This takes about 10 seconds</div>
    </div>
  );
}

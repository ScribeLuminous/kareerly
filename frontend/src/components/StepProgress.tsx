import { faCheck } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

interface StepProgressProps {
  currentStep: 1 | 2 | 3 | 4;
}

const steps = [
  { id: 1, label: 'Upload' },
  { id: 2, label: 'Skills' },
  { id: 3, label: 'Preferences' },
  { id: 4, label: 'Report' },
];

export default function StepProgress({ currentStep }: StepProgressProps) {
  const current = steps[currentStep - 1];
  return (
    <nav className="sticky top-16 z-20 border-b border-bdr bg-card px-4 py-2.5 sm:px-5" aria-label="Report steps">
      {/* Phones: one line and a progress bar. */}
      <div className="sm:hidden">
        <p className="text-[13px] font-semibold text-mid">
          Step {currentStep} of {steps.length} · <span className="text-dark">{current.label}</span>
        </p>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-cream" aria-hidden="true">
          <div className="h-full rounded-full bg-rust transition-all duration-300" style={{ width: `${(currentStep / steps.length) * 100}%` }} />
        </div>
      </div>

      {/* Wider screens: the full stepper. */}
      <ol className="mx-auto hidden max-w-2xl items-center justify-center gap-3 sm:flex">
        {steps.map((step, index) => {
          const status = step.id < currentStep ? 'done' : step.id === currentStep ? 'active' : 'pending';
          return (
            <li key={step.id} className="flex items-center gap-3" aria-current={status === 'active' ? 'step' : undefined}>
              <span className="flex items-center gap-2">
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-[13px] font-bold ${
                    status === 'active' ? 'bg-rust text-white' : status === 'done' ? 'bg-green text-white' : 'bg-cream text-mid'
                  }`}
                  aria-hidden="true"
                >
                  {status === 'done' ? <FontAwesomeIcon icon={faCheck} aria-hidden="true" /> : step.id}
                </span>
                <span className={`text-[13px] font-semibold ${status === 'pending' ? 'text-soft-text' : 'text-dark'}`}>
                  {step.label}
                  {status === 'done' && <span className="sr-only"> (done)</span>}
                </span>
              </span>
              {index < steps.length - 1 && (
                <span className={`h-0.5 w-10 md:w-16 ${step.id < currentStep ? 'bg-rust' : 'bg-bdr'}`} aria-hidden="true" />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

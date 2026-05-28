import { faCheck } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

interface StepProgressProps {
  currentStep: 1 | 2 | 3 | 4;
}

export default function StepProgress({ currentStep }: StepProgressProps) {
  const steps = [
    { id: 1, label: 'Upload' },
    { id: 2, label: 'Skills' },
    { id: 3, label: 'Preferences' },
    { id: 4, label: 'Report' },
  ];

  const getStepStatus = (stepId: number) => {
    if (stepId < currentStep) return 'done';
    if (stepId === currentStep) return 'active';
    return 'pending';
  };

  return (
    <div className="sticky top-16 z-20 flex max-w-full items-center justify-center border-b border-bdr bg-card px-3 py-2 sm:px-5">
      <div className="flex w-full max-w-4xl items-start justify-center gap-2 sm:translate-x-2 sm:gap-3">
        {steps.map((step, index) => (
          <div key={step.id} className="flex items-start gap-2 sm:gap-3">
            <div className="flex min-w-0 flex-col items-center gap-0.5">
              <div
                className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-bold transition-all duration-300 sm:h-10 sm:w-10 sm:text-sm ${
                  getStepStatus(step.id) === 'active'
                    ? 'bg-rust text-white shadow-md shadow-rust/20'
                    : getStepStatus(step.id) === 'done'
                    ? 'bg-green text-white'
                    : 'bg-bdr text-soft'
                }`}
                title={step.label}
              >
                {getStepStatus(step.id) === 'done' ? <FontAwesomeIcon icon={faCheck} aria-hidden="true" /> : step.id}
              </div>
              <div
                className={`min-w-[54px] text-center text-[9px] font-bold leading-tight sm:min-w-[78px] sm:text-[11px] ${
                  getStepStatus(step.id) === 'active'
                    ? 'text-rust'
                    : getStepStatus(step.id) === 'done'
                    ? 'text-green'
                    : 'text-soft'
                }`}
              >
                {step.label}
              </div>
            </div>

            {index < steps.length - 1 && (
              <div
                className={`mt-4 h-0.5 w-12 transition-all duration-200 sm:mt-5 sm:w-20 md:w-24 ${
                  index + 1 < currentStep ? 'bg-rust' : 'bg-bdr'
                }`}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

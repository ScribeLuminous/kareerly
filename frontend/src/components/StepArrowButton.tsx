import { faArrowLeft, faArrowRight, faSpinner } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

type StepArrowButtonProps = {
  direction: 'back' | 'next';
  label: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
};

export default function StepArrowButton({ direction, label, onClick, disabled = false, loading = false }: StepArrowButtonProps) {
  return (
    <button
      type="button"
      className="step-arrow-button"
      onClick={onClick}
      disabled={disabled || loading}
      aria-label={label}
      aria-busy={loading}
      title={label}
    >
      <FontAwesomeIcon
        icon={loading ? faSpinner : direction === 'back' ? faArrowLeft : faArrowRight}
        spin={loading}
        aria-hidden="true"
      />
    </button>
  );
}

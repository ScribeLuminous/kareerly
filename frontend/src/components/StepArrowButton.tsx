import { faArrowLeft, faArrowRight, faSpinner } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

type StepArrowButtonProps = {
  direction: 'back' | 'next';
  /** Accessible name; it starts with or contains the visible text. */
  label: string;
  /** Short visible label beside the arrow ("Back", "Next", "Analyze resume"). */
  text?: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
};

export default function StepArrowButton({ direction, label, text, onClick, disabled = false, loading = false }: StepArrowButtonProps) {
  const visible = text || (direction === 'back' ? 'Back' : 'Next');
  const icon = (
    <span className="step-arrow-icon" aria-hidden="true">
      <FontAwesomeIcon
        icon={loading ? faSpinner : direction === 'back' ? faArrowLeft : faArrowRight}
        spin={loading}
        aria-hidden="true"
      />
    </span>
  );
  return (
    <button
      type="button"
      className="step-arrow-button"
      data-direction={direction}
      onClick={onClick}
      disabled={disabled || loading}
      aria-label={label}
      aria-busy={loading}
    >
      {direction === 'back' && icon}
      <span className="step-arrow-text">{visible}</span>
      {direction === 'next' && icon}
    </button>
  );
}

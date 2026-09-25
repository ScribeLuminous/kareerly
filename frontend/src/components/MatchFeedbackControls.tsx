import { useId } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faThumbsDown, faThumbsUp } from '@fortawesome/free-solid-svg-icons';
import { feedbackStatusText } from '../lib/matchFeedback';
import type { MatchFeedbackStatus, MatchVote } from '../lib/matchFeedback';

type MatchFeedbackControlsProps = {
  jobTitle: string;
  vote: MatchVote | null;
  status: MatchFeedbackStatus;
  onVote: (vote: MatchVote) => void;
};

const OPTIONS: Array<{ vote: MatchVote; label: string; icon: typeof faThumbsUp }> = [
  { vote: 'good', label: 'Good match', icon: faThumbsUp },
  { vote: 'bad', label: 'Bad match', icon: faThumbsDown },
];

export default function MatchFeedbackControls({ jobTitle, vote, status, onVote }: MatchFeedbackControlsProps) {
  const labelId = useId();
  const saving = status.state === 'saving';
  const statusText = feedbackStatusText(vote, status);

  return (
    <div className="cand-feedback" role="group" aria-labelledby={labelId} aria-busy={saving}>
      <span className="cand-feedback-label" id={labelId}>
        Rate this match<span className="sr-only"> for {jobTitle}</span>
      </span>
      <div className="cand-feedback-buttons">
        {OPTIONS.map((option) => {
          const selected = vote === option.vote;
          return (
            <button
              key={option.vote}
              type="button"
              className={`cand-feedback-btn ${option.vote} ${selected ? 'selected' : ''}`}
              aria-pressed={selected}
              disabled={saving}
              title={selected ? `Remove your “${option.label}” rating` : `Mark as ${option.label.toLowerCase()}`}
              onClick={() => onVote(option.vote)}
            >
              <FontAwesomeIcon icon={option.icon} aria-hidden="true" />
              {option.label}
            </button>
          );
        })}
      </div>
      <span className="cand-feedback-status" role="status" aria-live="polite">{statusText}</span>
      {status.state === 'error' && (
        <span className="cand-feedback-error" role="alert">
          {status.message}{' '}
          <button type="button" className="cand-feedback-retry" onClick={() => onVote(status.retryVote)}>
            Try again
          </button>
        </span>
      )}
    </div>
  );
}

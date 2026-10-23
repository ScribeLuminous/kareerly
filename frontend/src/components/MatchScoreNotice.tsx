import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCircleInfo } from '@fortawesome/free-solid-svg-icons';
import { MATCH_SCORE_DISCLAIMER } from '../lib/matchDisclaimer';

/** Always-visible reminder that a match score is not a hiring probability. */
export function MatchScoreNotice({ text = MATCH_SCORE_DISCLAIMER, className = '' }: { text?: string; className?: string }) {
  return (
    <p className={`k-meta flex items-start gap-1.5 ${className}`} data-testid="match-score-notice">
      <FontAwesomeIcon icon={faCircleInfo} className="mt-[3px] shrink-0" aria-hidden="true" />
      <span>{text}</span>
    </p>
  );
}

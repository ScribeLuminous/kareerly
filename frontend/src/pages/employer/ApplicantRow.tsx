import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCheck, faChevronRight } from '@fortawesome/free-solid-svg-icons';
import {
  candidateDisplayName,
  candidateStatusBadgeClass,
  getInitials,
  getMatchBucket,
  MATCH_BAND_LABEL,
  matchBandBadgeClass,
  type CandidateApplication,
} from './model';

/**
 * One applicant as a list row: who (masked until Interviewing), the role,
 * score and band, one line of skill fit, and status. Opens the review.
 */
export function ApplicantRow({ candidate, onReview, showRole = true }: { candidate: CandidateApplication; onReview: (candidateId: string) => void; showRole?: boolean }) {
  const bucket = getMatchBucket(candidate.matchPercent, candidate.hasMatchScore);
  const name = candidateDisplayName(candidate);
  const matched = candidate.matchedSkills.length;
  const total = matched + candidate.missingSkills.length;
  return (
    <button
      className={`k-row items-start ${candidate.status === 'Withdrawn' ? 'opacity-70' : ''}`}
      type="button"
      onClick={() => onReview(candidate.id)}
      aria-label={`Review ${candidate.publicId || name}, ${candidate.role}`}
    >
      <span className="k-avatar mt-0.5 bg-tan text-dark" aria-hidden="true">{getInitials(candidate.fullName)}</span>
      <span className="k-row-main">
        <span className="k-label block truncate">{name}</span>
        <span className="k-meta k-dot-sep mt-0.5 block truncate">
          {candidate.publicId && <span>{candidate.publicId}</span>}
          {showRole && <span>{candidate.role}</span>}
        </span>
        {total > 0 && (
          <span className="k-secondary mt-1 block text-[13px]">
            <FontAwesomeIcon icon={faCheck} className="mr-1 text-green" aria-hidden="true" />
            {matched} of {total} skills
            {candidate.missingSkills.length > 0 && <span className="text-soft-text"> · Missing {candidate.missingSkills.slice(0, 2).join(', ')}{candidate.missingSkills.length > 2 ? ` +${candidate.missingSkills.length - 2}` : ''}</span>}
          </span>
        )}
        <span className="mt-1.5 flex flex-wrap gap-1.5">
          <span className={candidateStatusBadgeClass(candidate.status)}>{candidate.status}</span>
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        {candidate.hasMatchScore && <span className="k-score">{candidate.matchPercent}%</span>}
        <span className={matchBandBadgeClass(bucket)}>{MATCH_BAND_LABEL[bucket]}</span>
      </span>
      <FontAwesomeIcon className="k-row-chevron mt-1.5" icon={faChevronRight} aria-hidden="true" />
    </button>
  );
}

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronRight, faUser } from '@fortawesome/free-solid-svg-icons';
import type { CandidateAssessment } from '../../lib/assessmentApi';
import type { EvaluationSummary } from '../../lib/evaluationApi';
import { nextAction, profileMatch, profileMatchLabel, weightedRating, assessmentStatusLabel } from './evaluation';
import {
  applicantTitle,
  candidateStatusBadgeClass,
  formatDateLabel,
  getInitials,
  shouldRevealIdentity,
  type CandidateApplication,
  type EmployerJob,
} from './model';

type ApplicantRowProps = {
  candidate: CandidateApplication;
  job: EmployerJob | null;
  summary?: EvaluationSummary;
  assessment?: CandidateAssessment | null;
  hasRubric: boolean;
  onReview: (candidateId: string) => void;
  /** Show the job title (lists that mix jobs, such as Home). */
  showRole?: boolean;
};

/**
 * One applicant as a list row: who (masked until Interviewing), stage, last
 * activity, the two measures side by side in words, and the next step.
 */
export function ApplicantRow({ candidate, job, summary, assessment = null, hasRubric, onReview, showRole = false }: ApplicantRowProps) {
  const revealed = shouldRevealIdentity(candidate.status);
  const title = applicantTitle(candidate);
  const profile = profileMatch(candidate, job);
  const result = summary?.result || null;
  const action = nextAction(candidate.status, candidate.messageRequestState, result, hasRubric, summary?.myScorecard === 'submitted');
  const reviewed = !hasRubric
    ? 'No rubric'
    : !result || result.submittedScorecards === 0
      ? 'Not reviewed'
      : weightedRating(result.criteria) === null
        ? `Not assessed · ${result.assessedCount} of ${result.criteriaCount}`
        : `${weightedRating(result.criteria)?.toFixed(1)}/4 · ${result.assessedCount} of ${result.criteriaCount} assessed`;
  return (
    <button
      className={`k-row items-start ${candidate.status === 'Withdrawn' ? 'opacity-70' : ''}`}
      type="button"
      onClick={() => onReview(candidate.id)}
      aria-label={`Review ${title}, ${candidate.status}. Profile match ${profileMatchLabel(profile)}. Reviewed evaluation ${reviewed}. Assessment ${assessmentStatusLabel(assessment)}. Next: ${action.label}.`}
    >
      <span className="k-avatar mt-0.5 bg-tan text-dark" aria-hidden="true">
        {revealed ? getInitials(candidate.fullName) : <FontAwesomeIcon icon={faUser} />}
      </span>
      <span className="k-row-main" aria-hidden="true">
        <span className="flex flex-wrap items-center gap-2">
          <span className="k-label truncate">{title}</span>
          <span className={candidateStatusBadgeClass(candidate.status)}>{candidate.status}</span>
        </span>
        <span className="k-meta k-dot-sep mt-0.5 block truncate">
          {revealed && candidate.publicId && <span>{candidate.publicId}</span>}
          {showRole && <span>{candidate.role}</span>}
          <span>Applied {formatDateLabel(candidate.appliedDate)}</span>
          {candidate.lastActivity && <span>Active {formatDateLabel(candidate.lastActivity.slice(0, 10))}</span>}
        </span>
        <span className="mt-1.5 grid gap-x-4 gap-y-0.5 text-[13px] sm:grid-cols-2">
          <span className="k-secondary"><span className="text-soft-text">Profile match: </span>{profileMatchLabel(profile)}</span>
          <span className="k-secondary"><span className="text-soft-text">Reviewed evaluation: </span>{reviewed}</span>
        </span>
        {(candidate.status === 'Shortlisted' || assessment) && <span className="k-meta mt-1 block">Assessment: {assessmentStatusLabel(assessment)}</span>}
        {profile.notFound.length > 0 && (
          <span className="k-meta mt-0.5 block truncate">Not found in application: {profile.notFound.slice(0, 3).join(', ')}{profile.notFound.length > 3 ? ` +${profile.notFound.length - 3}` : ''}</span>
        )}
        <span className="mt-1 block text-[13px] font-semibold text-rust">Next: {action.label}</span>
      </span>
      <FontAwesomeIcon className="k-row-chevron mt-1.5" icon={faChevronRight} aria-hidden="true" />
    </button>
  );
}

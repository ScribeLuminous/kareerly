import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBookmark, faCheck, faXmark } from '@fortawesome/free-solid-svg-icons';
import {
  categoryBadgeClass,
  jobMetaParts,
  jobScore,
  jobSkillSummary,
  matchCategoryBadge,
  type ApplicationStatus,
  type DashboardJob,
} from './model';

type JobCardProps = {
  job: DashboardJob;
  applicationStatus: ApplicationStatus | null;
  isSaved: boolean;
  selected?: boolean;
  onOpen: () => void;
  onApply?: () => void;
  onSave?: () => void;
  headingLevel?: 'h2' | 'h3';
};

/**
 * The one job summary used across Kareerly: title, where, the score and
 * category, one line of skill fit, and the next action. Everything else lives
 * in the job detail.
 */
export function JobCard({ job, applicationStatus, isSaved, selected = false, onOpen, onApply, onSave, headingLevel = 'h3' }: JobCardProps) {
  const meta = jobMetaParts(job);
  const score = jobScore(job);
  const skills = jobSkillSummary(job);
  const hasSkillLine = job.hasMatchScore && skills.total > 0;
  const mismatches = job.hasMatchScore ? job.preferenceMismatches ?? [] : [];
  const Heading = headingLevel;
  const showApply = job.sourceType === 'internal' && !applicationStatus && onApply;
  return (
    <article className="k-job-card" aria-current={selected ? 'true' : undefined}>
      <div className="k-job-top">
        <div className="min-w-0">
          <Heading className="k-item-title">
            <button className="k-card-link" type="button" onClick={onOpen} aria-label={`${job.title}, view details`}>
              {job.title}
            </button>
          </Heading>
          {meta.length > 0 && <p className="k-meta k-dot-sep mt-0.5">{meta.map((part) => <span key={part}>{part}</span>)}</p>}
        </div>
        <div className="k-job-score">
          {score !== null ? (
            <>
              <span className="k-score">{score}%</span>
              <span className={categoryBadgeClass(job)}>{matchCategoryBadge(job)}</span>
            </>
          ) : (
            <span className="k-badge">Not matched</span>
          )}
        </div>
      </div>
      {(hasSkillLine || mismatches.length > 0) && (
        <div className="k-job-fit">
          {hasSkillLine && (
            <p className="k-secondary">
              <FontAwesomeIcon icon={faCheck} className="mr-1.5 text-green" aria-hidden="true" />
              {skills.matched} of {skills.total} skills
              {skills.missing.length > 0 && (
                <span className="text-soft-text"> · Needs {skills.missing.slice(0, 2).join(', ')}{skills.missing.length > 2 ? ` +${skills.missing.length - 2}` : ''}</span>
              )}
            </p>
          )}
          {mismatches.length > 0 && (
            <p className="k-secondary">
              <FontAwesomeIcon icon={faXmark} className="mr-1.5 text-rust" aria-hidden="true" />
              <span className="text-soft-text">Not what you chose: </span>
              {mismatches.map((item) => item.jobValue).join(' · ')}
            </p>
          )}
        </div>
      )}
      {(showApply || applicationStatus || onSave || job.sourceType === 'external') && (
        <div className="k-job-card-actions">
          {showApply && (
            <button className="k-btn k-btn-primary k-btn-sm" type="button" onClick={onApply}>Apply</button>
          )}
          {applicationStatus && (
            <span className="k-badge k-badge-success"><FontAwesomeIcon icon={faCheck} aria-hidden="true" />Applied · {applicationStatus}</span>
          )}
          {job.sourceType === 'external' && <span className="k-badge k-badge-outline">External site</span>}
          {onSave && (
            <button
              className="k-icon-btn"
              type="button"
              onClick={onSave}
              aria-pressed={isSaved}
              aria-label={isSaved ? `Remove ${job.title} from saved jobs` : `Save ${job.title}`}
              title={isSaved ? 'Saved' : 'Save'}
            >
              <FontAwesomeIcon icon={faBookmark} className={isSaved ? 'text-rust' : 'text-soft'} aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </article>
  );
}

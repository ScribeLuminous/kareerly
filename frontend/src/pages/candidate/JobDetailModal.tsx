import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowRight, faArrowUpRightFromSquare, faBookmark, faCheck, faCircleCheck, faBullseye } from '@fortawesome/free-solid-svg-icons';
import MatchFeedbackControls from '../../components/MatchFeedbackControls';
import { InfoTip, Modal, useMediaQuery, DESKTOP_QUERY } from '../../components/ui';
import { MatchScoreNotice } from '../../components/MatchScoreNotice';
import { MATCH_SCORE_DISCLAIMER } from '../../lib/matchDisclaimer';
import type { MatchFeedbackStatus, MatchVote } from '../../lib/matchFeedback';
import { formatJobDescription } from '../../lib/jobDescription';
import {
  buildJobExplanation,
  buildMatchReasons,
  categoryBadgeClass,
  cleanSkillDisplayName,
  externalJobUrl,
  formatDateLabel,
  getCareerGuidance,
  getConfidenceLabel,
  getLearningForJob,
  getMatchReadinessLabel,
  jobMetaParts,
  jobScore,
  knownValue,
  learningResourceUrl,
  matchCategoryBadge,
  normalizeSkill,
  splitSkillList,
  WITHDRAWABLE_STATUSES,
  type DashboardApplication,
  type DashboardCourse,
  type DashboardJob,
} from './model';

export type JobFeedback = { vote: MatchVote | null; status: MatchFeedbackStatus; onVote: (vote: MatchVote) => void };

type JobDetailProps = {
  job: DashboardJob;
  application: DashboardApplication | null;
  courses: DashboardCourse[];
  isSaved: boolean;
  onApply: () => void | Promise<void>;
  onWithdraw: (application: DashboardApplication) => void;
  onSave: () => void;
  onOpenLearning?: () => void;
  /** Omit where the application is already on screen (the Applications page). */
  onViewApplication?: (application: DashboardApplication) => void;
  feedback?: JobFeedback;
};


/** Score, category and readiness in one line, with the methodology behind ⓘ. */
export function JobScoreLine({ job, large = false }: { job: DashboardJob; large?: boolean }) {
  const score = jobScore(job);
  if (score === null) {
    return <p className="k-secondary">Match not available</p>;
  }
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className={`k-score ${large ? 'k-score-lg' : ''}`}>{score}%</span>
      <span className={categoryBadgeClass(job)}>{matchCategoryBadge(job)}</span>
      <span className="k-meta">{getMatchReadinessLabel(score)}</span>
      <InfoTip label="What the match percentage means" align="left">{MATCH_SCORE_DISCLAIMER}</InfoTip>
      {large && <MatchScoreNotice className="basis-full" />}
    </div>
  );
}

/** "Applied · status", shown across from the job title once the candidate has applied. */
export function AppliedBadge({ job, application }: Pick<JobDetailProps, 'job' | 'application'>) {
  if (!application || job.sourceType === 'external') return null;
  return (
    <span className="k-badge k-badge-success min-h-[32px] shrink-0 whitespace-nowrap px-3 text-sm">
      <FontAwesomeIcon icon={faCheck} aria-hidden="true" />Applied · {application.status}
    </span>
  );
}

export function JobActions({ job, application, isSaved, onApply, onWithdraw, onSave, onViewApplication }: Omit<JobDetailProps, 'courses' | 'feedback' | 'onOpenLearning'>) {
  const saveButton = (
    <button className="k-btn k-btn-secondary" type="button" onClick={onSave} aria-pressed={isSaved}>
      <FontAwesomeIcon icon={faBookmark} className={isSaved ? 'text-rust' : undefined} aria-hidden="true" />
      {isSaved ? 'Saved' : 'Save'}
    </button>
  );
  if (job.sourceType === 'external') {
    return (
      <div>
        <div className="k-detail-actions mt-0">
          <a className="k-btn k-btn-primary" href={externalJobUrl(job)} target="_blank" rel="noopener noreferrer">
            Visit job site<FontAwesomeIcon icon={faArrowUpRightFromSquare} aria-hidden="true" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
          {saveButton}
        </div>
        <p className="k-meta mt-2">Applications on other sites aren't tracked in Kareerly.</p>
      </div>
    );
  }
  const canWithdraw = Boolean(application && WITHDRAWABLE_STATUSES.includes(application.status));
  return (
    <div>
      <div className="k-detail-actions mt-0">
        {application ? (
          <>
            {onViewApplication && <button className="k-btn k-btn-secondary" type="button" onClick={() => onViewApplication(application)}>View application</button>}
            {canWithdraw && <button className="k-btn k-btn-ghost" type="button" onClick={() => onWithdraw(application)}>Withdraw</button>}
          </>
        ) : (
          <button className="k-btn k-btn-primary" type="button" onClick={() => void onApply()}>Apply</button>
        )}
        {saveButton}
      </div>
      {!application && <p className="k-meta mt-2">Your match score never stops you from applying.</p>}
    </div>
  );
}

export function JobDetailBody({ job, courses, onOpenLearning, feedback }: Pick<JobDetailProps, 'job' | 'courses' | 'onOpenLearning' | 'feedback'>) {
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const matched = splitSkillList(job.matchedSkills);
  const missing = splitSkillList(job.missingSkills);
  const missingKeys = new Set(missing.map(normalizeSkill));
  const missingNice = splitSkillList(job.missingPreferredSkills || []).filter((skill) => !missingKeys.has(normalizeSkill(skill)));
  const required = splitSkillList(job.requiredSkills);
  const preferred = splitSkillList([...job.preferredSkills, ...(job.niceToHaveSkills || [])]);
  const hasFit = job.hasMatchScore && (matched.length > 0 || missing.length > 0 || missingNice.length > 0);
  const reasons = buildMatchReasons(job, job.requiredSkills.length > 0 ? job.requiredSkills : [...job.matchedSkills, ...job.missingSkills]);
  const learning = getLearningForJob(job, courses).slice(0, 2);
  const facts = [
    { label: 'Level', value: knownValue(job.jobLevel) },
    { label: 'Employment', value: knownValue(job.employmentType) },
    { label: 'Work setup', value: knownValue(job.setup) },
    { label: 'Location', value: knownValue(job.location) },
    { label: 'Salary', value: knownValue(job.salary) },
    { label: 'Category', value: knownValue(job.category) },
    { label: 'Posted', value: job.createdAt ? formatDateLabel(job.createdAt) : '' },
  ].filter((fact) => fact.value);
  const description = job.description?.trim() ? formatJobDescription(job.description) : '';
  const qualifications = job.qualifications ?? [];

  return (
    <>
      <section className="k-detail-section" aria-label="Your fit">
        <h3>Your fit</h3>
        <p className="k-prose">{job.explanation?.trim() || buildJobExplanation(job)}</p>
        {hasFit ? (
          <div className="mt-3 space-y-3">
            {matched.length > 0 && (
              <div>
                <div className="k-meta mb-1.5">You have</div>
                <div className="k-chip-row gap-1.5">
                  {matched.map((skill) => (
                    <span key={`have-${skill}`} className="k-skill k-skill-have"><FontAwesomeIcon icon={faCheck} aria-hidden="true" />{skill}</span>
                  ))}
                </div>
              </div>
            )}
            {(missing.length > 0 || missingNice.length > 0) && (
              <div>
                <div className="k-meta mb-1.5">To build</div>
                <div className="k-chip-row gap-1.5">
                  {missing.map((skill) => <span key={`miss-${skill}`} className="k-skill k-skill-missing">{skill}<span className="sr-only"> (required)</span></span>)}
                  {missingNice.map((skill) => <span key={`nice-${skill}`} className="k-skill k-skill-nice">{skill}<span className="k-meta">· nice to have</span></span>)}
                </div>
              </div>
            )}
          </div>
        ) : (required.length > 0 || preferred.length > 0) && (
          <div className="mt-3 space-y-3">
            {required.length > 0 && (
              <div>
                <div className="k-meta mb-1.5">Required skills</div>
                <div className="k-chip-row gap-1.5">{required.map((skill) => <span key={`req-${skill}`} className="k-skill">{skill}</span>)}</div>
              </div>
            )}
            {preferred.length > 0 && (
              <div>
                <div className="k-meta mb-1.5">Nice to have</div>
                <div className="k-chip-row gap-1.5">{preferred.map((skill) => <span key={`pref-${skill}`} className="k-skill k-skill-nice">{skill}</span>)}</div>
              </div>
            )}
          </div>
        )}
        <details className="mt-3">
          <summary className="k-link cursor-pointer">Why this score</summary>
          {reasons.length > 0 && (
            <ul className="k-reasons">
              {reasons.map((reason) => (
                <li key={reason.text} className={reason.tone}>
                  <FontAwesomeIcon icon={reason.tone === 'strength' ? faCircleCheck : faBullseye} aria-hidden="true" />
                  <span>{reason.text}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="k-secondary mt-2">{getCareerGuidance(job)}</p>
          <p className="k-meta mt-2">Confidence: {getConfidenceLabel(job)}</p>
        </details>
      </section>

      {(learning.length > 0 || (onOpenLearning && missing.length > 0)) && (
        <section className="k-detail-section" aria-label="Learn next">
          <h3>Learn next</h3>
          {learning.length > 0 && (
            <ul className="k-list">
              {learning.map((course) => {
                const url = learningResourceUrl(course);
                const meta = [course.provider, course.level, course.duration, course.isFree ? 'Free' : ''].map((value) => knownValue(value)).filter(Boolean);
                return (
                  <li key={course.id} className="k-row">
                    <div className="k-row-main">
                      <div className="k-label">{course.title}</div>
                      <div className="k-meta k-dot-sep mt-0.5">{meta.map((item) => <span key={item}>{item}</span>)}</div>
                      <div className="k-meta mt-0.5">For {cleanSkillDisplayName(course.gapTag) || 'this role'}</div>
                    </div>
                    {url && (
                      <a className="k-btn k-btn-secondary k-btn-sm" href={url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${course.title} (opens in a new tab)`}>
                        Open<FontAwesomeIcon icon={faArrowUpRightFromSquare} aria-hidden="true" />
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {onOpenLearning && (
            <button className="k-link mt-3" type="button" onClick={onOpenLearning}>
              All learning for this job<FontAwesomeIcon icon={faArrowRight} aria-hidden="true" />
            </button>
          )}
        </section>
      )}

      <details className="k-detail-section" open={isDesktop}>
        <summary>About the role</summary>
        <div className="k-prose">
          {description ? <div className="whitespace-pre-wrap">{description}</div> : job.responsibilities.length === 0 && qualifications.length === 0 && <p>The employer hasn't shared a full description yet.</p>}
          {job.responsibilities.length > 0 && (
            <>
              <p className="k-label mt-3">What you'll do</p>
              <ul>{job.responsibilities.map((item) => <li key={item}>{item}</li>)}</ul>
            </>
          )}
          {qualifications.length > 0 && (
            <>
              <p className="k-label mt-3">Qualifications</p>
              <ul>{qualifications.map((item) => <li key={item}>{item}</li>)}</ul>
            </>
          )}
        </div>
      </details>

      {facts.length > 0 && (
        <details className="k-detail-section" open={isDesktop}>
          <summary>Details</summary>
          <dl className="k-facts">
            {facts.map((fact) => (
              <div key={fact.label}>
                <dt>{fact.label}</dt>
                <dd>{fact.value}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}

      {feedback && job.hasMatchScore && !job.closestMatch && (
        <section className="k-detail-section border-t border-bdr" aria-label="Rate this match">
          <MatchFeedbackControls jobTitle={job.title} vote={feedback.vote} status={feedback.status} onVote={feedback.onVote} />
        </section>
      )}
    </>
  );
}

/** Inline detail used in the desktop split view. */
export function JobDetailPanel(props: JobDetailProps) {
  const { job } = props;
  const meta = jobMetaParts(job);
  return (
    <article className="k-split-detail k-detail" aria-label={`${job.title} details`}>
      <header className="k-detail-header">
        <div className="flex items-start justify-between gap-3">
          <h2 className="k-page-title min-w-0 text-[22px] leading-7">{job.title}</h2>
          <AppliedBadge job={job} application={props.application} />
        </div>
        {meta.length > 0 && <p className="k-secondary k-dot-sep mt-1">{meta.map((part) => <span key={part}>{part}</span>)}</p>}
        <div className="mt-3"><JobScoreLine job={job} large /></div>
        <div className="mt-4"><JobActions {...props} /></div>
      </header>
      <div className="k-detail-scroll">
        <JobDetailBody job={job} courses={props.courses} onOpenLearning={props.onOpenLearning} feedback={props.feedback} />
      </div>
    </article>
  );
}

/** Full-screen on phones, a large dialog elsewhere. */
export function JobDetailModal(props: JobDetailProps & { onClose: () => void }) {
  const { job, onClose } = props;
  const meta = jobMetaParts(job);
  return (
    <Modal
      title={job.title}
      subtitle={meta.length > 0 ? <span className="k-dot-sep">{meta.map((part) => <span key={part}>{part}</span>)}</span> : undefined}
      onClose={onClose}
      size="lg"
      fullOnMobile
      closeStyle="back"
      closeLabel="Close job details"
      headerActions={props.application && job.sourceType !== 'external' ? <div className="hidden pt-1.5 sm:mr-2 sm:block"><AppliedBadge job={job} application={props.application} /></div> : undefined}
      footer={<div className="w-full"><JobActions {...props} /></div>}
    >
      {/* Phones have no room beside the title, so the badge leads the body instead. */}
      {props.application && job.sourceType !== 'external' && <div className="mb-3 sm:hidden"><AppliedBadge job={job} application={props.application} /></div>}
      <JobScoreLine job={job} large />
      <JobDetailBody job={job} courses={props.courses} onOpenLearning={props.onOpenLearning} feedback={props.feedback} />
    </Modal>
  );
}

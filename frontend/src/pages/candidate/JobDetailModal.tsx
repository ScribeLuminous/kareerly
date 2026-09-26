import { formatJobDescription } from '../../lib/jobDescription';
import { buildJobExplanation, buildMatchReasons, cleanSkillDisplayName, displayOrDash, getCareerGuidance, getConfidenceLabel, getLearningForJob, getMatchBadgeLabel, getMatchReadinessClass, grantsCredential, learningResourceUrl, matchCategoryBadge, normalizeSkill, type DashboardApplication, type DashboardCourse, type DashboardJob } from './model';
import { UIIcon } from './icons';

export function JobDetailModal({
  job,
  application,
  courses,
  isSaved,
  onClose,
  onApply,
  onWithdraw,
  onSave,
}: {
  job: DashboardJob;
  application: DashboardApplication | null;
  courses: DashboardCourse[];
  isSaved: boolean;
  onClose: () => void;
  onApply: () => void | Promise<void>;
  onWithdraw: (application: DashboardApplication) => void;
  onSave: () => void;
}) {
  const canWithdraw = application && ['Pending', 'Shortlisted', 'Interviewing'].includes(application.status);
  const learningResources = getLearningForJob(job, courses);
  const confidence = getConfidenceLabel(job);
  const requiredSkills = job.requiredSkills.length > 0 ? job.requiredSkills : [...job.matchedSkills, ...job.missingSkills];
  const preferredSkills = job.preferredSkills.length > 0 ? job.preferredSkills : job.niceToHaveSkills || [];
  const matchReasons = buildMatchReasons(job, requiredSkills);
  const matchedKeys = new Set(job.matchedSkills.map(normalizeSkill));
  const score = job.hasMatchScore ? Math.max(0, Math.min(100, Math.round(job.matchScore))) : 0;
  const readinessClass = job.hasMatchScore ? getMatchReadinessClass(job.matchScore) : 'develop';
  const details = [
    { label: 'Level', value: job.jobLevel },
    { label: 'Employment', value: job.employmentType },
    { label: 'Work Setup', value: job.setup },
    { label: 'Location', value: job.location },
    { label: 'Salary', value: job.salary },
    { label: 'Category', value: job.category },
  ].map((item) => ({ ...item, value: displayOrDash(item.value) }));

  return (
    <div className="cand-modal-overlay" onClick={onClose}>
      <div className="cand-modal-box lg cand-jd" onClick={(event) => event.stopPropagation()}>
        <div className="cand-modal-header cand-jd-header">
          <div>
            <div className="cand-modal-title">{job.title}</div>
            <div className="cand-modal-subtitle">{job.company}</div>
            <div className="cand-jd-tags">
              <span className={`cand-match-cat ${job.matchCategory === 'fit-now' ? 'cand-cat-fit' : 'cand-cat-aspiration'}`}>
                {job.hasMatchScore ? matchCategoryBadge(job) : 'Match not available'}
              </span>
              <span className={`cand-type-tag ${job.sourceType === 'internal' ? 'cand-type-internal' : 'cand-type-external'}`}>
                {job.sourceType === 'internal' ? 'Internal' : 'External'}
              </span>
            </div>
          </div>
          <button className="cand-modal-close cand-jd-close" type="button" onClick={onClose} aria-label="Close job details">
            <UIIcon name="close" />
          </button>
        </div>

        <section className={`cand-jd-why ${readinessClass}`} aria-labelledby={`${job.id}-why-title`}>
          <div className="cand-jd-why-top">
            <div className="cand-jd-score" style={{ ['--score' as string]: `${score}` }} aria-hidden="true">
              <span>{job.hasMatchScore ? `${score}%` : '—'}</span>
            </div>
            <div className="min-w-0">
              <h3 id={`${job.id}-why-title`} className="cand-jd-why-title">Why this job matches you</h3>
              <div className="cand-jd-why-meta">
                {getMatchBadgeLabel(job)} · Confidence: {confidence}
              </div>
            </div>
          </div>
          <p className="cand-jd-why-summary">{job.explanation?.trim() || buildJobExplanation(job)}</p>
          {matchReasons.length > 0 && (
            <ul className="cand-jd-reasons">
              {matchReasons.map((reason) => (
                <li key={`${job.id}-reason-${reason.text}`} className={reason.tone}>
                  <UIIcon name={reason.tone === 'strength' ? 'check-circle' : 'target'} className="cand-jd-reason-icon" />
                  <span>{reason.text}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {details.length > 0 && (
          <dl className="cand-jd-details">
            {details.map((item) => (
              <div key={`${job.id}-detail-${item.label}`}>
                <dt>{item.label}</dt>
                <dd>{item.value?.replace(/\//g, '/\u200b')}</dd>
              </div>
            ))}
          </dl>
        )}

        <section className="cand-jd-section">
          <h4 className="cand-jd-heading">Job Description</h4>
          <div className="cand-jd-text whitespace-pre-wrap">
            {job.description?.trim() ? formatJobDescription(job.description) : 'Full job description is not available yet for this listing, but you can still explore the role details and personalized guidance below.'}
          </div>
        </section>

        <section className="cand-jd-section">
          <h4 className="cand-jd-heading">Responsibilities</h4>
          {job.responsibilities.length > 0 ? (
            <ul className="cand-bullet-list cand-jd-text">
              {job.responsibilities.map((item) => (
                <li key={`${job.id}-resp-${item}`}>{item}</li>
              ))}
            </ul>
          ) : (
            <div className="cand-jd-empty">Responsibilities have not yet been provided by the employer.</div>
          )}
        </section>

        <section className="cand-jd-section">
          <h4 className="cand-jd-heading">Your Matching Strengths</h4>
          <div className="cand-skill-row">
            {job.matchedSkills.map((skill) => (
              <span key={`${job.id}-jd-m-${skill}`} className="cand-skill-match">
                <UIIcon name="check-circle" className="cand-chip-icon" />
                {cleanSkillDisplayName(skill)}
              </span>
            ))}
            {job.matchedSkills.length === 0 && <span className="cand-jd-empty">Matched skills not detected yet.</span>}
          </div>
        </section>

        <section className="cand-jd-section">
          <h4 className="cand-jd-heading">Skills for This Role</h4>
          <div className="cand-jd-sublabel">Required</div>
          <div className="cand-skill-row">
            {requiredSkills.length > 0 ? requiredSkills.map((skill) => (
              <span key={`${job.id}-req-${skill}`} className={matchedKeys.has(normalizeSkill(skill)) ? 'cand-skill-match' : 'cand-jd-chip'}>{cleanSkillDisplayName(skill)}</span>
            )) : <span className="cand-jd-empty">Required skills have not yet been provided by the employer.</span>}
          </div>
          <div className="cand-jd-sublabel">Preferred</div>
          <div className="cand-skill-row">
            {preferredSkills.length > 0 ? preferredSkills.map((skill) => (
              <span key={`${job.id}-pref-${skill}`} className="cand-skill-nice">{cleanSkillDisplayName(skill)}</span>
            )) : <span className="cand-jd-empty">Preferred skills have not yet been provided by the employer.</span>}
          </div>
        </section>

        <section className="cand-jd-section">
          <h4 className="cand-jd-heading">Skills to Improve</h4>
          <div className="cand-skill-row">
            {job.missingSkills.slice(0, 8).map((skill, index) => (
              <span key={`${job.id}-jd-g-${skill}`} className="cand-skill-miss">
                {index === 0 ? 'Critical: ' : index <= 2 ? 'High: ' : 'Medium: '}
                {cleanSkillDisplayName(skill)}
              </span>
            ))}
            {job.missingSkills.length === 0 && <span className="cand-jd-empty">No major missing skills detected for this role.</span>}
          </div>
        </section>

        <section className="cand-jd-section">
          <h4 className="cand-jd-heading">Recommended Learning</h4>
          {learningResources.length > 0 ? (
            learningResources.map((course) => (
              <div key={`${job.id}-learn-${course.id}`} className="cand-jd-course">
                <UIIcon name="graduation" className="cand-inline-info-icon" />
                <div>
                  <strong>{course.title}</strong>
                  <div className="text-xs text-mid">
                    {course.provider} · {course.level} · {course.duration} · {course.fees} ·{' '}
                    <span className={grantsCredential(course.credentialType) ? 'cand-credential-yes' : 'cand-credential-no'}>{course.credentialLabel}</span>
                  </div>
                  <div className="text-xs text-mid">This learning resource supports {cleanSkillDisplayName(course.gapTag)}, one of the skills connected to this role.</div>
                  {learningResourceUrl(course) ? (
                    <a className="cand-btn-secondary cand-btn-sm mt-2" href={learningResourceUrl(course)} target="_blank" rel="noopener noreferrer" aria-label={`${course.urlLabel}: ${course.title} (opens in a new tab)`}>{course.urlLabel}</a>
                  ) : <span className="text-xs text-soft-text">Provider link unavailable</span>}
                  <p className="text-xs text-soft-text">The provider manages learning and certificates. Kareerly does not verify completion; opening this resource does not change skills, readiness, or match scores.</p>
                </div>
              </div>
            ))
          ) : (
            <div className="cand-jd-empty">No learning resources are available yet for this role's current skill gaps.</div>
          )}
        </section>

        <section className="cand-jd-section">
          <h4 className="cand-jd-heading">Career Guidance</h4>
          <div className="cand-explain cand-jd-guidance"><UIIcon name="lightbulb" className="cand-inline-info-icon" />{getCareerGuidance(job)}</div>
        </section>

        {job.sourceType === 'internal' ? (
          <div className="cand-modal-actions cand-jd-actions">
            {application ? (
              <>
                <button className="cand-btn-primary" type="button" disabled>
                  Applied ✓
                </button>
                {canWithdraw && (
                  <button className="cand-btn-secondary" type="button" onClick={() => onWithdraw(application)}>
                    Withdraw Application
                  </button>
                )}
              </>
            ) : (
              <button className="cand-btn-primary" type="button" onClick={onApply}>
                <UIIcon name="paper-plane" className="cand-btn-icon" />Apply Now
              </button>
            )}
            <button className="cand-btn-secondary" type="button" onClick={onSave}>
              <UIIcon name="bookmark" className="cand-btn-icon" />{isSaved ? 'Saved' : 'Save Job'}
            </button>
            <button className="cand-btn-secondary" type="button" onClick={onClose}>
              Back to Matches
            </button>
          </div>
        ) : (
          <>
            <div className="cand-notice warn">
              <span>This is an external opportunity. In-platform application tracking, withdrawal, and messaging are not available.</span>
            </div>
            <div className="cand-modal-actions cand-jd-actions">
              <button
                className="cand-btn-primary"
                type="button"
                onClick={() => {
                  const fallbackQuery = encodeURIComponent(`${job.title} ${job.company} jobs`);
                  const targetUrl = job.externalUrl || `https://www.google.com/search?q=${fallbackQuery}`;
                  window.open(targetUrl, '_blank', 'noopener,noreferrer');
                }}
              >
                <UIIcon name="external" className="cand-btn-icon" />Visit Job Site
              </button>
              <button className="cand-btn-secondary" type="button" onClick={onSave}>
                <UIIcon name="bookmark" className="cand-btn-icon" />{isSaved ? 'Saved' : 'Save Job'}
              </button>
              <button className="cand-btn-secondary" type="button" onClick={onClose}>
                Back to Matches
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

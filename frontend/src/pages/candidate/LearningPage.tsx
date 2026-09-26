import { useRef, useState } from 'react';
import { cleanSkillDisplayName, getCourseSkillLabels, getLearningForJob, getProgressStatusLabel, learningResourceUrl, normalizeSkill, orderByBackendRank, severityClass, type CourseCompletion, type DashboardCourse, type DashboardGap, type DashboardJob, type SkillProgressRecord, type UpskillTab } from './model';
import { UIIcon } from './icons';

export function LearningEmptyState({
  title,
  description,
  primaryAction,
  secondaryAction,
}: {
  title: string;
  description: string;
  primaryAction?: { label: string; onClick: () => void };
  secondaryAction?: { label: string; onClick: () => void };
}) {
  return (
    <section className="cand-learning-empty" aria-live="polite">
      <h2>{title}</h2>
      <p>{description}</p>
      {(primaryAction || secondaryAction) && (
        <div className="cand-actions cand-learning-empty-actions">
          {primaryAction && <button className="cand-btn-primary cand-btn-sm" type="button" onClick={primaryAction.onClick}>{primaryAction.label}</button>}
          {secondaryAction && <button className="cand-btn-secondary cand-btn-sm" type="button" onClick={secondaryAction.onClick}>{secondaryAction.label}</button>}
        </div>
      )}
    </section>
  );
}

export type CourseCompletionActions = {
  courseCompletions: Record<string, CourseCompletion>;
  onMarkCourseTaken: (course: DashboardCourse) => void;
  onUnmarkCourseTaken: (course: DashboardCourse) => void;
  onUploadCourseEvidence: (course: DashboardCourse) => void;
};

export function UpskillingPage({ tab, courses, jobs, gaps, skillProgressRecords, courseCompletions, onMarkCourseTaken, onUnmarkCourseTaken, onUploadCourseEvidence, onTab, onOpenSkillGaps, onOpenJobMatches }: CourseCompletionActions & {
  tab: UpskillTab;
  courses: DashboardCourse[];
  jobs: DashboardJob[];
  gaps: DashboardGap[];
  skillProgressRecords: Record<string, SkillProgressRecord>;
  onTab: (tab: UpskillTab) => void;
  onOpenSkillGaps: () => void;
  onOpenJobMatches: () => void;
}) {
  // Every match is listed, grouped by type, so each Fit-Now match can be focused.
  const jobGroups = [
    { label: 'Fit-Now matches', items: orderByBackendRank(jobs.filter((job) => job.matchCategory === 'fit-now')) },
    { label: 'Closest matches', items: jobs.filter((job) => job.matchCategory === 'aspiration' && job.closestMatch) },
    { label: 'Aspiration matches', items: orderByBackendRank(jobs.filter((job) => job.matchCategory === 'aspiration' && !job.closestMatch)) },
  ].filter((group) => group.items.length > 0);
  const [selectedJobId, setSelectedJobId] = useState(jobGroups[0]?.items[0]?.id || '');
  const [selectedSkill, setSelectedSkill] = useState('all');
  const jobSelectRef = useRef<HTMLSelectElement>(null);
  const selectedJob = jobs.find((job) => job.id === selectedJobId) || jobGroups[0]?.items[0];
  const visibleCourses = selectedJob ? getLearningForJob(selectedJob, courses) : [];
  // Required gaps first, then nice-to-have gaps (the Skill Gaps page lists both).
  const skillsToDevelop = Array.from(new Set([...(selectedJob?.missingSkills || []), ...(selectedJob?.missingPreferredSkills || [])].map(cleanSkillDisplayName).filter(Boolean)));
  const selectedSkillGap = (skill: string) => gaps.find((gap) => normalizeSkill(gap.skill) === normalizeSkill(skill));
  const learningTabOrder: UpskillTab[] = ['recommended', 'by-gap'];
  const handleLearningTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = learningTabOrder.indexOf(tab);
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? learningTabOrder.length - 1
        : (currentIndex + (event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1) + learningTabOrder.length) % learningTabOrder.length;
    const nextTab = learningTabOrder[nextIndex];
    onTab(nextTab);
    window.setTimeout(() => document.getElementById(`learning-tab-${nextTab}`)?.focus(), 0);
  };
  const filteredCourses = selectedSkill === 'all'
    ? visibleCourses
    : visibleCourses.filter((course) => getCourseSkillLabels(course).some((skill) => normalizeSkill(skill) === normalizeSkill(selectedSkill)));
  const groups = skillsToDevelop.map((skill) => ({
    skill,
    gap: selectedSkillGap(skill),
    resources: filteredCourses.filter((course) => getCourseSkillLabels(course).some((mapped) => normalizeSkill(mapped) === normalizeSkill(skill))),
  })).filter((group) => selectedSkill === 'all' || normalizeSkill(group.skill) === normalizeSkill(selectedSkill));

  const focusAnotherJob = () => jobSelectRef.current?.focus();
  const completionActions: CourseCompletionActions = { courseCompletions, onMarkCourseTaken, onUnmarkCourseTaken, onUploadCourseEvidence };
  const renderCourse = (course: DashboardCourse) => (
    <CourseCard key={course.id} course={course} selectedJob={selectedJob} gaps={gaps} skillProgressRecords={skillProgressRecords} {...completionActions} />
  );
  // Resources gathered for the candidate's other matches, shown when this job has none.
  const otherCourses = visibleCourses.length === 0 ? courses.slice(0, 6) : [];
  const selectedJobHasGaps = Boolean(selectedJob && skillsToDevelop.length > 0);
  const noResourceForSelection = selectedJobHasGaps && filteredCourses.length === 0;

  return (
    <div>
      <div className="cand-page-header">
        <div className="cand-learning-header-row">
          <div>
            <h1 className="cand-page-title">Learning Recommendations</h1>
            <p className="cand-page-subtitle">Explore recommended resources for the skills you want to develop.</p>
          </div>
          <button className="cand-inline-link" type="button" onClick={onOpenSkillGaps}>← View Skill Gaps</button>
        </div>
      </div>

      <section className="cand-learning-toolbar" aria-label="Learning recommendation controls">
        <div className="cand-learning-focus">
          <label id="learning-focus-heading" htmlFor="learning-target-job">Focus job</label>
          <select
            ref={jobSelectRef}
            id="learning-target-job"
            value={selectedJob?.id || ''}
            disabled={jobs.length === 0}
            onChange={(event) => { setSelectedJobId(event.target.value); setSelectedSkill('all'); }}
          >
            {jobs.length === 0 && <option value="">No matched jobs available</option>}
            {jobGroups.map((group) => (
              <optgroup key={group.label} label={`${group.label} (${group.items.length})`}>
                {group.items.map((job) => <option key={job.id} value={job.id}>{job.title} — {job.company}{job.hasMatchScore ? ` · ${job.matchScore}%` : ''}</option>)}
              </optgroup>
            ))}
          </select>
        </div>

        <div className="cand-tab-row cand-gap-view-tabs cand-skill-gap-tabs cand-learning-tabs" role="tablist" aria-label="Learning recommendation views">
          <button
            id="learning-tab-recommended"
            className={`cand-tab-btn ${tab === 'recommended' ? 'active' : ''}`}
            type="button"
            role="tab"
            aria-selected={tab === 'recommended'}
            aria-controls="learning-panel-recommended"
            tabIndex={tab === 'recommended' ? 0 : -1}
            onClick={() => onTab('recommended')}
            onKeyDown={handleLearningTabKeyDown}
          >
            <UIIcon name="book" className="cand-tab-icon" />What to Learn Next
          </button>
          <button
            id="learning-tab-by-gap"
            className={`cand-tab-btn ${tab === 'by-gap' ? 'active' : ''}`}
            type="button"
            role="tab"
            aria-selected={tab === 'by-gap'}
            aria-controls="learning-panel-by-gap"
            tabIndex={tab === 'by-gap' ? 0 : -1}
            onClick={() => onTab('by-gap')}
            onKeyDown={handleLearningTabKeyDown}
          >
            <UIIcon name="list" className="cand-tab-icon" />By Skill Gap
          </button>
        </div>
      </section>

      {selectedJobHasGaps && (
        <section className="cand-learning-skills" aria-labelledby="skills-to-develop-heading">
          <div className="cand-learning-section-heading">
            <h2 id="skills-to-develop-heading">Skills to Develop</h2>
            <span>Areas to work on for this job match.</span>
          </div>
          <div className="cand-learning-skill-list">
            {skillsToDevelop.map((skill) => {
              const gap = selectedSkillGap(skill);
              return (
                <button
                  key={skill}
                  className={`cand-learning-skill-chip ${selectedSkill === skill ? 'active' : ''}`}
                  type="button"
                  onClick={() => setSelectedSkill((current) => current === skill ? 'all' : skill)}
                  aria-pressed={selectedSkill === skill}
                >
                  {gap && <span>{gap.severity} · </span>}{skill}
                </button>
              );
            })}
          </div>
          <div className="cand-learning-filter-row" aria-label="Filter resources by skill">
            <span>Filter resources:</span>
            <button className={`cand-learning-filter ${selectedSkill === 'all' ? 'active' : ''}`} type="button" onClick={() => setSelectedSkill('all')} aria-pressed={selectedSkill === 'all'}>All</button>
            {skillsToDevelop.map((skill) => <button key={`filter-${skill}`} className={`cand-learning-filter ${selectedSkill === skill ? 'active' : ''}`} type="button" onClick={() => setSelectedSkill(skill)} aria-pressed={selectedSkill === skill}>{skill}</button>)}
          </div>
        </section>
      )}

      <div id={tab === 'recommended' ? 'learning-panel-recommended' : 'learning-panel-by-gap'} role="tabpanel" aria-labelledby={`learning-tab-${tab}`} tabIndex={0}>
      {jobs.length === 0 ? (
        <LearningEmptyState
          title="No learning recommendations yet"
          description="Generate job matches first so Kareerly can identify skill gaps and recommend relevant learning resources."
          primaryAction={{ label: 'View Job Matches', onClick: onOpenJobMatches }}
        />
      ) : !selectedJobHasGaps ? (
        <LearningEmptyState
          title="No skills to develop identified"
          description="This job does not currently have prioritized missing skills for your profile."
          primaryAction={{ label: 'Choose Another Job', onClick: focusAnotherJob }}
          secondaryAction={{ label: 'View Skill Gaps', onClick: onOpenSkillGaps }}
        />
      ) : noResourceForSelection ? (
        <>
          <LearningEmptyState
            title={selectedSkill === 'all' ? 'No learning resources found for this job yet' : 'No learning resources found for this skill yet'}
            description={otherCourses.length > 0
              ? 'Update your resume or rerun matching to refresh recommendations. Meanwhile, here are resources gathered for your other matches.'
              : 'Update your resume or rerun matching to refresh recommendations, or check again when the learning catalog is updated.'}
            primaryAction={selectedSkill === 'all' ? { label: 'Choose Another Job', onClick: focusAnotherJob } : { label: 'Show All Skills', onClick: () => setSelectedSkill('all') }}
          />
          {otherCourses.length > 0 && selectedSkill === 'all' && (
            <section className="cand-learning-results" aria-labelledby="other-learning-heading">
              <div className="cand-learning-section-heading">
                <h2 id="other-learning-heading">From Your Other Matches</h2>
                <span>Certifications and courses gathered for your other skill gaps.</span>
              </div>
              <div className="cand-course-grid">{otherCourses.map(renderCourse)}</div>
              <LearningProviderNote />
            </section>
          )}
        </>
      ) : tab === 'recommended' ? (
        <section className="cand-learning-results" aria-labelledby="what-to-learn-heading">
          <div className="cand-learning-section-heading">
            <h2 id="what-to-learn-heading">What to Learn Next</h2>
            <span>Suggested resources for your current skill gaps.</span>
          </div>
          <div className="cand-course-grid">
            {filteredCourses.map(renderCourse)}
          </div>
          <LearningProviderNote />
        </section>
      ) : (
        <section className="cand-learning-results" aria-labelledby="by-skill-gap-heading">
          <div className="cand-learning-section-heading">
            <h2 id="by-skill-gap-heading">By Skill Gap</h2>
            <span>Suggested options organized around the skills you want to develop.</span>
          </div>
          <div className="cand-learning-gap-groups">
            {groups.map(({ skill, gap, resources }) => (
              <section key={skill} className="cand-learning-gap-group" aria-labelledby={`learning-gap-${normalizeSkill(skill).replace(/[^a-z0-9]+/g, '-')}`}>
                <div className="cand-learning-gap-heading">
                  <div>
                    <h3 id={`learning-gap-${normalizeSkill(skill).replace(/[^a-z0-9]+/g, '-')}`}>{skill}</h3>
                    <div className="cand-learning-gap-meta">
                      {gap && <span className={`cand-gap-priority ${severityClass(gap.severity)}`}>{gap.severity} Priority</span>}
                      <span>{resources.length} recommended resource{resources.length === 1 ? '' : 's'}</span>
                    </div>
                  </div>
                </div>
                {resources.length > 0 ? (
                  <div className="cand-course-grid">{resources.map(renderCourse)}</div>
                ) : <p className="cand-learning-no-resource">No learning resources found for this skill yet.</p>}
              </section>
            ))}
          </div>
          <LearningProviderNote />
        </section>
      )}
      </div>
    </div>
  );
}

export function LearningProviderNote() {
  return <p className="cand-learning-provider-note"><UIIcon name="external" className="cand-mini-icon" />Resources open on their providers’ websites. Kareerly recommends resources based on identified skill gaps but does not verify enrollment, course completion, assessments, or certificates. Uploaded proof stays pending verification.</p>;
}

export function CourseCard({ course, selectedJob, gaps, skillProgressRecords, courseCompletions, onMarkCourseTaken, onUnmarkCourseTaken, onUploadCourseEvidence }: CourseCompletionActions & { course: DashboardCourse; selectedJob?: DashboardJob; gaps: DashboardGap[]; skillProgressRecords: Record<string, SkillProgressRecord> }) {
  const url = learningResourceUrl(course);
  const mappedSkills = getCourseSkillLabels(course);
  const primarySkill = mappedSkills[0] || cleanSkillDisplayName(course.gapTag) || 'This skill gap';
  const primaryGap = gaps.find((gap) => mappedSkills.some((skill) => normalizeSkill(skill) === normalizeSkill(gap.skill)));
  const progressRecord = mappedSkills.map((skill) => Object.values(skillProgressRecords).find((record) => normalizeSkill(record.skillName) === normalizeSkill(skill))).find(Boolean);
  const completion = courseCompletions[course.id];
  const isKnown = (value: string | undefined): value is string => Boolean(value && !/unknown|not stated|not specified/i.test(value));
  const metadata = [course.level, course.deliveryMode, course.duration, course.isFree ? 'Free' : course.fees].filter(isKnown);
  const recommendationReason = primaryGap && selectedJob
    ? `${primarySkill} is a ${primaryGap.severity} gap for your ${selectedJob.title} match.`
    : selectedJob
      ? `${primarySkill} is an identified skill gap for your ${selectedJob.title} match.`
      : `This resource addresses your ${primarySkill} skill gap.`;
  const isCertification = ['industry_certification', 'professional_certificate'].includes(course.credentialType) || course.urlLabel === 'View certification';

  return (
    <div className={`cand-course-card ${completion ? 'is-taken' : ''}`}>
      <div className="cand-course-top">
        <div className="cand-provider-badge">{course.provider.slice(0, 2).toUpperCase()}</div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-dark">{course.title}</h3>
          <div className="text-xs text-soft-text">{course.provider}{isCertification ? ' · Certification' : ''}</div>
        </div>
        <button
          className={`cand-course-taken-toggle ${completion ? 'active' : ''}`}
          type="button"
          aria-pressed={Boolean(completion)}
          aria-label={completion ? `Mark ${course.title} as not taken` : `I've taken ${course.title}`}
          title={completion ? 'Taken — click to undo' : "I've taken this"}
          onClick={() => (completion ? onUnmarkCourseTaken(course) : onMarkCourseTaken(course))}
        >
          <UIIcon name="check-circle" />
        </button>
      </div>
      <div className="cand-course-skill-block">
        <div className="cand-course-label">Helps address</div>
        <div className="cand-course-skill-list">{mappedSkills.length > 0 ? mappedSkills.map((skill) => <span key={skill} className="cand-course-gap-tag">{skill}</span>) : <span className="text-xs text-soft-text">Skill mapping unavailable</span>}</div>
      </div>
      <div className="cand-course-reason"><span className="cand-course-label">Recommended because</span><span className="text-xs text-mid">{recommendationReason}</span></div>
      {metadata.length > 0 && <div className="cand-course-meta">{metadata.map((item) => <span key={item}>{item}</span>)}</div>}
      {completion ? (
        <div className="cand-course-completion">
          <span className="cand-learning-status">{completion.status === 'evidenced' ? 'Proof uploaded · Pending verification' : 'Taken'}</span>
          {completion.status === 'completed' && (
            <button className="cand-inline-link" type="button" onClick={() => onUploadCourseEvidence(course)}>
              <UIIcon name="upload" className="cand-mini-icon" />Add proof
            </button>
          )}
        </div>
      ) : progressRecord && progressRecord.status !== 'missing' && <span className="cand-learning-status">{getProgressStatusLabel(progressRecord.status)}</span>}
      <div className="cand-course-actions">
        {url ? (
          <a className="cand-btn-primary cand-btn-sm" href={url} target="_blank" rel="noopener noreferrer" aria-label={`${course.urlLabel}: ${course.title} (opens in a new tab)`}>
            {course.urlLabel || 'View Resource'}<UIIcon name="external" className="cand-btn-icon" />
          </a>
        ) : <span className="text-xs text-soft-text">Provider link unavailable</span>}
        {!course.verified && <span className="cand-course-unreviewed" title="Listed from Kareerly's gathered catalog; details have not been reviewed yet.">Catalog listing</span>}
      </div>
    </div>
  );
}

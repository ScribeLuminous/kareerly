import { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowUpRightFromSquare, faCheck, faGraduationCap, faUpload } from '@fortawesome/free-solid-svg-icons';
import { EmptyState, InfoTip } from '../../components/ui';
import { SkillsHeader, type SkillsTab } from './SkillGapsPage';
import {
  cleanSkillDisplayName,
  getCourseSkillLabels,
  getLearningForJob,
  knownValue,
  learningResourceUrl,
  normalizeSkill,
  orderByBackendRank,
  severityBadgeClass,
  type CourseCompletion,
  type DashboardCourse,
  type DashboardGap,
  type DashboardJob,
} from './model';

export type CourseCompletionActions = {
  courseCompletions: Record<string, CourseCompletion>;
  onMarkCourseTaken: (course: DashboardCourse) => void;
  onUnmarkCourseTaken: (course: DashboardCourse) => void;
  onUploadCourseEvidence: (course: DashboardCourse) => void;
};

type LearningPageProps = CourseCompletionActions & {
  courses: DashboardCourse[];
  jobs: DashboardJob[];
  gaps: DashboardGap[];
  /** Pre-selects a skill (from a gap) or a job (from a job's detail). */
  focusSkill?: string;
  focusJobId?: string;
  onTab: (tab: SkillsTab) => void;
  onOpenJobMatches: () => void;
};

export function UpskillingPage({ courses, jobs, gaps, focusSkill, focusJobId, courseCompletions, onMarkCourseTaken, onUnmarkCourseTaken, onUploadCourseEvidence, onTab, onOpenJobMatches }: LearningPageProps) {
  // Every match is listed, grouped by type, so each Fit-Now match can be focused.
  const jobGroups = [
    { label: 'Fit-Now matches', items: orderByBackendRank(jobs.filter((job) => job.matchCategory === 'fit-now')) },
    { label: 'Closest matches', items: jobs.filter((job) => job.matchCategory === 'aspiration' && job.closestMatch) },
    { label: 'Aspiration matches', items: orderByBackendRank(jobs.filter((job) => job.matchCategory === 'aspiration' && !job.closestMatch)) },
  ].filter((group) => group.items.length > 0);
  const firstJobWithSkill = focusSkill
    ? jobs.find((job) => [...job.missingSkills, ...(job.missingPreferredSkills || [])].some((skill) => normalizeSkill(skill) === normalizeSkill(focusSkill)))
    : undefined;
  const initialJobId = focusJobId || firstJobWithSkill?.id || jobGroups[0]?.items[0]?.id || '';
  const [selectedJobId, setSelectedJobId] = useState(initialJobId);
  const [selectedSkill, setSelectedSkill] = useState(focusSkill ? cleanSkillDisplayName(focusSkill) : 'all');

  const selectedJob = jobs.find((job) => job.id === selectedJobId) || jobGroups[0]?.items[0];
  const jobCourses = selectedJob ? getLearningForJob(selectedJob, courses) : [];
  // Required gaps first, then nice-to-have gaps (the Skill Gaps page lists both).
  const skills = Array.from(new Set([...(selectedJob?.missingSkills || []), ...(selectedJob?.missingPreferredSkills || [])].map(cleanSkillDisplayName).filter(Boolean)));
  const gapFor = (skill: string) => gaps.find((gap) => normalizeSkill(gap.skill) === normalizeSkill(skill));
  const skillIsListed = selectedSkill === 'all' || skills.some((skill) => normalizeSkill(skill) === normalizeSkill(selectedSkill));
  const activeSkill = skillIsListed ? selectedSkill : 'all';
  const groups = skills
    .filter((skill) => activeSkill === 'all' || normalizeSkill(skill) === normalizeSkill(activeSkill))
    .map((skill) => ({
      skill,
      gap: gapFor(skill),
      resources: jobCourses.filter((course) => getCourseSkillLabels(course).some((mapped) => normalizeSkill(mapped) === normalizeSkill(skill))),
    }));
  const otherCourses = jobCourses.length === 0 ? courses.filter((course) => course.reviewed).slice(0, 6) : [];
  const actions: CourseCompletionActions = { courseCompletions, onMarkCourseTaken, onUnmarkCourseTaken, onUploadCourseEvidence };

  return (
    <div className="k-page">
      <SkillsHeader tab="learning" onTab={onTab} gapCount={gaps.length} />
      <div id="skills-panel" role="tabpanel" aria-labelledby="skills-tab-learning">
        {jobs.length === 0 ? (
          <EmptyState
            icon={faGraduationCap}
            title="No learning suggestions yet"
            text="Suggestions follow the skills your job matches need."
            actions={<button className="k-btn k-btn-primary" type="button" onClick={onOpenJobMatches}>Go to Matches</button>}
          />
        ) : (
          <>
            <label className="k-field block max-w-xl">
              <span className="k-label">For job</span>
              <select
                className="k-select mt-1.5"
                value={selectedJob?.id || ''}
                onChange={(event) => { setSelectedJobId(event.target.value); setSelectedSkill('all'); }}
              >
                {jobGroups.map((group) => (
                  <optgroup key={group.label} label={`${group.label} (${group.items.length})`}>
                    {group.items.map((job) => (
                      <option key={job.id} value={job.id}>
                        {job.title}{knownValue(job.company) ? ` — ${job.company}` : ''}{job.hasMatchScore ? ` · ${job.matchScore}%` : ''}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>

            {skills.length === 0 ? (
              <EmptyState className="mt-4" title="Nothing to learn for this job" text="It has no missing skills for your profile. Pick another job." />
            ) : (
              <>
                <div className="k-chip-scroller mb-5 mt-4" role="group" aria-label="Filter by skill">
                  <button className="k-chip" type="button" aria-pressed={activeSkill === 'all'} onClick={() => setSelectedSkill('all')}>All skills</button>
                  {skills.map((skill) => {
                    const gap = gapFor(skill);
                    return (
                      <button key={skill} className="k-chip" type="button" aria-pressed={normalizeSkill(activeSkill) === normalizeSkill(skill)} onClick={() => setSelectedSkill(skill)}>
                        {skill}
                        {gap && <span className="k-chip-count">· {gap.severity}</span>}
                      </button>
                    );
                  })}
                </div>

                {jobCourses.length === 0 ? (
                  <>
                    <EmptyState title="No resources for this job yet" text={otherCourses.length > 0 ? 'Here are resources for your other skill gaps.' : 'Check again after the learning catalog updates.'} />
                    {otherCourses.length > 0 && (
                      <section className="k-section" aria-labelledby="other-learning">
                        <h2 id="other-learning" className="k-section-title mb-3">For your other matches</h2>
                        <ul className="k-list">{otherCourses.map((course) => <CourseRow key={course.id} course={course} {...actions} />)}</ul>
                      </section>
                    )}
                  </>
                ) : (
                  <div className="space-y-6">
                    {groups.map(({ skill, gap, resources }) => (
                      <section key={skill} aria-labelledby={`learn-${normalizeSkill(skill).replace(/[^a-z0-9]+/g, '-')}`}>
                        <div className="k-section-head">
                          <h2 id={`learn-${normalizeSkill(skill).replace(/[^a-z0-9]+/g, '-')}`} className="k-section-title">{skill}</h2>
                          {gap && <span className={severityBadgeClass(gap.severity)}>{gap.severity}</span>}
                        </div>
                        {resources.length > 0 ? (
                          <ul className="k-list">{resources.map((course) => <CourseRow key={course.id} course={course} {...actions} />)}</ul>
                        ) : (
                          <p className="k-secondary">No resources listed for {skill} yet.</p>
                        )}
                      </section>
                    ))}
                  </div>
                )}
              </>
            )}
            <p className="k-meta mt-6 flex items-center gap-1">
              Resources open on the provider's website.
              <InfoTip label="About learning resources">
                Kareerly suggests resources for your skill gaps. Providers manage enrolment and certificates; Kareerly does not verify completion, and taking a course does not change your match scores.
              </InfoTip>
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export function CourseRow({ course, courseCompletions, onMarkCourseTaken, onUnmarkCourseTaken, onUploadCourseEvidence }: CourseCompletionActions & { course: DashboardCourse }) {
  const url = learningResourceUrl(course);
  const completion = courseCompletions[course.id];
  const isCertification = ['industry_certification', 'professional_certificate'].includes(course.credentialType) || course.urlLabel === 'View certification';
  const meta = [course.provider, isCertification ? 'Certification' : '', course.level, course.deliveryMode, course.duration, course.isFree ? 'Free' : course.fees]
    .map((value) => knownValue(value))
    .filter((value) => value && !/unknown/i.test(value));
  return (
    <li className="k-row flex-wrap items-start gap-y-3 sm:flex-nowrap">
      <div className="k-row-main basis-full sm:basis-auto">
        <div className="k-label">{course.title}</div>
        <div className="k-meta k-dot-sep mt-0.5">{meta.map((item) => <span key={item}>{item}</span>)}</div>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          {completion && (
            <span className="k-badge k-badge-success">
              <FontAwesomeIcon icon={faCheck} aria-hidden="true" />
              {completion.status === 'evidenced' ? 'Proof uploaded · pending review' : 'Taken'}
            </span>
          )}
          {completion?.status === 'completed' && (
            <button className="k-link text-[13px]" type="button" onClick={() => onUploadCourseEvidence(course)}>
              <FontAwesomeIcon icon={faUpload} aria-hidden="true" />Add proof
            </button>
          )}
          {!course.verified && <span className="k-meta" title="Listed from Kareerly's gathered catalog; details have not been reviewed yet.">Catalog listing</span>}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          className="k-btn k-btn-ghost k-btn-sm"
          type="button"
          aria-pressed={Boolean(completion)}
          aria-label={completion ? `Mark ${course.title} as not taken` : `Mark ${course.title} as taken`}
          onClick={() => (completion ? onUnmarkCourseTaken(course) : onMarkCourseTaken(course))}
        >
          <FontAwesomeIcon icon={faCheck} className={completion ? 'text-green' : undefined} aria-hidden="true" />
          {completion ? 'Taken' : 'Mark taken'}
        </button>
        {url ? (
          <a className="k-btn k-btn-secondary k-btn-sm" href={url} target="_blank" rel="noopener noreferrer" aria-label={`${course.urlLabel || 'Open'}: ${course.title} (opens in a new tab)`}>
            Open<FontAwesomeIcon icon={faArrowUpRightFromSquare} aria-hidden="true" />
          </a>
        ) : <span className="k-meta">No link</span>}
      </div>
    </li>
  );
}

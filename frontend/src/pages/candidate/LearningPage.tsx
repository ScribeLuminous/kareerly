import { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowUpRightFromSquare, faCheck, faCircleCheck, faGraduationCap, faUpload } from '@fortawesome/free-solid-svg-icons';
import { Banner, EmptyState, InfoTip, SkeletonRows } from '../../components/ui';
import { SkillsHeader, type GapLoadStatus, type SkillsTab } from './SkillGapsPage';
import {
  EMPLOYER_CHECK_REMINDER,
  knownValue,
  learningResourceUrl,
  mapRunLearningRecommendation,
  normalizeSkill,
  type ClaimedSkill,
  type CourseCompletion,
  type DashboardCourse,
  type SkillProgressRecord,
} from './model';
import { gapProgress, gapRecordKey, openAndCompleted, titleList } from './skillGaps';
import type { GapSkill, SkillGapReport } from '../../types';

export type CourseCompletionActions = {
  courseCompletions: Record<string, CourseCompletion>;
  onMarkCourseTaken: (course: DashboardCourse) => void;
  onUnmarkCourseTaken: (course: DashboardCourse) => void;
  onUploadCourseEvidence: (course: DashboardCourse) => void;
};

type LearningPageProps = CourseCompletionActions & {
  /** The same skill-grouped gaps as the Gaps tab, with courses keyed by skill. */
  report: SkillGapReport | null;
  status: GapLoadStatus;
  error?: string;
  onRetry: () => void;
  /** Skills the candidate says they already have; no courses are suggested for them. */
  claimedSkills: Record<string, ClaimedSkill>;
  skillProgressRecords: Record<string, SkillProgressRecord>;
  /** Pre-selects a skill (from a gap or a job's detail). */
  focusSkill?: string;
  hasMatches: boolean;
  onTab: (tab: SkillsTab) => void;
  onOpenJobMatches: () => void;
};

type SkillGroup = { skill: GapSkill; key: string; courses: DashboardCourse[]; searchUrl?: string; helps: number; requiredBy: string[]; niceFor: string[] };

function helpsLine(group: SkillGroup): string {
  const parts = [`${group.helps} job${group.helps === 1 ? '' : 's'}`];
  if (group.requiredBy.length) parts.push(`Required: ${titleList(group.requiredBy)}`);
  else if (group.niceFor.length) parts.push(`Nice to have: ${titleList(group.niceFor)}`);
  return parts.join(' · ');
}

export function UpskillingPage({
  report, status, error, onRetry, claimedSkills, skillProgressRecords, focusSkill, hasMatches,
  courseCompletions, onMarkCourseTaken, onUnmarkCourseTaken, onUploadCourseEvidence, onTab, onOpenJobMatches,
}: LearningPageProps) {
  // null until the candidate picks a skill: the focused skill (from a gap or job) is shown first.
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const actions: CourseCompletionActions = { courseCompletions, onMarkCourseTaken, onUnmarkCourseTaken, onUploadCourseEvidence };
  const visibleCourses = report?.rules.display.courses_per_skill_visible ?? 3;
  const visibleSkills = report?.rules.display.learning_skills_visible ?? 5;
  const [allSkillsShown, setAllSkillsShown] = useState(false);
  const [allNoCourseShown, setAllNoCourseShown] = useState(false);

  // Open skills only, in the Gaps tab's tier order; completed and owned skills get no courses.
  const { open } = openAndCompleted(report, claimedSkills, skillProgressRecords);
  const groups: SkillGroup[] = open.map((skill) => {
    const entry = report?.courses_by_skill?.[skill.skill_id];
    return {
      skill,
      key: gapRecordKey(skill),
      courses: (entry?.courses || []).map(mapRunLearningRecommendation).filter((course) => course.reviewed),
      searchUrl: entry?.search_url,
      helps: entry?.helps_matches ?? skill.jobs_needing,
      requiredBy: entry?.required_by || [],
      niceFor: entry?.nice_for || [],
    };
  });
  const withCourses = groups.filter((group) => group.courses.length > 0);
  const withoutCourses = groups.filter((group) => group.courses.length === 0);
  const focusKey = focusSkill ? withCourses.find((group) => normalizeSkill(group.skill.skill_name) === normalizeSkill(focusSkill))?.key : undefined;
  const activeKey = selectedKey ?? focusKey ?? 'all';
  const filtered = activeKey === 'all' ? withCourses : withCourses.filter((group) => group.key === activeKey);
  const shown = allSkillsShown ? filtered : filtered.slice(0, visibleSkills);
  const hiddenSkills = filtered.length - Math.min(filtered.length, visibleSkills);

  // Courses for skills the candidate set to In progress.
  const continuing = groups.flatMap((group) => {
    const record = skillProgressRecords[group.key];
    if (gapProgress(record?.status) !== 'in_progress') return [];
    const course = group.courses.find((item) => item.id === record?.selectedResourceId) || group.courses[0];
    return course && !courseCompletions[course.id] ? [{ group, course }] : [];
  });

  const body = () => {
    if (!hasMatches) {
      return (
        <EmptyState
          icon={faGraduationCap}
          title="No learning suggestions yet"
          text="Suggestions follow the skills your job matches need."
          actions={<button className="k-btn k-btn-primary" type="button" onClick={onOpenJobMatches}>Go to Matches</button>}
        />
      );
    }
    if (status === 'error') {
      return (
        <Banner tone="error" actions={<button className="k-btn k-btn-secondary k-btn-sm" type="button" onClick={onRetry}>Try again</button>}>
          {error || 'Your learning suggestions could not be loaded.'}
        </Banner>
      );
    }
    if (!report) return <SkeletonRows count={4} label="Loading learning suggestions" />;
    if (groups.length === 0) {
      return <EmptyState title="Nothing to learn right now" text='Your open skill gaps are all completed. Change "Gaps from" on the Gaps tab to see more jobs.' />;
    }
    return (
      <>
        <div className="k-learn-controls mb-5">
          <p className="k-secondary">Courses for your skill gaps, most useful first.</p>
          {withCourses.length > 1 && (
            <label className="k-field block min-w-0">
              <span className="k-label">Show courses for</span>
              <select className="k-select mt-1.5" value={activeKey} onChange={(event) => setSelectedKey(event.target.value)}>
                <option value="all">All skills ({withCourses.length})</option>
                {withCourses.map((group) => (
                  <option key={group.key} value={group.key}>
                    {group.skill.skill_name} ({group.courses.length} course{group.courses.length === 1 ? '' : 's'})
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {continuing.length > 0 && activeKey === 'all' && (
          <section className="mb-7" aria-labelledby="learn-continue">
            <h2 id="learn-continue" className="k-section-title mb-3">Continue learning</h2>
            <ul className="k-list">
              {continuing.map(({ group, course }) => (
                <CourseRow key={`continue-${course.id}`} course={course} note={`For ${group.skill.skill_name}`} {...actions} />
              ))}
            </ul>
          </section>
        )}

        <div id="learn-skill-groups" className="space-y-7">
          {shown.map((group) => {
            const id = `learn-${group.key.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
            const isOpen = Boolean(expanded[group.key]);
            const extra = group.courses.length - visibleCourses;
            return (
              <section key={group.key} aria-labelledby={`${id}-title`}>
                <h2 id={`${id}-title`} className="k-section-title">{group.skill.skill_name}</h2>
                <p className="k-meta mb-3 mt-0.5">{helpsLine(group)}</p>
                <ul id={`${id}-list`} className="k-list">
                  {(isOpen ? group.courses : group.courses.slice(0, visibleCourses)).map((course) => (
                    <CourseRow key={course.id} course={course} {...actions} />
                  ))}
                </ul>
                {extra > 0 && (
                  <button
                    className="k-btn k-btn-ghost k-show-more"
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={`${id}-list`}
                    onClick={() => setExpanded((current) => ({ ...current, [group.key]: !isOpen }))}
                  >
                    {isOpen ? 'Show fewer courses' : `Show ${extra} more course${extra === 1 ? '' : 's'}`}
                  </button>
                )}
              </section>
            );
          })}
        </div>
        {hiddenSkills > 0 && (
          <button
            className="k-btn k-btn-secondary mt-5"
            type="button"
            aria-expanded={allSkillsShown}
            aria-controls="learn-skill-groups"
            onClick={() => setAllSkillsShown((current) => !current)}
          >
            {allSkillsShown ? 'Show fewer skills' : `Show ${hiddenSkills} more skill${hiddenSkills === 1 ? '' : 's'}`}
          </button>
        )}

        {withoutCourses.length > 0 && activeKey === 'all' && (
          <section className="k-card mt-7" aria-labelledby="learn-no-course">
            <h2 id="learn-no-course" className="k-label">No course yet for {withoutCourses.length} skill{withoutCourses.length === 1 ? '' : 's'}</h2>
            <p className="k-meta mt-1">No reviewed course yet. Try a web search.</p>
            <ul id="learn-no-course-list" className="mt-2">
              {(allNoCourseShown ? withoutCourses : withoutCourses.slice(0, visibleSkills)).map((group) => (
                <li key={group.key} className="k-no-course-row">
                  <span className="min-w-0">
                    <span className="k-label block">{group.skill.skill_name}</span>
                    <span className="k-meta block truncate">{helpsLine(group)}</span>
                  </span>
                  {group.searchUrl && (
                    <a className="k-btn k-btn-ghost k-btn-sm shrink-0" href={group.searchUrl} target="_blank" rel="noopener noreferrer" aria-label={`Search the web for ${group.skill.skill_name} courses (opens in a new tab)`}>
                      Search<FontAwesomeIcon icon={faArrowUpRightFromSquare} aria-hidden="true" />
                    </a>
                  )}
                </li>
              ))}
            </ul>
            {withoutCourses.length > visibleSkills && (
              <button
                className="k-btn k-btn-ghost k-show-more"
                type="button"
                aria-expanded={allNoCourseShown}
                aria-controls="learn-no-course-list"
                onClick={() => setAllNoCourseShown((current) => !current)}
              >
                {allNoCourseShown ? 'Show fewer' : `Show ${withoutCourses.length - visibleSkills} more`}
              </button>
            )}
          </section>
        )}
      </>
    );
  };

  return (
    <div className="k-page k-skills-page">
      <SkillsHeader tab="learning" onTab={onTab} gapCount={report ? open.length : undefined} />
      <div id="skills-panel" role="tabpanel" aria-labelledby="skills-tab-learning">
        {body()}
        <p className="k-meta mt-6 flex items-center gap-1">
          Resources open on the provider's website.
          <InfoTip label="About learning resources">
            Providers manage enrolment and certificates. Kareerly does not verify completion, and a course does not change your match scores. Proof is optional. {EMPLOYER_CHECK_REMINDER}
          </InfoTip>
        </p>
      </div>
    </div>
  );
}

export function CourseRow({ course, note, courseCompletions, onMarkCourseTaken, onUnmarkCourseTaken, onUploadCourseEvidence }: CourseCompletionActions & { course: DashboardCourse; note?: string }) {
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
        {note && <p className="k-meta mt-1">{note}</p>}
        {!course.verified && <div className="k-meta mt-0.5" title="Listed from Kareerly's gathered catalog; details have not been reviewed yet.">Catalog listing</div>}
        {completion?.status === 'evidenced' && (
          <p className="k-badge k-badge-info mt-1.5"><FontAwesomeIcon icon={faCircleCheck} aria-hidden="true" />Proof added · pending review</p>
        )}
        {completion?.status === 'completed' && (
          <p className="k-meta mt-1.5">
            Done without proof.{' '}
            <button className="k-link text-[13px]" type="button" onClick={() => onUploadCourseEvidence(course)}>
              <FontAwesomeIcon icon={faUpload} aria-hidden="true" />Add proof (optional)
            </button>
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          className="k-btn k-btn-ghost k-btn-sm"
          type="button"
          aria-pressed={Boolean(completion)}
          aria-label={completion ? `${course.title} is done. Mark as not done` : `Mark ${course.title} as done`}
          onClick={() => (completion ? onUnmarkCourseTaken(course) : onMarkCourseTaken(course))}
        >
          <FontAwesomeIcon icon={faCheck} className={completion ? 'text-green' : undefined} aria-hidden="true" />
          {completion ? 'Done' : 'Mark as done'}
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

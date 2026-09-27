import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowRight, faArrowUpRightFromSquare, faCheck, faChevronRight, faCircleCheck, faPuzzlePiece, faRotateLeft, faUpload, faUserCheck } from '@fortawesome/free-solid-svg-icons';
import { ConfirmDialog, EmptyState, InfoTip, Modal, Tabs } from '../../components/ui';
import { PageHeader } from './common';
import {
  cleanSkillDisplayName,
  EMPLOYER_CHECK_REMINDER,
  knownValue,
  learningResourceUrl,
  normalizeSkill,
  severityBadgeClass,
  SKILL_PROGRESS_PERCENT,
  skillNextStep,
  skillRecordKey,
  type ClaimedSkill,
  type CourseCompletion,
  type DashboardCourse,
  type DashboardGap,
  type DashboardJob,
  type SeverityLevel,
  type SkillProgressRecord,
  type SkillProgressStatus,
} from './model';

export type SkillsTab = 'gaps' | 'learning';

/** Shared header for the two Skills views. */
export function SkillsHeader({ tab, onTab, gapCount }: { tab: SkillsTab; onTab: (tab: SkillsTab) => void; gapCount?: number }) {
  return (
    <>
      <PageHeader title="Skills" />
      <Tabs<SkillsTab>
        label="Skills views"
        idPrefix="skills"
        value={tab}
        onChange={onTab}
        items={[
          { id: 'gaps', label: 'Gaps', count: gapCount },
          { id: 'learning', label: 'Learning' },
        ]}
      />
    </>
  );
}

const PROGRESS_NOTE = 'Progress is a guide you update yourself. It is not a verified skill score. Kareerly does not verify course completion. Skills you add with "I already have this" are added to your skill list and your matches are refreshed.';

type Priority = 'all' | SeverityLevel;
type ProgressValue = 'missing' | 'in_progress' | 'completed';

type SkillRow = {
  key: string;
  gap: DashboardGap;
  status: SkillProgressStatus;
  percent: number;
  resource?: DashboardCourse;
};

type SkillGapsPageProps = {
  /** Gaps still open: skills the candidate marked as already having are left out. */
  gaps: DashboardGap[];
  jobs: DashboardJob[];
  courses: DashboardCourse[];
  skillProgressRecords: Record<string, SkillProgressRecord>;
  claimedSkills: Record<string, ClaimedSkill>;
  courseCompletions: Record<string, CourseCompletion>;
  onUpdateSkillProgress: (skillKey: string, status: SkillProgressStatus, selectedResourceId?: string) => void;
  onMarkCourseTaken: (course: DashboardCourse) => void;
  onUnmarkCourseTaken: (course: DashboardCourse) => void;
  onAddSkillProof: (skillKey: string, gap: DashboardGap, resource?: DashboardCourse) => void;
  onClaimSkill: (gap: DashboardGap) => void;
  onUnclaimSkill: (skillKey: string) => void;
  onOpenLearning: (skill?: string) => void;
  onTab: (tab: SkillsTab) => void;
  isDesktop: boolean;
  hasMatches: boolean;
  onOpenMatches: () => void;
};

const PRIORITIES: SeverityLevel[] = ['Critical', 'High', 'Moderate'];

function progressValue(status: SkillProgressStatus): ProgressValue {
  if (status === 'completed' || status === 'evidenced' || status === 'covered') return 'completed';
  if (status === 'started' || status === 'in_progress') return 'in_progress';
  return 'missing';
}

export function SkillGapsPage({
  gaps,
  jobs,
  courses,
  skillProgressRecords,
  claimedSkills,
  courseCompletions,
  onUpdateSkillProgress,
  onMarkCourseTaken,
  onUnmarkCourseTaken,
  onAddSkillProof,
  onClaimSkill,
  onUnclaimSkill,
  onOpenLearning,
  onTab,
  isDesktop,
  hasMatches,
  onOpenMatches,
}: SkillGapsPageProps) {
  const [priority, setPriority] = useState<Priority>('all');
  const [selectedKey, setSelectedKey] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [claimTarget, setClaimTarget] = useState<DashboardGap | null>(null);

  const claimedList = useMemo(() => Object.entries(claimedSkills)
    .map(([key, item]) => ({ key, name: cleanSkillDisplayName(item.skillName) }))
    .sort((a, b) => a.name.localeCompare(b.name)), [claimedSkills]);

  // Skills the resume already shows for the matched jobs.
  const coveredSkills = useMemo(() => {
    const claimedNames = new Set(claimedList.map((item) => normalizeSkill(item.name)));
    const seen = new Map<string, string>();
    jobs.forEach((job) => job.matchedSkills.forEach((skill) => {
      const key = normalizeSkill(skill);
      if (key && !seen.has(key) && !claimedNames.has(key)) seen.set(key, cleanSkillDisplayName(skill));
    }));
    return Array.from(seen.values());
  }, [claimedList, jobs]);

  const resourceByGap = useMemo(() => {
    const map = new Map<string, DashboardCourse>();
    gaps.forEach((gap) => {
      const match = [...(gap.topResources || []), ...courses].find((course) =>
        course.reviewed && course.mappedSkills.some((skill) => normalizeSkill(skill) === normalizeSkill(gap.skill)));
      if (match) map.set(gap.skill, match);
    });
    return map;
  }, [courses, gaps]);

  // One row per missing skill: required gaps first, then by severity, then least progress.
  const rows = useMemo<SkillRow[]>(() => {
    const rank: Record<SeverityLevel, number> = { Critical: 0, High: 1, Moderate: 2 };
    return gaps.map((gap) => {
      const key = skillRecordKey(gap);
      const record = skillProgressRecords[key];
      const status: SkillProgressStatus = record?.status || 'missing';
      return { key, gap, status, percent: record?.progressPercent ?? SKILL_PROGRESS_PERCENT[status], resource: resourceByGap.get(gap.skill) };
    }).sort((a, b) => Number(Boolean(a.gap.optional)) - Number(Boolean(b.gap.optional))
      || rank[a.gap.severity] - rank[b.gap.severity]
      || a.percent - b.percent
      || a.gap.skill.localeCompare(b.gap.skill));
  }, [gaps, resourceByGap, skillProgressRecords]);

  const activeKeys = new Set(rows.map((row) => row.key));
  const closedGaps = Object.entries(skillProgressRecords)
    .filter(([key, record]) => record.status === 'covered' && !activeKeys.has(key) && !claimedSkills[key])
    .map(([, record]) => cleanSkillDisplayName(record.skillName));
  const notStarted = rows.filter((row) => progressValue(row.status) === 'missing').length;
  const inProgress = rows.filter((row) => progressValue(row.status) === 'in_progress').length;
  const done = rows.filter((row) => progressValue(row.status) === 'completed').length;
  const counts = Object.fromEntries(PRIORITIES.map((level) => [level, rows.filter((row) => row.gap.severity === level).length])) as Record<SeverityLevel, number>;
  const levelsPresent = PRIORITIES.filter((level) => counts[level] > 0);
  const activePriority: Priority = levelsPresent.length > 1 ? priority : 'all';
  const visibleRows = activePriority === 'all' ? rows : rows.filter((row) => row.gap.severity === activePriority);
  const selected = visibleRows.find((row) => row.key === selectedKey) || (isDesktop ? visibleRows[0] : null) || null;
  const haveCount = claimedList.length + closedGaps.length + coveredSkills.length;

  const openRow = (row: SkillRow) => {
    setSelectedKey(row.key);
    if (!isDesktop) setSheetOpen(true);
  };

  // One progress control drives both the skill and its suggested course, so
  // Skills and Learning never disagree about whether the course is done.
  const changeProgress = (row: SkillRow, value: ProgressValue) => {
    const course = row.resource;
    const courseTaken = Boolean(course && courseCompletions[course.id]);
    if (value === 'completed') {
      if (course && !courseTaken) {
        onMarkCourseTaken(course);
        onUpdateSkillProgress(row.key, 'completed', course.id);
        return;
      }
      onUpdateSkillProgress(row.key, 'completed', course?.id);
      onAddSkillProof(row.key, row.gap, course);
      return;
    }
    if (course && courseTaken) onUnmarkCourseTaken(course);
    onUpdateSkillProgress(row.key, value, course?.id);
  };

  const renderRow = (row: SkillRow) => {
    const value = progressValue(row.status);
    return (
      <li key={row.key}>
        <button className="k-row" type="button" onClick={() => openRow(row)} aria-current={isDesktop && selected?.key === row.key ? 'true' : undefined}>
          <span className="k-row-main">
            <span className="k-label block">{cleanSkillDisplayName(row.gap.skill)}</span>
            <span className="k-meta k-dot-sep mt-0.5 block">
              <span>{row.gap.optional ? 'Nice to have' : 'Required'}</span>
              {row.gap.affectedCount !== null && <span>{row.gap.affectedCount} match{row.gap.affectedCount === 1 ? '' : 'es'}</span>}
            </span>
          </span>
          <span className="sr-only">, {row.gap.severity} priority</span>
          {value !== 'missing' && (
            <span className={`k-badge ${value === 'completed' ? 'k-badge-success' : 'k-badge-info'} shrink-0`}>
              {value === 'completed' && <FontAwesomeIcon icon={faCheck} aria-hidden="true" />}
              {value === 'completed' ? 'Done' : 'In progress'}
            </span>
          )}
          <FontAwesomeIcon className="k-row-chevron" icon={faChevronRight} aria-hidden="true" />
        </button>
      </li>
    );
  };

  const detail = selected && (
    <GapDetail
      row={selected}
      courseTaken={Boolean(selected.resource && courseCompletions[selected.resource.id])}
      onProgress={(value) => changeProgress(selected, value)}
      onAddProof={() => onAddSkillProof(selected.key, selected.gap, selected.resource)}
      onClaim={() => setClaimTarget(selected.gap)}
      onOpenLearning={() => onOpenLearning(cleanSkillDisplayName(selected.gap.skill))}
    />
  );

  return (
    <div className="k-page">
      <SkillsHeader tab="gaps" onTab={onTab} gapCount={rows.length} />
      <div id="skills-panel" role="tabpanel" aria-labelledby="skills-tab-gaps">
        {rows.length === 0 ? (
          <>
            <EmptyState
              icon={faPuzzlePiece}
              title={hasMatches ? 'No skill gaps right now' : 'No skill gaps yet'}
              text={hasMatches ? 'Your matches show no missing skills you still need to build.' : 'Skill gaps appear once you have job matches.'}
              actions={!hasMatches ? <button className="k-btn k-btn-primary" type="button" onClick={onOpenMatches}>Go to Matches</button> : undefined}
            />
            {claimedList.length > 0 && (
              <div className="mt-5">
                <HaveSkills claimed={claimedList} fromResume={[...closedGaps, ...coveredSkills]} onUnclaim={onUnclaimSkill} />
              </div>
            )}
          </>
        ) : (
          <>
            <p className="k-secondary mb-1">Skills your matches ask for that your resume doesn't show yet. Pick one to see how to close it.</p>
            <p className="k-meta mb-3 flex flex-wrap items-center gap-x-1">
              <span><strong className="k-num text-dark">{notStarted}</strong> not started</span>
              <span aria-hidden="true">·</span>
              <span><strong className="k-num text-dark">{inProgress}</strong> in progress</span>
              <span aria-hidden="true">·</span>
              <span><strong className="k-num text-dark">{done}</strong> done</span>
              <InfoTip label="About skill progress">{PROGRESS_NOTE}</InfoTip>
            </p>
            {levelsPresent.length > 1 && (
              <div className="k-chip-scroller mb-4" role="group" aria-label="Filter by priority">
                <button className="k-chip" type="button" aria-pressed={activePriority === 'all'} onClick={() => setPriority('all')}>
                  All <span className="k-chip-count">{rows.length}</span>
                </button>
                {levelsPresent.map((level) => (
                  <button key={level} className="k-chip" type="button" aria-pressed={activePriority === level} onClick={() => setPriority(level)}>
                    {level} <span className="k-chip-count">{counts[level]}</span>
                  </button>
                ))}
              </div>
            )}

            <div className={isDesktop ? 'k-split' : undefined}>
              <div className="space-y-5">
                {(activePriority === 'all' ? PRIORITIES : [activePriority]).map((level) => {
                  const group = visibleRows.filter((row) => row.gap.severity === level);
                  if (group.length === 0) return null;
                  return (
                    <section key={level} aria-labelledby={`gap-group-${level}`}>
                      <h2 id={`gap-group-${level}`} className="k-eyebrow mb-2">{level} priority · {group.length}</h2>
                      <ul className="k-list">{group.map(renderRow)}</ul>
                    </section>
                  );
                })}

                {haveCount > 0 && <HaveSkills claimed={claimedList} fromResume={[...closedGaps, ...coveredSkills]} onUnclaim={onUnclaimSkill} />}
              </div>
              {isDesktop && detail && (
                <article className="k-split-detail k-detail" aria-label={`${cleanSkillDisplayName(selected.gap.skill)} details`}>
                  <div className="k-detail-scroll pt-5">{detail}</div>
                </article>
              )}
            </div>
          </>
        )}
      </div>
      {!isDesktop && sheetOpen && selected && (
        <Modal title={cleanSkillDisplayName(selected.gap.skill)} onClose={() => setSheetOpen(false)}>
          {detail}
        </Modal>
      )}
      {claimTarget && (
        <ConfirmDialog
          title={`Add ${cleanSkillDisplayName(claimTarget.skill)} to your skills?`}
          confirmLabel="Yes, I have this skill"
          onCancel={() => setClaimTarget(null)}
          onConfirm={() => {
            onClaimSkill(claimTarget);
            setClaimTarget(null);
            setSheetOpen(false);
          }}
        >
          <p className="k-secondary">
            Add it only if you could use it at work today, for example from a past job, school, or your own projects.
            It moves to your skill list, courses for it stop being suggested, and your matches are refreshed.
          </p>
          <p className="k-meta mt-3">{EMPLOYER_CHECK_REMINDER} You can undo this any time under “Skills you already have”.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

function HaveSkills({ claimed, fromResume, onUnclaim }: {
  claimed: Array<{ key: string; name: string }>;
  fromResume: string[];
  onUnclaim: (skillKey: string) => void;
}) {
  return (
    <details className="k-card" open={claimed.length > 0 || undefined}>
      <summary className="k-label flex min-h-[28px] cursor-pointer items-center justify-between">
        Skills you already have
        <span className="k-meta">{claimed.length + fromResume.length}</span>
      </summary>
      {claimed.length > 0 && (
        <div className="mt-3">
          <h3 className="k-meta mb-1.5">Added by you</h3>
          <ul className="k-chip-row gap-1.5">
            {claimed.map((item) => (
              <li key={`claimed-${item.key}`} className="k-skill k-skill-have">
                <FontAwesomeIcon icon={faUserCheck} aria-hidden="true" />{item.name}
                <button className="k-link ml-1 text-[12px]" type="button" onClick={() => onUnclaim(item.key)} aria-label={`Undo: I don't have ${item.name} yet`}>
                  <FontAwesomeIcon icon={faRotateLeft} aria-hidden="true" />Undo
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {fromResume.length > 0 && (
        <div className="mt-3">
          {claimed.length > 0 && <h3 className="k-meta mb-1.5">From your resume</h3>}
          <div className="k-chip-row gap-1.5">
            {fromResume.map((skill) => (
              <span key={`have-${skill}`} className="k-skill k-skill-have"><FontAwesomeIcon icon={faCheck} aria-hidden="true" />{skill}</span>
            ))}
          </div>
        </div>
      )}
    </details>
  );
}

function GapDetail({ row, courseTaken, onProgress, onAddProof, onClaim, onOpenLearning }: {
  row: SkillRow;
  courseTaken: boolean;
  onProgress: (value: ProgressValue) => void;
  onAddProof: () => void;
  onClaim: () => void;
  onOpenLearning: () => void;
}) {
  const { gap, resource, status } = row;
  const name = cleanSkillDisplayName(gap.skill);
  const url = resource ? learningResourceUrl(resource) : undefined;
  const value = progressValue(status);
  const jobs = gap.relatedJobs.length > 0
    ? gap.relatedJobs.join(', ')
    : gap.affectedCount !== null ? `${gap.affectedCount} of your matches` : 'your matches';
  const section = (step: number, title: string, body: ReactNode) => (
    <section className="mt-6 first:mt-0" aria-label={title}>
      <h3 className="k-label mb-2 flex items-center gap-2">
        <span className="k-badge k-badge-outline k-num" aria-hidden="true">{step}</span>{title}
      </h3>
      {body}
    </section>
  );
  return (
    <div>
      <div className="mb-3 hidden flex-wrap items-center gap-2 lg:flex">
        <h2 className="k-section-title mr-1">{name}</h2>
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        <span className={severityBadgeClass(gap.severity)}>{gap.severity} priority</span>
        <span className="k-badge">{gap.optional ? 'Nice to have' : 'Required'}</span>
      </div>
      <p className="k-secondary">
        {gap.optional ? 'Nice to have' : 'Required'} for <strong className="text-dark">{jobs}</strong>. Your resume doesn't mention {name} yet.
      </p>

      <div className="k-card mt-4">
        <p className="k-label">Already know {name}?</p>
        <p className="k-meta mt-1">Add it to your skills instead of taking a course. We'll stop suggesting courses for it and refresh your matches.</p>
        <button className="k-btn k-btn-secondary k-btn-sm mt-3" type="button" onClick={onClaim}>
          <FontAwesomeIcon icon={faUserCheck} aria-hidden="true" />I already have this skill
        </button>
      </div>

      <div className="mt-6">
        {section(1, 'Learn it', (
          <>
            {resource ? (
              <div className="k-list">
                <div className="k-row">
                  <div className="k-row-main">
                    <div className="k-label">{resource.title}</div>
                    <div className="k-meta k-dot-sep mt-0.5">
                      {[resource.provider, resource.level, resource.duration, resource.isFree ? 'Free' : '']
                        .map((item) => knownValue(item))
                        .filter((item) => item && !/unknown/i.test(item))
                        .map((item) => <span key={item}>{item}</span>)}
                    </div>
                  </div>
                  {url && (
                    <a className="k-btn k-btn-primary k-btn-sm" href={url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${resource.title} (opens in a new tab)`}>
                      Open<FontAwesomeIcon icon={faArrowUpRightFromSquare} aria-hidden="true" />
                    </a>
                  )}
                </div>
              </div>
            ) : <p className="k-secondary">No course is listed for {name} yet.</p>}
            <button className="k-link mt-3" type="button" onClick={onOpenLearning}>
              More courses for {name}<FontAwesomeIcon icon={faArrowRight} aria-hidden="true" />
            </button>
          </>
        ))}

        {section(2, 'Track your progress', (
          <>
            <div className="k-seg" role="radiogroup" aria-label={`Progress on ${name}`}>
              {([['missing', 'Not started'], ['in_progress', 'In progress'], ['completed', 'Done']] as const).map(([option, label]) => (
                <button
                  key={option}
                  className="k-seg-btn"
                  type="button"
                  role="radio"
                  aria-checked={value === option}
                  onClick={() => { if (value !== option) onProgress(option); }}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="k-meta mt-2">{skillNextStep(status, name)}</p>
            {courseTaken && resource && <p className="k-meta mt-1">The course is marked done in Learning too.</p>}
          </>
        ))}

        {value === 'completed' && section(3, 'Proof (optional)', status === 'evidenced' ? (
          <p className="k-badge k-badge-info"><FontAwesomeIcon icon={faCircleCheck} aria-hidden="true" />Proof added · pending review</p>
        ) : (
          <>
            <p className="k-meta">You can skip this. {EMPLOYER_CHECK_REMINDER} A certificate, project, or work sample is a good example to keep.</p>
            <button className="k-btn k-btn-ghost k-btn-sm mt-2 -ml-3" type="button" onClick={onAddProof}>
              <FontAwesomeIcon icon={faUpload} aria-hidden="true" />Add proof
            </button>
          </>
        ))}
      </div>
    </div>
  );
}

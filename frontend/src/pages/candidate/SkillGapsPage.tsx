import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowLeft, faArrowRight, faArrowUpRightFromSquare, faCheck, faChevronRight, faPuzzlePiece, faRotateLeft, faUserCheck } from '@fortawesome/free-solid-svg-icons';
import { Banner, ConfirmDialog, EmptyState, InfoTip, SearchField, Segmented, SkeletonRows, Tabs } from '../../components/ui';
import { PageHeader } from './common';
import { MatchScoreNotice } from '../../components/MatchScoreNotice';
import {
  EMPLOYER_CHECK_REMINDER,
  knownValue,
  learningResourceUrl,
  mapRunLearningRecommendation,
  skillNextStep,
  type ClaimedSkill,
  type CourseCompletion,
  type DashboardCourse,
  type DashboardGap,
  type SkillProgressRecord,
  type SkillProgressStatus,
} from './model';
import {
  buildTierSections,
  gapExplanation,
  gapProgress,
  gapRecordKey,
  matchTypeLabel,
  openAndCompleted,
  requirementLabel,
  requirementSummary,
  showSkillSearch,
  taxonomyIdOf,
  toDashboardGap,
  type GapProgress,
} from './skillGaps';
import type { GapGroupBy, GapJobCard, GapScope, GapSkill, GapTier, SkillGapReport } from '../../types';

export type SkillsTab = 'gaps' | 'learning';
export type GapLoadStatus = 'idle' | 'loading' | 'ready' | 'error';

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

const PROGRESS_NOTE = 'Progress is a guide you update yourself. It is not a verified skill score. Kareerly does not verify course completion. Skills you add with "I already have this skill" are added to your skill list and your matches are refreshed.';

/** Skill rows, with the course the progress control drives. */
type SkillRow = {
  key: string;
  skill: GapSkill;
  status: SkillProgressStatus;
  courses: DashboardCourse[];
};

type CompletedItem = {
  key: string;
  name: string;
  reason: 'owned' | 'done';
  row?: SkillRow;
};

export type SkillGapsPageProps = {
  /** Grouped by skill, with courses keyed by skill. */
  report: SkillGapReport | null;
  /** Grouped by job; loaded when the By Job view is open. */
  jobReport: SkillGapReport | null;
  status: GapLoadStatus;
  error?: string;
  onRetry: () => void;
  scope: GapScope;
  onScope: (scope: GapScope) => void;
  groupBy: GapGroupBy;
  onGroupBy: (groupBy: GapGroupBy) => void;
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
  /** A match refresh is running (after "I already have this skill"). */
  busy?: boolean;
  onOpenMatches: () => void;
};

function ImpactMeter({ bars, label }: { bars: number; label: string }) {
  return (
    <span className="k-impact" role="img" aria-label={label} title={label}>
      {[1, 2, 3].map((bar) => <span key={bar} className={`k-impact-bar ${bar <= bars ? 'k-impact-bar-on' : ''}`} />)}
    </span>
  );
}

function ProgressBadge({ value }: { value: GapProgress }) {
  if (value === 'in_progress') return <span className="k-badge k-badge-info">In progress</span>;
  return <span className="k-badge k-badge-outline">Not started</span>;
}

/** A "Show N more" / "Show less" toggle that stays the focused element when the list grows or shrinks. */
function ShowMoreButton({ expanded, controls, onToggle, children }: { expanded: boolean; controls: string; onToggle: () => void; children: ReactNode }) {
  return (
    <button className="k-btn k-btn-ghost k-show-more" type="button" aria-expanded={expanded} aria-controls={controls} onClick={onToggle}>
      {children}
    </button>
  );
}

export function SkillGapsPage({
  report,
  jobReport,
  status,
  error,
  onRetry,
  scope,
  onScope,
  groupBy,
  onGroupBy,
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
  busy = false,
  onOpenMatches,
}: SkillGapsPageProps) {
  const [selectedKey, setSelectedKey] = useState('');
  // Phone width: the detail is its own view; this is the skill it shows.
  const [mobileKey, setMobileKey] = useState('');
  const [expandedTiers, setExpandedTiers] = useState<Partial<Record<GapTier, boolean>>>({});
  const [completedOpen, setCompletedOpen] = useState(false);
  const [aspirationOpen, setAspirationOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [claimTarget, setClaimTarget] = useState<GapSkill | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const listScroll = useRef(0);
  const returnFocusKey = useRef('');

  const rules = report?.rules;
  const toRow = (skill: GapSkill): SkillRow => {
    const key = gapRecordKey(skill);
    return {
      key,
      skill,
      status: skillProgressRecords[key]?.status || 'missing',
      courses: (report?.courses_by_skill?.[skill.skill_id]?.courses || []).map(mapRunLearningRecommendation).filter((course) => course.reviewed),
    };
  };
  const { open, completed: completedSkills } = useMemo(
    () => openAndCompleted(report, claimedSkills, skillProgressRecords),
    [report, claimedSkills, skillProgressRecords],
  );
  const openRows = open.map(toRow);
  const rowByKey = new Map(openRows.map((row) => [row.key, row]));
  // Skills the candidate has stay listed after the refresh drops them from the gaps.
  const completed: CompletedItem[] = [
    // Claimed names are already the canonical labels the gap rows showed.
    ...Object.entries(claimedSkills).map(([key, item]) => ({ key, name: item.skillName.trim(), reason: 'owned' as const })),
    ...completedSkills.filter((item) => item.reason === 'done').map(({ skill }) => {
      const row = toRow(skill);
      return { key: row.key, name: skill.skill_name, reason: 'done' as const, row };
    }),
  ].filter((item, index, list) => list.findIndex((other) => other.key === item.key) === index)
    .sort((a, b) => a.name.localeCompare(b.name));
  const completedKeys = new Set(completed.map((item) => item.key));

  // The search box shows only for long lists; a query typed before the list shrank is ignored.
  const searchable = rules ? showSkillSearch(open.length, rules) : false;
  const activeQuery = searchable ? query : '';
  const visibleSections = rules ? buildTierSections(open, rules, expandedTiers, activeQuery) : [];
  const visibleRows = visibleSections.flatMap((section) => section.visible.map((skill) => rowByKey.get(gapRecordKey(skill))!));
  const selected = (isDesktop ? rowByKey.get(selectedKey) || visibleRows[0] : rowByKey.get(mobileKey)) || null;

  const notStarted = openRows.filter((row) => gapProgress(row.status) === 'missing').length;
  const inProgress = openRows.filter((row) => gapProgress(row.status) === 'in_progress').length;

  // Back from the phone detail view: return to the row that opened it.
  useEffect(() => {
    if (mobileKey || !returnFocusKey.current) return;
    const key = returnFocusKey.current;
    returnFocusKey.current = '';
    window.scrollTo({ top: listScroll.current });
    rowRefs.current.get(key)?.focus();
  }, [mobileKey]);

  const openRow = (row: SkillRow) => {
    setSelectedKey(row.key);
    if (!isDesktop) {
      listScroll.current = window.scrollY;
      setMobileKey(row.key);
      window.scrollTo({ top: 0 });
    }
  };
  const closeMobileDetail = () => {
    returnFocusKey.current = mobileKey;
    setMobileKey('');
  };

  // One progress control drives both the skill and its suggested course, so
  // Skills and Learning never disagree about whether the course is done.
  const changeProgress = (row: SkillRow, value: GapProgress) => {
    const course = row.courses[0];
    const courseTaken = Boolean(course && courseCompletions[course.id]);
    const gap = toDashboardGap(row.skill);
    if (value === 'completed') {
      setAnnouncement(`${row.skill.skill_name} moved to Completed.`);
      if (mobileKey) closeMobileDetail();
      if (course && !courseTaken) {
        onMarkCourseTaken(course);
        onUpdateSkillProgress(row.key, 'completed', course.id);
        return;
      }
      onUpdateSkillProgress(row.key, 'completed', course?.id);
      onAddSkillProof(row.key, gap, course);
      return;
    }
    if (course && courseTaken) onUnmarkCourseTaken(course);
    onUpdateSkillProgress(row.key, value, course?.id);
  };

  const undoCompleted = (item: CompletedItem) => {
    setAnnouncement(`${item.name} is back in your skill gaps.`);
    if (item.reason === 'owned') onUnclaimSkill(item.key);
    else if (item.row) changeProgress(item.row, 'missing');
    else onUpdateSkillProgress(item.key, 'missing');
  };

  const renderRow = (row: SkillRow) => {
    const { skill } = row;
    const titles = Array.from(new Set(skill.jobs.map((job) => job.title).filter(Boolean)));
    const isSelected = isDesktop && selected?.key === row.key;
    return (
      <li key={row.key}>
        <button
          ref={(node) => { if (node) rowRefs.current.set(row.key, node); else rowRefs.current.delete(row.key); }}
          className="k-row k-gap-row"
          type="button"
          onClick={() => openRow(row)}
          aria-current={isSelected ? 'true' : undefined}
        >
          <span className="k-row-main">
            <span className="k-label block">{skill.skill_name}</span>
            <span className="k-meta mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>{requirementSummary(skill)}</span>
              <ProgressBadge value={gapProgress(row.status)} />
            </span>
            <span className="k-meta mt-0.5 block truncate" title={titles.join(', ')}>{titles.join(', ')}</span>
          </span>
          <span className="k-row-end">
            <span className="k-badge k-num" aria-label={`${skill.jobs_needing} job${skill.jobs_needing === 1 ? '' : 's'}`}>
              {skill.jobs_needing} job{skill.jobs_needing === 1 ? '' : 's'}
            </span>
            <ImpactMeter bars={skill.impact_bars} label={skill.impact_label} />
            {!isDesktop && <FontAwesomeIcon className="k-row-chevron" icon={faChevronRight} aria-hidden="true" />}
          </span>
        </button>
      </li>
    );
  };

  const detail = selected && (
    <GapDetail
      row={selected}
      courseTaken={Boolean(selected.courses[0] && courseCompletions[selected.courses[0].id])}
      searchUrl={report?.courses_by_skill?.[selected.skill.skill_id]?.search_url}
      busy={busy}
      showTitle={isDesktop}
      onProgress={(value) => changeProgress(selected, value)}
      onClaim={() => setClaimTarget(selected.skill)}
      onOpenLearning={() => onOpenLearning(selected.skill.skill_name)}
    />
  );

  const scopeOptions = rules?.scopes || [];
  const showUnmatchedNote = Boolean(report && report.totals.unmatched_saved_jobs > 0 && (scope === 'default' || scope === 'saved'));
  const controls = (
    <div className="k-gap-controls">
      <div>
        <span className="k-label mb-1.5 block" aria-hidden="true">Group by</span>
        <Segmented<GapGroupBy>
          label="Group by"
          value={groupBy}
          onChange={onGroupBy}
          options={[{ value: 'skill', label: 'Skill' }, { value: 'job', label: 'Job' }]}
        />
      </div>
      <label className="k-field block min-w-0">
        <span className="k-label">Gaps from</span>
        <select className="k-select mt-1.5" value={scope} onChange={(event) => onScope(event.target.value as GapScope)}>
          {(scopeOptions.length ? scopeOptions : [{ id: scope, label: 'Fit-Now, saved and applied jobs' }]).map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}{report ? ` (${report.scope_counts[option.id]} skill${report.scope_counts[option.id] === 1 ? '' : 's'})` : ''}
            </option>
          ))}
        </select>
      </label>
    </div>
  );

  const claimDialog = claimTarget && (
    <ConfirmDialog
      title={`Add ${claimTarget.skill_name} to your skills?`}
      confirmLabel="Yes, I have this skill"
      busy={busy}
      onCancel={() => setClaimTarget(null)}
      onConfirm={() => {
        const target = claimTarget;
        setClaimTarget(null);
        setAnnouncement(`${target.skill_name} moved to Completed. Your matches are being refreshed.`);
        if (mobileKey) closeMobileDetail();
        onClaimSkill(toDashboardGap(target));
      }}
    >
      <p className="k-secondary">
        Add it only if you could use it at work today, for example from a past job, school, or your own projects.
        It is added to your skill list once, courses for it stop being suggested, and every match that needs it is refreshed.
      </p>
      <p className="k-meta mt-3">{EMPLOYER_CHECK_REMINDER} You can undo this any time under Completed.</p>
    </ConfirmDialog>
  );

  const liveRegion = <p className="sr-only" role="status" aria-live="polite">{announcement}</p>;

  // Phone width: the selected skill's detail replaces the list, with a way back.
  if (!isDesktop && mobileKey && selected) {
    return (
      <div className="k-page">
        <SkillsHeader tab="gaps" onTab={onTab} gapCount={open.length} />
        <div id="skills-panel" role="tabpanel" aria-labelledby="skills-tab-gaps">
          <button className="k-btn k-btn-ghost -ml-3 mt-1" type="button" onClick={closeMobileDetail}>
            <FontAwesomeIcon icon={faArrowLeft} aria-hidden="true" />Back to skills
          </button>
          <article className="mt-2" aria-labelledby="gap-detail-title">
            <h2 id="gap-detail-title" className="k-section-title mb-3">{selected.skill.skill_name}</h2>
            {detail}
          </article>
        </div>
        {claimDialog}
        {liveRegion}
      </div>
    );
  }

  const jobCards = jobReport?.jobs || [];
  const body = () => {
    if (!hasMatches) {
      return (
        <EmptyState
          icon={faPuzzlePiece}
          title="No skill gaps yet"
          text="Skill gaps appear once you have job matches."
          actions={<button className="k-btn k-btn-primary" type="button" onClick={onOpenMatches}>Go to Matches</button>}
        />
      );
    }
    if (status === 'error') {
      return (
        <Banner tone="error" actions={<button className="k-btn k-btn-secondary k-btn-sm" type="button" onClick={onRetry}>Try again</button>}>
          {error || 'Your skill gaps could not be loaded.'}
        </Banner>
      );
    }
    if (!report || !rules || (groupBy === 'job' && !jobReport)) return <SkeletonRows count={5} label="Loading skill gaps" />;
    if (groupBy === 'job') {
      return (
        <>
        <MatchScoreNotice className="mb-3" />
        <ByJobView
          cards={jobCards}
          gapFreeFitNow={jobReport?.totals.gap_free_fit_now_jobs || 0}
          completedKeys={completedKeys}
          aspirationOpen={aspirationOpen}
          onToggleAspiration={() => setAspirationOpen((current) => !current)}
        />
        </>
      );
    }
    return (
      <>
        <p className="k-secondary mb-1">Skills your jobs ask for that your resume doesn't show yet, grouped so one skill lists every job it helps.</p>
        <p className="k-meta mb-4 flex flex-wrap items-center gap-x-1">
          <span><strong className="k-num text-dark">{notStarted}</strong> not started</span>
          <span aria-hidden="true">·</span>
          <span><strong className="k-num text-dark">{inProgress}</strong> in progress</span>
          <span aria-hidden="true">·</span>
          <span><strong className="k-num text-dark">{completed.length}</strong> completed</span>
          <InfoTip label="About skill progress">{PROGRESS_NOTE}</InfoTip>
        </p>
        <div className={isDesktop ? 'k-split' : undefined}>
          <div className="min-w-0 space-y-6">
            {searchable && (
              <SearchField value={query} onChange={setQuery} label="Search skills" placeholder="Search your skill gaps" />
            )}
            {open.length === 0 && (
              <EmptyState
                title="No open skill gaps"
                text={completed.length > 0 ? 'Every skill these jobs ask for is completed. Try another "Gaps from" option.' : 'These jobs show no missing skills. Try another "Gaps from" option.'}
              />
            )}
            {activeQuery.trim() && visibleSections.length === 0 && (
              <p className="k-secondary" role="status">No skills match "{activeQuery.trim()}".</p>
            )}
            {visibleSections.map((section) => {
              const listId = `gap-tier-${section.tier}`;
              const expanded = Boolean(expandedTiers[section.tier]);
              return (
                <section key={section.tier} aria-labelledby={`${listId}-title`}>
                  <div className="mb-2">
                    <h2 id={`${listId}-title`} className="k-section-title flex items-center gap-2">
                      {section.label}<span className="k-count">{section.total}</span>
                    </h2>
                    <p className="k-meta mt-0.5">{section.rule}</p>
                  </div>
                  <ul id={listId} className="k-list" hidden={section.visible.length === 0}>
                    {section.visible.map((skill) => renderRow(rowByKey.get(gapRecordKey(skill))!))}
                  </ul>
                  {(section.limited || expanded) && !activeQuery.trim() && (
                    <ShowMoreButton
                      expanded={expanded}
                      controls={listId}
                      onToggle={() => setExpandedTiers((current) => ({ ...current, [section.tier]: !expanded }))}
                    >
                      {expanded ? 'Show less' : section.headingOnly ? `Show ${section.total} skill${section.total === 1 ? '' : 's'}` : `Show ${section.hidden} more`}
                    </ShowMoreButton>
                  )}
                </section>
              );
            })}
            {completed.length > 0 && (
              <section aria-labelledby="gap-completed-title">
                <h2 id="gap-completed-title" className="k-section-title">
                  <button className="k-btn k-btn-ghost k-completed-toggle -ml-3" type="button" aria-expanded={completedOpen} aria-controls="gap-completed-list" onClick={() => setCompletedOpen((current) => !current)}>
                    <FontAwesomeIcon icon={faChevronRight} className={completedOpen ? 'rotate-90' : undefined} aria-hidden="true" />
                    Completed · {completed.length}
                  </button>
                </h2>
                <ul id="gap-completed-list" className="k-list mt-2" hidden={!completedOpen}>
                  {completed.map((item) => (
                    <li key={`done-${item.key}`} className="k-row">
                      <span className="k-row-main">
                        <span className="k-label block">{item.name}</span>
                        <span className="k-meta mt-0.5 flex items-center gap-1.5">
                          <FontAwesomeIcon icon={item.reason === 'owned' ? faUserCheck : faCheck} className="text-green" aria-hidden="true" />
                          {item.reason === 'owned' ? 'You have this skill' : 'Marked done'}
                        </span>
                      </span>
                      <button className="k-btn k-btn-ghost k-btn-sm" type="button" disabled={busy} onClick={() => undoCompleted(item)} aria-label={`Undo: ${item.name}`}>
                        <FontAwesomeIcon icon={faRotateLeft} aria-hidden="true" />Undo
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
          {isDesktop && detail && (
            <article className="k-split-detail k-detail" aria-label={`${selected.skill.skill_name} details`}>
              <div className="k-detail-scroll pt-5">{detail}</div>
            </article>
          )}
        </div>
      </>
    );
  };

  return (
    <div className="k-page k-skills-page">
      <SkillsHeader tab="gaps" onTab={onTab} gapCount={report ? open.length : undefined} />
      <div id="skills-panel" role="tabpanel" aria-labelledby="skills-tab-gaps">
        {hasMatches && controls}
        {showUnmatchedNote && (
          <p className="k-meta mb-4">
            {report!.totals.unmatched_saved_jobs} saved or applied job{report!.totals.unmatched_saved_jobs === 1 ? ' is' : 's are'} not among your matches, so {report!.totals.unmatched_saved_jobs === 1 ? 'it is' : 'they are'} left out.
          </p>
        )}
        {body()}
      </div>
      {claimDialog}
      {liveRegion}
    </div>
  );
}

function ByJobView({ cards, gapFreeFitNow, completedKeys, aspirationOpen, onToggleAspiration }: {
  cards: GapJobCard[];
  gapFreeFitNow: number;
  completedKeys: Set<string>;
  aspirationOpen: boolean;
  onToggleAspiration: () => void;
}) {
  const fitNow = cards.filter((card) => card.match_type === 'fit_now');
  const aspiration = cards.filter((card) => card.match_type === 'aspiration');
  const renderCard = (card: GapJobCard) => {
    const done = card.gaps.filter((gap) => completedKeys.has(gapKeyOf(gap)));
    const openGaps = card.gaps.filter((gap) => !completedKeys.has(gapKeyOf(gap)));
    return (
      <li key={`${card.job_source}-${card.job_id}`} className="k-card">
        <h3 className="k-item-title">{card.title}</h3>
        <p className="k-meta k-dot-sep mt-0.5">
          {knownValue(card.company) && <span>{card.company}</span>}
          <span>{matchTypeLabel(card.match_type)}</span>
          <span className="k-num">{Math.round(card.match_pct)}% match</span>
        </p>
        <ul className="k-chip-row mt-3" aria-label={`Skill gaps for ${card.title}`}>
          {openGaps.map((gap) => (
            <li key={gap.skill_id} className={`k-skill ${gap.requirement === 'required' ? 'k-skill-missing' : 'k-skill-nice'}`}>
              {gap.skill_name}
              <span className="sr-only">, {requirementLabel(gap.requirement)}</span>
              {gap.other_jobs > 0 && (
                <span className="k-gap-plus" title={`Also needed by ${gap.other_jobs} other job${gap.other_jobs === 1 ? '' : 's'}`}>
                  <span aria-hidden="true">+{gap.other_jobs}</span>
                  <span className="sr-only">, also needed by {gap.other_jobs} other job{gap.other_jobs === 1 ? '' : 's'}</span>
                </span>
              )}
            </li>
          ))}
          {done.map((gap) => (
            <li key={gap.skill_id} className="k-skill k-skill-have">
              <FontAwesomeIcon icon={faCheck} aria-hidden="true" />{gap.skill_name}<span className="sr-only">, completed</span>
            </li>
          ))}
        </ul>
      </li>
    );
  };
  return (
    <div className="space-y-5">
      <p className="k-secondary">Each card lists the skills one job still needs: outlined in orange if required, in grey if nice to have. A "+N" badge means N other jobs need the same skill.</p>
      {fitNow.length > 0 ? (
        <ul className="space-y-3" aria-label="Fit-Now jobs with skill gaps">{fitNow.map(renderCard)}</ul>
      ) : (
        <p className="k-secondary">No Fit-Now job in this view has a skill gap.</p>
      )}
      {gapFreeFitNow > 0 && (
        <p className="k-meta">{gapFreeFitNow} Fit-Now match{gapFreeFitNow === 1 ? ' has' : 'es have'} no skill gaps and {gapFreeFitNow === 1 ? 'is' : 'are'} hidden.</p>
      )}
      {aspiration.length > 0 && (
        <section aria-labelledby="gap-aspiration-title">
          <h2 id="gap-aspiration-title" className="k-section-title flex items-center gap-2">
            Aspiration matches<span className="k-count">{aspiration.length}</span>
          </h2>
          <ShowMoreButton expanded={aspirationOpen} controls="gap-aspiration-list" onToggle={onToggleAspiration}>
            {aspirationOpen ? 'Hide' : `Show ${aspiration.length} Aspiration match${aspiration.length === 1 ? '' : 'es'}`}
          </ShowMoreButton>
          <ul id="gap-aspiration-list" className="mt-2 space-y-3" hidden={!aspirationOpen}>{aspiration.map(renderCard)}</ul>
        </section>
      )}
    </div>
  );
}

// By Job chips carry the canonical key; progress and claims use the record key.
function gapKeyOf(gap: { skill_id: string; skill_name: string }): string {
  return gapRecordKey({ taxonomy_skill_id: taxonomyIdOf(gap.skill_id), skill_name: gap.skill_name });
}

function GapDetail({ row, courseTaken, searchUrl, busy, showTitle, onProgress, onClaim, onOpenLearning }: {
  row: SkillRow;
  courseTaken: boolean;
  searchUrl?: string;
  busy: boolean;
  showTitle: boolean;
  onProgress: (value: GapProgress) => void;
  onClaim: () => void;
  onOpenLearning: () => void;
}) {
  const { skill, courses, status } = row;
  const name = skill.skill_name;
  const value = gapProgress(status);
  const section = (title: string, body: ReactNode) => (
    <section className="mt-6" aria-label={title}>
      <h3 className="k-label mb-2">{title}</h3>
      {body}
    </section>
  );
  return (
    <div>
      {showTitle && <h2 className="k-section-title mb-3">{name}</h2>}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="k-badge k-badge-info"><ImpactMeter bars={skill.impact_bars} label={skill.impact_label} />{skill.impact_label}</span>
        <span className="k-badge">{requirementSummary(skill)}</span>
      </div>
      <p className="k-secondary">{gapExplanation(skill)}</p>

      {section('Needed by', (
        <ul className="k-list">
          {skill.jobs.map((job) => (
            <li key={`${job.job_source}-${job.job_id}`} className="k-row">
              <span className="k-row-main">
                <span className="k-label block">{job.title}</span>
                <span className="k-meta k-dot-sep mt-0.5 block">
                  {knownValue(job.company) && <span>{job.company}</span>}
                  <span>{matchTypeLabel(job.match_type)}</span>
                </span>
              </span>
              <span className="k-row-end">
                <span className={`k-badge ${job.requirement === 'required' ? 'k-badge-warn' : 'k-badge-outline'}`}>
                  {job.requirement === 'required' ? 'Required' : 'Nice'}
                </span>
                <span className="k-num k-meta">{Math.round(job.match_pct)}%</span>
              </span>
            </li>
          ))}
        </ul>
      ))}

      <div className="k-card mt-5">
        <p className="k-label">Already know {name}?</p>
        <p className="k-meta mt-1">Add it to your skills instead of taking a course. It is added once, and every match that needs it is refreshed.</p>
        <button className="k-btn k-btn-secondary mt-3" type="button" disabled={busy} onClick={onClaim}>
          <FontAwesomeIcon icon={faUserCheck} aria-hidden="true" />I already have this skill
        </button>
      </div>

      {section('Learn it', (
        <>
          {courses.length > 0 ? (
            <ul className="k-list">
              {courses.slice(0, 3).map((course) => {
                const url = learningResourceUrl(course);
                return (
                  <li key={course.id} className="k-row">
                    <div className="k-row-main">
                      <div className="k-label">{course.title}</div>
                      <div className="k-meta k-dot-sep mt-0.5">
                        {[course.provider, course.level, course.duration, course.isFree ? 'Free' : '']
                          .map((item) => knownValue(item))
                          .filter((item) => item && !/unknown/i.test(item))
                          .map((item) => <span key={item}>{item}</span>)}
                      </div>
                    </div>
                    {url && (
                      <a className="k-btn k-btn-primary k-btn-sm" href={url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${course.title} (opens in a new tab)`}>
                        Open<FontAwesomeIcon icon={faArrowUpRightFromSquare} aria-hidden="true" />
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="k-secondary">
              No course yet.{' '}
              {searchUrl && (
                <a className="k-link" href={searchUrl} target="_blank" rel="noopener noreferrer">
                  Search the web for a {name} course<FontAwesomeIcon icon={faArrowUpRightFromSquare} aria-hidden="true" />
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              )}
            </p>
          )}
          {courses.length > 0 && (
            <button className="k-link mt-3" type="button" onClick={onOpenLearning}>
              All courses for {name}<FontAwesomeIcon icon={faArrowRight} aria-hidden="true" />
            </button>
          )}
        </>
      ))}

      {section('Track your progress', (
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
          <p className="k-meta mt-2">{value === 'missing' && courses.length === 0 ? 'Set this to In progress when you start learning it.' : skillNextStep(status, name)}</p>
          {value !== 'completed' && <p className="k-meta mt-1">Done moves the skill to Completed. You can undo it there.</p>}
          {courseTaken && courses[0] && <p className="k-meta mt-1">The course is marked done in Learning too.</p>}
        </>
      ))}
    </div>
  );
}

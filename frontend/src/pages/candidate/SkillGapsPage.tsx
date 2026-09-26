import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowRight, faArrowUpRightFromSquare, faCheck, faChevronRight, faPuzzlePiece, faUpload } from '@fortawesome/free-solid-svg-icons';
import { EmptyState, InfoTip, Modal, Tabs } from '../../components/ui';
import { PageHeader } from './common';
import {
  cleanSkillDisplayName,
  knownValue,
  learningResourceUrl,
  normalizeSkill,
  severityBadgeClass,
  SKILL_PROGRESS_PERCENT,
  SKILL_STATUS_LABEL,
  skillNextStep,
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

const PROGRESS_NOTE = 'Progress is a guide you update yourself. It is not a verified skill score, and it does not change your match scores. Kareerly does not verify course completion.';

type Priority = 'all' | SeverityLevel;

type SkillRow = {
  key: string;
  gap: DashboardGap;
  status: SkillProgressStatus;
  percent: number;
  resource?: DashboardCourse;
};

type SkillGapsPageProps = {
  gaps: DashboardGap[];
  jobs: DashboardJob[];
  courses: DashboardCourse[];
  skillProgressRecords: Record<string, SkillProgressRecord>;
  onUpdateSkillProgress: (skillKey: string, status: SkillProgressStatus, selectedResourceId?: string) => void;
  onUploadSkillEvidence: () => void;
  onOpenLearning: (skill?: string) => void;
  onTab: (tab: SkillsTab) => void;
  isDesktop: boolean;
  hasMatches: boolean;
  onOpenMatches: () => void;
};

const PRIORITIES: SeverityLevel[] = ['Critical', 'High', 'Moderate'];

export function SkillGapsPage({
  gaps,
  jobs,
  courses,
  skillProgressRecords,
  onUpdateSkillProgress,
  onUploadSkillEvidence,
  onOpenLearning,
  onTab,
  isDesktop,
  hasMatches,
  onOpenMatches,
}: SkillGapsPageProps) {
  const [priority, setPriority] = useState<Priority>('all');
  const [selectedKey, setSelectedKey] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);

  // Skills the resume already shows for the matched jobs.
  const coveredSkills = useMemo(() => {
    const seen = new Map<string, string>();
    jobs.forEach((job) => job.matchedSkills.forEach((skill) => {
      const key = normalizeSkill(skill);
      if (key && !seen.has(key)) seen.set(key, cleanSkillDisplayName(skill));
    }));
    return Array.from(seen.values());
  }, [jobs]);

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
      const key = (gap.skillId || normalizeSkill(gap.skill)).toUpperCase();
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
    .filter(([key, record]) => record.status === 'covered' && !activeKeys.has(key))
    .map(([, record]) => cleanSkillDisplayName(record.skillName));
  const inProgress = rows.filter((row) => row.status === 'started' || row.status === 'in_progress').length;
  const done = rows.filter((row) => row.status === 'completed' || row.status === 'evidenced').length + closedGaps.length;
  const toBuild = rows.length - rows.filter((row) => row.status === 'completed' || row.status === 'evidenced').length;
  const counts = Object.fromEntries(PRIORITIES.map((level) => [level, rows.filter((row) => row.gap.severity === level).length])) as Record<SeverityLevel, number>;
  const visibleRows = priority === 'all' ? rows : rows.filter((row) => row.gap.severity === priority);
  const selected = visibleRows.find((row) => row.key === selectedKey) || (isDesktop ? visibleRows[0] : null) || null;

  const openRow = (row: SkillRow) => {
    setSelectedKey(row.key);
    if (!isDesktop) setSheetOpen(true);
  };

  const renderRow = (row: SkillRow) => (
    <li key={row.key}>
      <button className="k-row" type="button" onClick={() => openRow(row)} aria-current={isDesktop && selected?.key === row.key ? 'true' : undefined}>
        <span className="k-row-main">
          <span className="k-label block">{cleanSkillDisplayName(row.gap.skill)}</span>
          <span className="k-meta k-dot-sep mt-0.5 block">
            <span>{row.gap.optional ? 'Nice to have' : 'Required'}</span>
            {row.gap.affectedCount !== null && <span>Needed by {row.gap.affectedCount} match{row.gap.affectedCount === 1 ? '' : 'es'}</span>}
            {row.status !== 'missing' && <span className="font-semibold text-green">{SKILL_STATUS_LABEL[row.status]}</span>}
          </span>
        </span>
        <span className="sr-only">, {row.gap.severity} priority</span>
        <FontAwesomeIcon className="k-row-chevron" icon={faChevronRight} aria-hidden="true" />
      </button>
    </li>
  );

  const detail = selected && (
    <GapDetail
      row={selected}
      onStatus={(status) => onUpdateSkillProgress(selected.key, status, selected.resource?.id)}
      onUploadProof={onUploadSkillEvidence}
      onOpenLearning={() => onOpenLearning(cleanSkillDisplayName(selected.gap.skill))}
    />
  );

  return (
    <div className="k-page">
      <SkillsHeader tab="gaps" onTab={onTab} gapCount={rows.length} />
      <div id="skills-panel" role="tabpanel" aria-labelledby="skills-tab-gaps">
        {rows.length === 0 ? (
          <EmptyState
            icon={faPuzzlePiece}
            title={hasMatches ? 'No skill gaps right now' : 'No skill gaps yet'}
            text={hasMatches ? 'Your matches show no missing skills.' : 'Skill gaps appear once you have job matches.'}
            actions={!hasMatches ? <button className="k-btn k-btn-primary" type="button" onClick={onOpenMatches}>Go to Matches</button> : undefined}
          />
        ) : (
          <>
            <p className="k-secondary mb-3 flex flex-wrap items-center gap-x-1">
              <span><strong className="k-num text-dark">{toBuild}</strong> to build</span>
              <span aria-hidden="true">·</span>
              <span><strong className="k-num text-dark">{inProgress}</strong> in progress</span>
              <span aria-hidden="true">·</span>
              <span><strong className="k-num text-dark">{done}</strong> done</span>
              <InfoTip label="About skill progress">{PROGRESS_NOTE}</InfoTip>
            </p>
            <div className="k-chip-scroller mb-4" role="group" aria-label="Filter by priority">
              <button className="k-chip" type="button" aria-pressed={priority === 'all'} onClick={() => setPriority('all')}>
                All <span className="k-chip-count">{rows.length}</span>
              </button>
              {PRIORITIES.filter((level) => counts[level] > 0).map((level) => (
                <button key={level} className="k-chip" type="button" aria-pressed={priority === level} onClick={() => setPriority(level)}>
                  {level} <span className="k-chip-count">{counts[level]}</span>
                </button>
              ))}
            </div>

            <div className={isDesktop ? 'k-split' : undefined}>
              <div className="space-y-5">
                {(priority === 'all' ? PRIORITIES : [priority]).map((level) => {
                  const group = visibleRows.filter((row) => row.gap.severity === level);
                  if (group.length === 0) return null;
                  return (
                    <section key={level} aria-labelledby={`gap-group-${level}`}>
                      <h2 id={`gap-group-${level}`} className="k-eyebrow mb-2">{level}</h2>
                      <ul className="k-list">{group.map(renderRow)}</ul>
                    </section>
                  );
                })}

                {(coveredSkills.length > 0 || closedGaps.length > 0) && (
                  <details className="k-card">
                    <summary className="k-label flex min-h-[28px] cursor-pointer items-center justify-between">
                      Skills you already have
                      <span className="k-meta">{coveredSkills.length + closedGaps.length}</span>
                    </summary>
                    <div className="k-chip-row mt-3 gap-1.5">
                      {[...closedGaps, ...coveredSkills].map((skill) => (
                        <span key={`have-${skill}`} className="k-skill k-skill-have"><FontAwesomeIcon icon={faCheck} aria-hidden="true" />{skill}</span>
                      ))}
                    </div>
                  </details>
                )}
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
    </div>
  );
}

function GapDetail({ row, onStatus, onUploadProof, onOpenLearning }: {
  row: SkillRow;
  onStatus: (status: SkillProgressStatus) => void;
  onUploadProof: () => void;
  onOpenLearning: () => void;
}) {
  const { gap, resource, status } = row;
  const name = cleanSkillDisplayName(gap.skill);
  const url = resource ? learningResourceUrl(resource) : undefined;
  const progressValue: 'missing' | 'in_progress' | 'completed' = status === 'completed' || status === 'evidenced' || status === 'covered'
    ? 'completed'
    : status === 'started' || status === 'in_progress' ? 'in_progress' : 'missing';
  const section = (title: string, body: ReactNode) => (
    <section className="mt-5 first:mt-0">
      <h3 className="k-label mb-2">{title}</h3>
      {body}
    </section>
  );
  return (
    <div>
      <div className="mb-4 hidden flex-wrap items-center gap-2 lg:flex">
        <h2 className="k-section-title mr-1">{name}</h2>
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        <span className={severityBadgeClass(gap.severity)}>{gap.severity} priority</span>
        <span className="k-badge">{gap.optional ? 'Nice to have' : 'Required'}</span>
      </div>

      {section('Needed by', gap.relatedJobs.length > 0 ? (
        <div className="k-chip-row gap-1.5">{gap.relatedJobs.map((title) => <span key={title} className="k-skill">{title}</span>)}</div>
      ) : <p className="k-secondary">{gap.affectedCount !== null ? `${gap.affectedCount} of your matches.` : 'Job details unavailable.'}</p>)}

      {section('Start with', resource ? (
        <div className="k-list">
          <div className="k-row">
            <div className="k-row-main">
              <div className="k-label">{resource.title}</div>
              <div className="k-meta k-dot-sep mt-0.5">
                {[resource.provider, resource.level, resource.duration, resource.isFree ? 'Free' : ''].map((value) => knownValue(value)).filter(Boolean).map((value) => <span key={value}>{value}</span>)}
              </div>
            </div>
            {url && (
              <a className="k-btn k-btn-primary k-btn-sm" href={url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${resource.title} (opens in a new tab)`}>
                Open<FontAwesomeIcon icon={faArrowUpRightFromSquare} aria-hidden="true" />
              </a>
            )}
          </div>
        </div>
      ) : <p className="k-secondary">No resource is listed for {name} yet.</p>)}
      <button className="k-link mt-3" type="button" onClick={onOpenLearning}>
        All resources for {name}<FontAwesomeIcon icon={faArrowRight} aria-hidden="true" />
      </button>

      {section('Your progress', (
        <>
          <div className="k-seg" role="radiogroup" aria-label={`Progress on ${name}`}>
            {([['missing', 'Not started'], ['in_progress', 'In progress'], ['completed', 'Done']] as const).map(([value, label]) => (
              <button
                key={value}
                className="k-seg-btn"
                type="button"
                role="radio"
                aria-checked={progressValue === value}
                onClick={() => { if (progressValue !== value) onStatus(value); }}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="k-meta mt-2">{skillNextStep(status, name)}</p>
          {(status === 'completed' || status === 'in_progress' || status === 'started') && (
            <button className="k-btn k-btn-ghost k-btn-sm mt-2 -ml-3" type="button" onClick={onUploadProof}>
              <FontAwesomeIcon icon={faUpload} aria-hidden="true" />Add proof
            </button>
          )}
          {status === 'evidenced' && <p className="k-badge k-badge-info mt-2">Proof uploaded · pending review</p>}
        </>
      ))}
    </div>
  );
}

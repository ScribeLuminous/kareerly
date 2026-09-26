import type { EvidenceUploadRecord } from '../../lib/evidence';
import { useMemo, useState } from 'react';
import { UIIcon, type IconName } from './icons';
import { SKILL_PROGRESS_PERCENT, SKILL_STATUS_LABEL, cleanSkillDisplayName, formatGapMissingCount, learningResourceUrl, normalizeProgressLabel, normalizeSkill, severityClass, skillNextStep, type DashboardCourse, type DashboardGap, type DashboardJob, type SeverityLevel, type SkillProgressRecord, type SkillProgressStatus } from './model';

export function SkillGapEmptyState() {
  return (
    <div className="cand-gap-empty-state">
      <UIIcon name="puzzle" className="cand-gap-empty-icon" />
      <div>
        <h3 className="cand-gap-empty-title">No skills to develop yet</h3>
        <p className="cand-gap-empty-description">Your skill gaps will appear here after Kareerly identifies missing skills from your job matches.</p>
      </div>
    </div>
  );
}

export function SkillGapsPage({
  gaps,
  jobs,
  courses,
  evidenceRecords,
  skillProgressRecords,
  onUpdateSkillProgress,
  onUploadSkillEvidence,
  onOpenUpskilling,
}: {
  gaps: DashboardGap[];
  jobs: DashboardJob[];
  courses: DashboardCourse[];
  evidenceRecords: EvidenceUploadRecord[];
  skillProgressRecords: Record<string, SkillProgressRecord>;
  onUpdateSkillProgress: (skillKey: string, status: SkillProgressStatus, selectedResourceId?: string) => void;
  onUploadSkillEvidence: () => void;
  onOpenUpskilling: () => void;
}) {
  const [activeSkillGapView, setActiveSkillGapView] = useState<'board' | 'progress'>('board');
  const [selectedSkillKey, setSelectedSkillKey] = useState('');
  const skillGapTabOrder = ['board', 'progress'] as const;
  const selectSkillGapView = (view: 'board' | 'progress') => setActiveSkillGapView(view);
  const handleSkillGapTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = skillGapTabOrder.indexOf(activeSkillGapView);
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? skillGapTabOrder.length - 1
        : (currentIndex + (event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1) + skillGapTabOrder.length) % skillGapTabOrder.length;
    const nextView = skillGapTabOrder[nextIndex];
    selectSkillGapView(nextView);
    window.setTimeout(() => document.getElementById(`skill-gap-tab-${nextView}`)?.focus(), 0);
  };

  // Skills the resume already shows for the matched jobs.
  const coveredSkills = useMemo(() => {
    const seen = new Map<string, string>();
    jobs.forEach((job) => job.matchedSkills.forEach((skill) => {
      const key = normalizeSkill(skill);
      if (key && !seen.has(key)) seen.set(key, cleanSkillDisplayName(skill));
    }));
    return Array.from(seen.values());
  }, [jobs]);

  const boardGaps = useMemo(() => gaps.map((gap) => ({ ...gap, boardSeverity: gap.severity })), [gaps]);

  const critical = boardGaps.filter((gap) => gap.boardSeverity === 'Critical');
  const high = boardGaps.filter((gap) => gap.boardSeverity === 'High');
  const moderate = boardGaps.filter((gap) => gap.boardSeverity === 'Moderate');
  const totalCoveredSkills = coveredSkills.length;
  const progressEntries = Object.values(skillProgressRecords);
  const activeMissingCount = progressEntries.filter((record) => ['missing', 'started', 'in_progress'].includes(record.status)).length || gaps.length;
  const inProgressCount = progressEntries.filter((record) => ['started', 'in_progress'].includes(record.status)).length;
  const completedCount = progressEntries.filter((record) => ['completed', 'evidenced', 'covered'].includes(record.status)).length;
  const evidenceUploadedCount = progressEntries.filter((record) => Boolean(record.evidenceFilename)).length || evidenceRecords.length;
  const recommendedResourceByGap = useMemo(() => {
    const map = new Map<string, DashboardCourse>();
    gaps.forEach((gap) => {
      const match = [...(gap.topResources || []), ...courses].find((course) =>
        course.reviewed && course.mappedSkills.some((skill) => normalizeSkill(skill) === normalizeSkill(gap.skill)));
      if (match) map.set(gap.skill, match);
    });
    return map;
  }, [courses, gaps]);
  // One row per missing skill: required gaps first, then by severity, then least progress.
  const skillRows = useMemo(() => {
    const severityRank: Record<SeverityLevel, number> = { Critical: 0, High: 1, Moderate: 2 };
    return gaps.map((gap) => {
      const key = (gap.skillId || normalizeSkill(gap.skill)).toUpperCase();
      const record = skillProgressRecords[key];
      const status: SkillProgressStatus = record?.status || 'missing';
      return {
        key,
        gap,
        status,
        percent: record?.progressPercent ?? SKILL_PROGRESS_PERCENT[status],
        evidenceFilename: record?.evidenceFilename,
        resource: recommendedResourceByGap.get(gap.skill),
      };
    }).sort((a, b) => Number(Boolean(a.gap.optional)) - Number(Boolean(b.gap.optional))
      || severityRank[a.gap.severity] - severityRank[b.gap.severity]
      || a.percent - b.percent
      || a.gap.skill.localeCompare(b.gap.skill));
  }, [gaps, recommendedResourceByGap, skillProgressRecords]);
  const activeGapKeys = new Set(skillRows.map((row) => row.key));
  const closedGaps = Object.entries(skillProgressRecords)
    .filter(([key, record]) => record.status === 'covered' && !activeGapKeys.has(key))
    .map(([, record]) => cleanSkillDisplayName(record.skillName));
  const selectedRow = skillRows.find((row) => row.key === selectedSkillKey) || skillRows[0] || null;
  const hasAnyProgressData = gaps.length > 0;
  const summaryCards = [
    { label: 'Missing Skills', value: activeMissingCount, tone: 'critical', icon: 'puzzle' as IconName, subtitle: 'Still missing from top matches' },
    { label: 'In Progress', value: inProgressCount, tone: 'high', icon: 'graduation' as IconName, subtitle: 'Active learning underway' },
    { label: 'Completed / Covered', value: Math.max(totalCoveredSkills, completedCount), tone: 'progress', icon: 'check-circle' as IconName, subtitle: 'Covered by skills or learning' },
    { label: 'Evidence Uploaded', value: evidenceUploadedCount, tone: 'evidence', icon: 'upload' as IconName, subtitle: 'Supporting documents on file' },
  ] as const;
  return (
    <div>
      <div className="cand-page-header">
        <div className="cand-learning-header-row">
          <div>
            <h1 className="cand-page-title">Skill Gaps & Development Progress</h1>
            <p className="cand-page-subtitle">Missing skills identified from your job matches with guided development tracking</p>
          </div>
          <button className="cand-inline-link" type="button" onClick={onOpenUpskilling}>Explore Learning Recommendations →</button>
        </div>
      </div>

      <div className="cand-gap-insights-bar">
        {summaryCards.map((card) => (
          <div key={card.label} className={`cand-gap-insight ${card.tone}`}>
            <div className="cand-gap-insight-label"><UIIcon name={card.icon} className="cand-mini-icon" />{card.label}</div>
            <div className="cand-gap-insight-value">{card.value}</div>
            <div className="cand-gap-insight-subtitle">{card.subtitle}</div>
          </div>
        ))}
      </div>

      <div className="cand-tab-row cand-gap-view-tabs cand-skill-gap-tabs" role="tablist" aria-label="Skill gaps views">
          <button
            id="skill-gap-tab-board"
            className={`cand-tab-btn ${activeSkillGapView === 'board' ? 'active' : ''}`}
            type="button"
            role="tab"
            aria-selected={activeSkillGapView === 'board'}
            aria-controls="skill-gap-board-panel"
            tabIndex={activeSkillGapView === 'board' ? 0 : -1}
            onClick={() => selectSkillGapView('board')}
            onKeyDown={handleSkillGapTabKeyDown}
          >
            <UIIcon name="columns" className="cand-tab-icon" />Skill Gap Board
          </button>
          <button
            id="skill-gap-tab-progress"
            className={`cand-tab-btn ${activeSkillGapView === 'progress' ? 'active' : ''}`}
            type="button"
            role="tab"
            aria-selected={activeSkillGapView === 'progress'}
            aria-controls="skill-gap-progress-panel"
            tabIndex={activeSkillGapView === 'progress' ? 0 : -1}
            onClick={() => selectSkillGapView('progress')}
            onKeyDown={handleSkillGapTabKeyDown}
          >
            <UIIcon name="chart" className="cand-tab-icon" />Development Progress
          </button>
      </div>

      {activeSkillGapView === 'board' ? (
        <div id="skill-gap-board-panel" role="tabpanel" aria-labelledby="skill-gap-tab-board" tabIndex={0}>
          <h2 className="cand-card-title cand-gap-content-title mb-3"><UIIcon name="columns" className="cand-title-icon" />Skills to Develop</h2>
          {!hasAnyProgressData ? (
            <SkillGapEmptyState />
          ) : (
          <div className="cand-gap-kanban">
            {[
              { key: 'critical', title: 'Critical', icon: 'shield' as IconName, severity: 'Critical' as SeverityLevel, items: critical },
              { key: 'high', title: 'High Priority', icon: 'lightbulb' as IconName, severity: 'High' as SeverityLevel, items: high },
              { key: 'moderate', title: 'Moderate', icon: 'list' as IconName, severity: 'Moderate' as SeverityLevel, items: moderate },
            ].map((column) => (
              <div key={column.key} className="cand-gap-col">
                <div className={`cand-gap-col-head ${column.key}`}>
                  <UIIcon name={column.icon} className="cand-gap-col-icon" />
                  {column.title}
                  <span className="cand-gap-col-count">{column.items.length}</span>
                </div>
                <div className="cand-gap-col-body">
                  {column.items.length > 0 ? column.items.map((gap) => {
                    const progressKey = (gap.skillId || normalizeSkill(gap.skill)).toUpperCase();
                    const recommendedResource = recommendedResourceByGap.get(gap.skill);
                    return (
                      <div key={`${column.key}-${gap.skill}`} className="cand-gap-k-card">
                        <div className="cand-gap-top">
                          <span className="cand-gap-name">{cleanSkillDisplayName(gap.skill)}</span>
                          <span className={`cand-gap-priority ${severityClass(column.severity)}`}>{column.title}</span>
                        </div>
                        <div className="cand-gap-meta">
                          <span><UIIcon name="briefcase" className="cand-mini-icon" />{formatGapMissingCount(gap)}</span>
                          <span><UIIcon name="target" className="cand-mini-icon" />{gap.category}</span>
                        </div>
                        <div className="text-[11px] text-soft-text">
                          {gap.affectedCount === null
                            ? 'This skill was identified as a gap in your matching results.'
                            : gap.optional
                              ? `A nice-to-have skill, not found in your resume, for ${gap.affectedCount} of your recommended roles.`
                              : `This skill is prioritized because it is a required skill not found in your resume for ${gap.affectedCount} of your recommended roles.`}
                        </div>
                        <div className="cand-gap-jobs">
                          {gap.relatedJobs.map((jobTitle) => (
                            <span key={`${gap.skill}-${jobTitle}`} className="cand-gap-chip">{jobTitle}</span>
                          ))}
                        </div>
                        <div className="cand-gap-learning">
                          <div className="cand-gap-label">Recommended Learning Resource</div>
                          <div className="cand-gap-value">
                            {recommendedResource ? `${recommendedResource.title} (${recommendedResource.provider})` : 'No recommended learning resource available yet.'}
                          </div>
                          {gap.topResources && gap.topResources.length > 1 ? (
                            <div className="mt-2 text-[11px] text-soft-text">
                              More options: {gap.topResources.slice(1, 3).map((resource) => resource.title).join(' · ')}
                            </div>
                          ) : null}
                        </div>
                        <p className="mt-2 text-xs text-soft-text">Learning and certificates are managed by the provider. Kareerly does not verify completion. Opening a resource does not change skill coverage, readiness, or match scores.</p>
                        <div className="cand-gap-actions">
                          <button className="cand-gap-start" type="button" disabled={!recommendedResource || !learningResourceUrl(recommendedResource)} onClick={() => {
                            const url = recommendedResource && learningResourceUrl(recommendedResource);
                            if (url) window.open(url, '_blank', 'noopener,noreferrer');
                          }}>
                            <UIIcon name="graduation" className="cand-btn-icon" />{recommendedResource?.urlLabel || 'Start learning'}
                          </button>
                          <button className="cand-gap-resource" type="button" onClick={() => onUpdateSkillProgress(progressKey, 'completed', recommendedResource?.id)}>
                            Mark Completed
                          </button>
                          <button className="cand-gap-resource cand-gap-upload" type="button" onClick={onUploadSkillEvidence}>
                            Upload Evidence
                          </button>
                          <button className="cand-gap-resource" type="button" onClick={onOpenUpskilling}>
                            View resources
                          </button>
                        </div>
                      </div>
                    );
                  }) : <div className="cand-gap-empty">No items in this column.</div>}
                </div>
              </div>
            ))}
          </div>
          )}
        </div>
      ) : (
        <div id="skill-gap-progress-panel" role="tabpanel" aria-labelledby="skill-gap-tab-progress" tabIndex={0}>
          <h2 className="cand-card-title cand-gap-content-title mb-2"><UIIcon name="chart" className="cand-title-icon" />Your Development Progress</h2>
          <p className="mb-3 text-xs text-soft-text">
            Progress is an explainable career-guidance indicator, not a mastery-verification score.
          </p>

          {skillRows.length === 0 ? (
            <SkillGapEmptyState />
          ) : (
          <div className="cand-sdp-dual">
            <div className="cand-sdp-list">
              <div className="cand-sdp-list-head">Skills to Develop ({skillRows.length})</div>
              {skillRows.map((row) => {
                const chip = normalizeProgressLabel(row.percent);
                return (
                  <button key={`sdp-skill-${row.key}`} type="button" className={`cand-sdp-row-item ${selectedRow?.key === row.key ? 'active' : ''}`} onClick={() => setSelectedSkillKey(row.key)} aria-pressed={selectedRow?.key === row.key}>
                    <div className="cand-sdp-row-left">
                      <div className="cand-sdp-row-name">{row.gap.skill}</div>
                      <div className="cand-sdp-row-counts">
                        {row.gap.optional ? 'Nice to have' : 'Required'} · {row.gap.severity} · needed by {row.gap.relatedJobs.length || row.gap.affectedCount || 0} match{(row.gap.relatedJobs.length || row.gap.affectedCount || 0) === 1 ? '' : 'es'}
                      </div>
                      <div className={chip.className}>{SKILL_STATUS_LABEL[row.status]}</div>
                      <div className="cand-sdp-mini-bar">
                        <div className="cand-sdp-mini-fill" style={{ width: `${row.percent}%`, background: 'var(--rust)' }} />
                      </div>
                    </div>
                    <div className="cand-sdp-row-right">
                      <div className="cand-sdp-row-pct">{row.percent}%</div>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="cand-sdp-detail">
              {selectedRow && (
                <>
                  <div className="cand-sdp-detail-head">
                    <h3 className="cand-sdp-detail-title">{selectedRow.gap.skill}</h3>
                    <span className={normalizeProgressLabel(selectedRow.percent).className}>{SKILL_STATUS_LABEL[selectedRow.status]}</span>
                  </div>
                  <div className="cand-sdp-detail-bar-row">
                    <div className="cand-sdp-detail-bar">
                      <div className="cand-sdp-detail-fill" style={{ width: `${selectedRow.percent}%`, background: 'var(--rust)' }} />
                    </div>
                    <span className="cand-sdp-detail-pct">{selectedRow.percent}%</span>
                  </div>

                  <div className="cand-sdp-detail-section">Needed By</div>
                  <div className="cand-skill-row">
                    {selectedRow.gap.relatedJobs.length > 0
                      ? selectedRow.gap.relatedJobs.map((title) => <span key={`needed-${selectedRow.key}-${title}`} className="cand-gap-chip">{title}</span>)
                      : <span className="cand-covered-empty">Job details unavailable.</span>}
                  </div>
                  <div className="cand-sdp-row-counts">{selectedRow.gap.optional
                    ? 'Nice to have for these jobs: learning it strengthens your match but is not required.'
                    : 'Required by at least one of these jobs.'}</div>

                  <div className="cand-sdp-detail-section">Suggested Resource</div>
                  {selectedRow.resource ? (
                    <div className="cand-sdp-next-action">
                      <strong>{selectedRow.resource.title}</strong> · {selectedRow.resource.provider}
                      {selectedRow.resource.url && (
                        <> · <a href={selectedRow.resource.url} target="_blank" rel="noopener noreferrer">{selectedRow.resource.urlLabel}</a></>
                      )}
                    </div>
                  ) : (
                    <div className="cand-sdp-next-action">No resource is listed for this skill yet. Browse Learning Recommendations for related training.</div>
                  )}

                  <div className="cand-sdp-detail-section">Next Step</div>
                  <div className="cand-sdp-next-action">{skillNextStep(selectedRow.status, selectedRow.gap.skill)}</div>
                  <div className="cand-sdp-action-row">
                    {selectedRow.status === 'missing' && (
                      <button className="cand-btn-secondary cand-btn-sm" type="button" onClick={() => onUpdateSkillProgress(selectedRow.key, 'started', selectedRow.resource?.id)}>
                        <UIIcon name="graduation" className="cand-btn-icon" />Mark as Started
                      </button>
                    )}
                    {selectedRow.status === 'completed' ? (
                      <button className="cand-btn-primary cand-btn-sm" type="button" onClick={onUploadSkillEvidence}>
                        <UIIcon name="upload" className="cand-btn-icon" />Upload Proof
                      </button>
                    ) : (
                      <button className="cand-btn-primary cand-btn-sm" type="button" onClick={onOpenUpskilling}>
                        <UIIcon name="graduation" className="cand-btn-icon" />Open Learning Recommendations
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
          )}

          {(coveredSkills.length > 0 || closedGaps.length > 0) && (
            <div className="cand-sdp-detail mt-3">
              {closedGaps.length > 0 && (
                <>
                  <div className="cand-sdp-detail-section">Gaps You Closed</div>
                  <div className="cand-skill-row">
                    {closedGaps.map((skill) => <span key={`closed-${skill}`} className="cand-skill-match"><UIIcon name="check-circle" className="cand-chip-icon" />{skill}</span>)}
                  </div>
                </>
              )}
              {coveredSkills.length > 0 && (
                <>
                  <div className="cand-sdp-detail-section">Skills You Already Have</div>
                  <div className="cand-skill-row">
                    {coveredSkills.map((skill) => <span key={`covered-${skill}`} className="cand-skill-match"><UIIcon name="check-circle" className="cand-chip-icon" />{skill}</span>)}
                  </div>
                </>
              )}
            </div>
          )}
          <div className="cand-sdp-disclaimer">
            Skill Development Progress remains an explainable indicator for guidance and does not certify verified competency or guarantee employment.
          </div>
        </div>
      )}
    </div>
  );
}

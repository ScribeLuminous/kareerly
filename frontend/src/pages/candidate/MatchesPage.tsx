import { useCallback, type ReactNode } from 'react';
import MatchFeedbackControls from '../../components/MatchFeedbackControls';
import { matchFeedbackKey, type MatchFeedbackStatus, type MatchVote } from '../../lib/matchFeedback';
import type { JobMatchRunResults } from '../../types';
import RegionFilterNotice from '../../components/RegionFilterNotice';
import { buildJobExplanation, cleanSkillDisplayName, compactCompanyBadge, getMatchBadgeLabel, getMatchReadinessClass, getMatchScoreColor, getRecommendedNextStep, matchCategoryBadge, orderByBackendRank, type DashboardApplication, type DashboardJob, type JobFilter } from './model';
import { UIIcon, type IconName } from './icons';

export function JobMatchesPage({
  jobs,
  topMatchesCount,
  allMatchesCount,
  jobSearch,
  jobFilter,
  applications,
  savedJobs,
  savedJobRows,
  fitNowCount,
  aspirationCount,
  onSearch,
  onFilter,
  onSave,
  onApply,
  onView,
  onVisitSite,
  matchFeedback,
  matchFeedbackStatus,
  onRateMatch,
  locationFilter,
  reportHasMatches,
  isBusy,
  onChangeRegion,
  onRemoveRegionFilter,
}: {
  jobs: DashboardJob[];
  topMatchesCount: number;
  allMatchesCount: number;
  jobSearch: string;
  jobFilter: JobFilter;
  applications: DashboardApplication[];
  savedJobs: Set<string>;
  savedJobRows: DashboardJob[];
  fitNowCount: number;
  aspirationCount: number;
  onSearch: (value: string) => void;
  onFilter: (value: JobFilter) => void;
  onSave: (jobId: string) => void;
  onApply: (job: DashboardJob) => Promise<boolean>;
  onView: (job: DashboardJob) => void;
  onVisitSite: (job: DashboardJob) => void;
  matchFeedback: Record<string, MatchVote>;
  matchFeedbackStatus: Record<string, MatchFeedbackStatus>;
  onRateMatch: (job: DashboardJob, vote: MatchVote) => void;
  locationFilter: JobMatchRunResults['location_filter'];
  reportHasMatches: boolean;
  isBusy: boolean;
  onChangeRegion: () => void;
  onRemoveRegionFilter: () => void;
}) {
  // Each column is sized to its tallest first card so one whole match, down to
  // its Apply/View/Save buttons, is visible before the column needs scrolling.
  const matchGroupsRef = useCallback((node: HTMLDivElement | null) => {
    if (!node || typeof ResizeObserver === 'undefined') return undefined;
    const syncHeight = () => {
      let tallest = 0;
      node.querySelectorAll<HTMLElement>('.cand-match-group-scroll > .cand-job-card:first-child').forEach((card) => {
        tallest = Math.max(tallest, card.offsetHeight);
      });
      if (tallest > 0) node.style.setProperty('--cand-first-card-h', `${tallest}px`);
      else node.style.removeProperty('--cand-first-card-h');
    };
    const resizeObserver = new ResizeObserver(syncHeight);
    const observeFirstCards = () => {
      resizeObserver.disconnect();
      node.querySelectorAll<HTMLElement>('.cand-match-group-scroll > .cand-job-card:first-child').forEach((card) => resizeObserver.observe(card));
      syncHeight();
    };
    // Search, filters and feedback swap which card is first, so re-observe on DOM changes.
    const mutationObserver = new MutationObserver(observeFirstCards);
    mutationObserver.observe(node, { childList: true, subtree: true });
    observeFirstCards();
    return () => {
      mutationObserver.disconnect();
      resizeObserver.disconnect();
    };
  }, []);
  const fitNowJobs = orderByBackendRank(jobs.filter((job) => job.matchCategory === 'fit-now'));
  const aspirationJobs = orderByBackendRank(jobs.filter((job) => job.matchCategory === 'aspiration'));
  const savedTableRows = savedJobRows.filter((job) => {
    const query = jobSearch.trim().toLowerCase();
    return !query || [job.title, job.company, job.location, job.category || '', job.subCategory || ''].join(' ').toLowerCase().includes(query);
  });

  const groupedSections =
    jobFilter === 'fit-now'
      ? [{ key: 'fit-now', title: 'Fit-Now Opportunities', icon: 'check-circle' as IconName, items: fitNowJobs }]
      : jobFilter === 'aspiration'
        ? [{ key: 'aspiration', title: 'Aspiration Opportunities', icon: 'rocket' as IconName, items: aspirationJobs }]
        : [
            { key: 'fit-now', title: 'Fit-Now Opportunities', icon: 'check-circle' as IconName, items: fitNowJobs },
            { key: 'aspiration', title: 'Aspiration Opportunities', icon: 'rocket' as IconName, items: aspirationJobs },
          ];

  const renderJobCard = (job: DashboardJob) => {
    const activeApplication = applications.find((app) => app.jobId === job.id && app.jobSource === job.jobSource && app.status !== 'Withdrawn') || null;
    return (
    <div key={job.id} className="cand-job-card">
      <div className="cand-job-top">
        <div className="cand-job-left">
          <div className="cand-job-icon" style={{ background: getMatchScoreColor(job) }}>
            {compactCompanyBadge(job.company)}
          </div>
          <div>
            <div className="cand-job-title">
              {job.title}
              <span className={`cand-type-tag ${job.sourceType === 'internal' ? 'cand-type-internal' : 'cand-type-external'}`}>
                {job.sourceType === 'internal' ? 'Internal' : 'External'}
              </span>
            </div>
            <div className="cand-job-meta-row">
              <span><UIIcon name="building" className="cand-mini-icon" />{job.company}</span>
              <span><UIIcon name="location" className="cand-mini-icon" />{job.location}</span>
              <span><UIIcon name="setup" className="cand-mini-icon" />{job.setup}</span>
            </div>
            <div className="cand-badge-row">
              {job.category && <span className="cand-job-badge">{job.category}</span>}
              {job.subCategory && <span className="cand-job-badge tan">{job.subCategory}</span>}
              {job.jobLevel && <span className="cand-job-badge amber">{job.jobLevel}</span>}
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className={`cand-match-badge friendly ${getMatchReadinessClass(job.matchScore)}`}>
            {getMatchBadgeLabel(job)}
          </div>
          <div>
            <span className={`cand-match-cat ${job.matchCategory === 'fit-now' ? 'cand-cat-fit' : 'cand-cat-aspiration'}`}>
              {job.hasMatchScore ? matchCategoryBadge(job) : 'Match not available'}
            </span>
          </div>
        </div>
      </div>

      <div className="cand-job-section">
        <div className="cand-job-section-label">Why this job matches you</div>
        <p className="cand-job-desc-preview">{buildJobExplanation(job)}</p>
      </div>

      <div className="cand-job-section">
        <div className="cand-job-section-label">Your Matching Skills</div>
        <div className="cand-skill-row">
          {job.matchedSkills.length > 0 ? job.matchedSkills.slice(0, 6).map((skill) => (
            <span key={`${job.id}-match-${skill}`} className="cand-skill-match">
              <UIIcon name="check-circle" className="cand-chip-icon" /> {cleanSkillDisplayName(skill)}
            </span>
          )) : <span className="cand-covered-empty">Matched skills not detected yet.</span>}
        </div>
      </div>

      <div className="cand-job-section">
        <div className="cand-job-section-label">Skills to Improve</div>
        <div className="cand-skill-row">
          {job.missingSkills.length > 0 ? job.missingSkills.slice(0, 6).map((skill) => (
            <span key={`${job.id}-missing-${skill}`} className="cand-skill-miss">
              {cleanSkillDisplayName(skill)}
            </span>
          )) : <span className="cand-covered-empty">No major missing skills detected for this role.</span>}
        </div>
      </div>

      <div className="cand-explain">
        <UIIcon name="lightbulb" className="cand-inline-info-icon" />
        <strong>Recommended Next Step:</strong> {getRecommendedNextStep(job)}
      </div>

      {/* Ratings train the Fit-Now/Aspiration order; closest matches are in neither list. */}
      {job.hasMatchScore && !job.closestMatch && (
        <MatchFeedbackControls
          jobTitle={job.title}
          vote={matchFeedback[matchFeedbackKey(job.id, job.jobSource)] ?? null}
          status={matchFeedbackStatus[matchFeedbackKey(job.id, job.jobSource)] ?? { state: 'idle' }}
          onVote={(vote) => onRateMatch(job, vote)}
        />
      )}

      <div className="cand-actions">
        {job.sourceType === 'internal' ? (
          <>
            <button className="cand-btn-primary" type="button" onClick={() => onApply(job)} disabled={Boolean(activeApplication)}>
              <UIIcon name="paper-plane" className="cand-btn-icon" />{activeApplication ? 'Applied ✓' : 'Apply'}
            </button>
            <button className="cand-btn-secondary" type="button" onClick={() => onView(job)}>
              <UIIcon name="eye" className="cand-btn-icon" />View Details
            </button>
            <button className="cand-btn-secondary" type="button" onClick={() => onSave(job.id)}>
              <UIIcon name="bookmark" className="cand-btn-icon" />{savedJobs.has(job.id) ? 'Saved' : 'Save'}
            </button>
          </>
        ) : (
          <>
            <button className="cand-btn-secondary" type="button" onClick={() => onVisitSite(job)}>
              <UIIcon name="external" className="cand-btn-icon" />Visit Job Site
            </button>
            <button className="cand-btn-secondary" type="button" onClick={() => onSave(job.id)}>
              <UIIcon name="bookmark" className="cand-btn-icon" />{savedJobs.has(job.id) ? 'Saved' : 'Save'}
            </button>
          </>
        )}
      </div>
    </div>
    );
  };

  return (
    <div className={jobFilter !== 'saved' && jobs.length > 0 ? 'cand-job-matches-page' : undefined}>
      <div className="cand-sticky-controls">
        <div className="cand-page-header cand-page-header-inline">
          <h1 className="cand-page-title">Job Matches</h1>
          <p className="cand-page-subtitle">Jobs recommended based on your resume, confirmed skills, and career preferences</p>
          <p className="cand-feedback-note">Match percentages show how well your skills and experience line up with a role, not your chance of being hired. Rating matches helps Kareerly improve the order of future recommendations once enough candidates have rated them.</p>
        </div>

        <div className="cand-search-row">
          <div className="cand-search-box">
            <UIIcon name="search" className="cand-search-icon" />
            <input value={jobSearch} onChange={(event) => onSearch(event.target.value)} placeholder="Search by job title, company, or skill..." />
          </div>
        </div>

        <div className="cand-tab-row">
          <FilterTab active={jobFilter === 'top'} onClick={() => onFilter('top')}>Top Matches ({topMatchesCount})</FilterTab>
          <FilterTab active={jobFilter === 'fit-now'} onClick={() => onFilter('fit-now')}><UIIcon name="check-circle" className="cand-tab-icon green" />Fit-Now ({fitNowCount})</FilterTab>
          <FilterTab active={jobFilter === 'aspiration'} onClick={() => onFilter('aspiration')}><UIIcon name="rocket" className="cand-tab-icon mauve" />Aspiration ({aspirationCount})</FilterTab>
          <FilterTab active={jobFilter === 'all'} onClick={() => onFilter('all')}>Show All Matches ({allMatchesCount})</FilterTab>
          <FilterTab active={jobFilter === 'saved'} onClick={() => onFilter('saved')}><UIIcon name="bookmark" className="cand-tab-icon" />Saved Jobs ({savedJobs.size})</FilterTab>
        </div>
      </div>

      {jobFilter !== 'saved' && (
        <RegionFilterNotice
          filter={locationFilter}
          hasMatches={reportHasMatches}
          onChangeRegion={onChangeRegion}
          onRemoveFilter={onRemoveRegionFilter}
          isBusy={isBusy}
        />
      )}

      {jobFilter === 'saved' ? (
        savedTableRows.length > 0 ? (
          <div className="cand-table-wrap">
            <table className="cand-table">
              <thead>
                <tr>
                  <th>Job &amp; Company</th>
                  <th>Category</th>
                  <th>Location &amp; Setup</th>
                  <th>Match Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {savedTableRows.map((job) => {
                  const activeApplication = applications.find((app) => app.jobId === job.id && app.jobSource === job.jobSource && app.status !== 'Withdrawn');
                  return (
                    <tr key={`saved-${job.jobSource}-${job.id}`}>
                      <td>
                        <div className="text-sm font-bold text-dark">{job.title}</div>
                        <div className="text-xs text-soft-text">{job.company}</div>
                      </td>
                      <td>
                        <div className="text-xs font-bold text-mid">{job.category || 'Uncategorized'}</div>
                        <div className="text-xs text-soft-text">{job.subCategory || job.jobLevel || ''}</div>
                      </td>
                      <td>
                        <div className="text-xs text-mid">{job.location}</div>
                        <div className="text-xs text-soft-text">{job.setup}</div>
                      </td>
                      <td>
                        {job.hasMatchScore
                          ? <span className="font-display text-sm font-extrabold text-rust">{job.matchScore}% · {job.hasMatchScore ? matchCategoryBadge(job) : 'Match not available'}</span>
                          : <span className="cand-status-badge">Not matched</span>}
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-2">
                          <button className="cand-btn-secondary cand-btn-sm" type="button" onClick={() => onView(job)}><UIIcon name="eye" className="cand-btn-icon" />View</button>
                          {job.sourceType === 'external' ? (
                            <button className="cand-btn-secondary cand-btn-sm" type="button" onClick={() => onVisitSite(job)}><UIIcon name="external" className="cand-btn-icon" />Visit Site</button>
                          ) : (
                            <button className="cand-btn-primary cand-btn-sm" type="button" disabled={Boolean(activeApplication)} onClick={() => onApply(job)}><UIIcon name="paper-plane" className="cand-btn-icon" />{activeApplication ? 'Applied' : 'Apply'}</button>
                          )}
                          <button className="cand-btn-secondary cand-btn-sm" type="button" onClick={() => onSave(job.id)}><UIIcon name="trash" className="cand-btn-icon" />Remove</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <div className="cand-empty">No saved jobs match your search. Save any role from Careers or Job Matches to see it here.</div>
      ) : jobs.length > 0 ? (
        <div ref={matchGroupsRef} className={`cand-match-groups ${groupedSections.length === 1 ? 'single' : 'dual'}`}>
          {groupedSections.map((section) => (
            <div key={section.key} className="cand-card cand-match-group-card">
              <div className="cand-match-group-head">
                <h2 className="cand-card-title mb-0">
                  <UIIcon name={section.icon} className="cand-title-icon" />
                  {section.title}
                </h2>
                <span className={`cand-match-group-count ${section.key === 'fit-now' ? 'fit' : 'aspiration'}`}>
                  {section.items.length}
                </span>
              </div>
              <div className="cand-match-group-scroll">
                {section.items.length > 0 ? (
                  section.items.map((job) => renderJobCard(job))
                ) : (
                  <div className="cand-empty">No {section.key === 'fit-now' ? 'fit-now' : 'aspiration'} matches found for your current filters/search.</div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="cand-empty">No matches found for your current filters/search.</div>
      )}
    </div>
  );
}

export function FilterTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button className={`cand-tab-btn ${active ? 'active' : ''}`} type="button" onClick={onClick}>
      {children}
    </button>
  );
}

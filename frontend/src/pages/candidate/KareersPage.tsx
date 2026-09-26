import { useEffect, useMemo, useState } from 'react';
import { formatJobDescription } from '../../lib/jobDescription';
import { buildJobExplanation, cleanSkillDisplayName, displayOrDash, formatDateLabel, getMatchBadgeLabel, hasDisplayValue, matchCategoryBadge, splitSkillList, type ApplicationStatus, type DashboardApplication, type DashboardJob } from './model';
import { UIIcon } from './icons';
import { ActiveFilterChip, FilterPanel } from './common';
import { ApplicationSubmittedModal, ConfirmModal } from './modals';

export function KareersPage({
  kareers,
  selectedId,
  selected,
  applications,
  onSelect,
  onApply,
  onWithdraw,
  onGetApplicationStatus,
  onSave,
  onOpenMatches,
  onOpenApplications,
  onOpenUpskilling,
  isLoading,
  error,
  onRetry,
}: {
  kareers: DashboardJob[];
  selectedId: string;
  selected: DashboardJob | null;
  applications: DashboardApplication[];
  onSelect: (id: string) => void;
  onApply: (jobId: string) => Promise<boolean>;
  onWithdraw: (application: DashboardApplication) => void;
  onGetApplicationStatus: (jobId: string, jobSource: 'internal' | 'employer') => ApplicationStatus | null;
  onSave: (jobId: string) => void;
  onOpenMatches: () => void;
  onOpenApplications: () => void;
  onOpenUpskilling: () => void;
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const [searchValue, setSearchValue] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [levelFilter, setLevelFilter] = useState('');
  const [setupFilter, setSetupFilter] = useState('');
  const [employmentFilter, setEmploymentFilter] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest' | 'salary-high' | 'salary-low' | 'az' | 'za'>('newest');
  const [alignFilter, setAlignFilter] = useState('');
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pendingApplyJob, setPendingApplyJob] = useState<DashboardJob | null>(null);
  const [submittedApplyJob, setSubmittedApplyJob] = useState<DashboardJob | null>(null);

  const filteredKareers = useMemo(() => {
    const query = searchValue.trim().toLowerCase();
    const filtered = kareers.filter((job) => {
      if (categoryFilter && !(job.category || '').toLowerCase().includes(categoryFilter.toLowerCase())) return false;
      if (levelFilter && !(job.jobLevel || '').toLowerCase().includes(levelFilter.toLowerCase())) return false;
      if (setupFilter && !(job.setup || '').toLowerCase().includes(setupFilter.toLowerCase())) return false;
      if (employmentFilter && !(job.employmentType || '').toLowerCase().includes(employmentFilter.toLowerCase())) return false;
      if (locationFilter && !(job.location || '').toLowerCase().includes(locationFilter.toLowerCase())) return false;
      if (alignFilter && job.matchCategory !== alignFilter) return false;
      if (!query) return true;
      return `${job.title} ${job.company} ${job.category || ''} ${job.subCategory || ''} ${job.location} ${job.setup} ${job.description || ''} ${job.requiredSkills.join(' ')} ${job.preferredSkills.join(' ')}`
        .toLowerCase()
        .includes(query);
    });
    return filtered.sort((left, right) => {
      if (sortOrder === 'az' || sortOrder === 'za') return (sortOrder === 'az' ? 1 : -1) * left.title.localeCompare(right.title);
      if (sortOrder === 'salary-high' || sortOrder === 'salary-low') return (sortOrder === 'salary-high' ? -1 : 1) * ((left.salaryMax || left.salaryMin || 0) - (right.salaryMax || right.salaryMin || 0));
      const leftDate = new Date(left.createdAt || 0).getTime();
      const rightDate = new Date(right.createdAt || 0).getTime();
      return sortOrder === 'oldest' ? leftDate - rightDate : rightDate - leftDate;
    });
  }, [alignFilter, categoryFilter, employmentFilter, kareers, levelFilter, locationFilter, searchValue, setupFilter, sortOrder]);

  const categories = useMemo(() => Array.from(new Set(kareers.map((job) => job.category).filter(Boolean) as string[])).sort(), [kareers]);
  const locations = useMemo(() => Array.from(new Set(kareers.map((job) => job.location).filter(Boolean))).sort(), [kareers]);
  const pageCount = Math.max(1, Math.ceil(filteredKareers.length / 20));
  const pagedKareers = filteredKareers.slice((page - 1) * 20, page * 20);
  const activeCareerFilters = [
    categoryFilter ? { label: categoryFilter, onRemove: () => setCategoryFilter('') } : null,
    employmentFilter ? { label: `Employment: ${employmentFilter}`, onRemove: () => setEmploymentFilter('') } : null,
    levelFilter ? { label: `Experience: ${levelFilter}`, onRemove: () => setLevelFilter('') } : null,
    setupFilter ? { label: `Work setup: ${setupFilter}`, onRemove: () => setSetupFilter('') } : null,
    locationFilter ? { label: `Location: ${locationFilter}`, onRemove: () => setLocationFilter('') } : null,
    alignFilter ? { label: `Alignment: ${alignFilter === 'fit-now' ? 'Fit-Now' : 'Aspiration'}`, onRemove: () => setAlignFilter('') } : null,
  ].filter((filter): filter is { label: string; onRemove: () => void } => Boolean(filter));
  const clearCareerFilters = () => {
    setCategoryFilter('');
    setEmploymentFilter('');
    setLevelFilter('');
    setSetupFilter('');
    setLocationFilter('');
    setAlignFilter('');
    setFilterPanelOpen(false);
  };

  useEffect(() => { setPage(1); }, [alignFilter, categoryFilter, employmentFilter, levelFilter, locationFilter, searchValue, setupFilter, sortOrder]);

  useEffect(() => {
    if (filteredKareers.length === 0) return;
    if (!filteredKareers.some((job) => job.id === selectedId)) {
      onSelect(filteredKareers[0].id);
    }
  }, [filteredKareers, onSelect, selectedId]);

  const activeSelected = filteredKareers.find((job) => job.id === selectedId) || selected || filteredKareers[0] || null;
  const activeApplication = activeSelected ? applications.find((app) => app.jobId === activeSelected.id && app.jobSource === activeSelected.jobSource && app.status !== 'Withdrawn') || null : null;
  const activeApplicationStatus = activeSelected ? onGetApplicationStatus(activeSelected.id, activeSelected.jobSource) : null;
  const isApplied = Boolean(activeApplicationStatus);
  const kareerSubline = activeSelected ? [activeSelected.company, activeSelected.location].filter(hasDisplayValue).join(' · ') : '';
  const kareerFacts = activeSelected
    ? [
        activeSelected.setup,
        activeSelected.employmentType,
        activeSelected.jobLevel ? `${displayOrDash(activeSelected.jobLevel)} level` : '',
        activeSelected.salary,
        activeSelected.category,
        activeSelected.createdAt ? `Posted ${formatDateLabel(activeSelected.createdAt)}` : '',
      ].filter(hasDisplayValue).map((value) => (value || '').trim())
    : [];
  const kareerMatchedSkills = activeSelected ? splitSkillList(activeSelected.matchedSkills) : [];
  const kareerMissingSkills = activeSelected ? splitSkillList(activeSelected.missingSkills) : [];
  const kareerRequiredSkills = activeSelected ? splitSkillList(activeSelected.requiredSkills) : [];
  const kareerNiceSkills = activeSelected ? splitSkillList([...activeSelected.preferredSkills, ...(activeSelected.niceToHaveSkills || [])]) : [];
  const kareerHasSkillMatch = Boolean(activeSelected?.hasMatchScore) && (kareerMatchedSkills.length > 0 || kareerMissingSkills.length > 0);

  return (
    <div>
      <div className="cand-sticky-controls">
        <div className="cand-page-header cand-page-header-inline">
          <h1 className="cand-page-title">Kareers</h1>
          <p className="cand-page-subtitle">Explore career paths and job opportunities by source, category, and alignment</p>
        </div>
      </div>

      <div className="cand-toolbar cand-kareers-toolbar">
        <div className="cand-search-box cand-kareers-search">
          <UIIcon name="search" className="cand-search-icon" />
          <input value={searchValue} onChange={(event) => setSearchValue(event.target.value)} placeholder="Search by role, skill, category, or location..." />
        </div>
        <div className="cand-filter-control">
          <button
            className={`cand-filter-button ${activeCareerFilters.length > 0 ? 'active' : ''}`}
            type="button"
            aria-expanded={filterPanelOpen}
            aria-controls="career-filter-panel"
            onClick={() => setFilterPanelOpen((current) => !current)}
          >
            <UIIcon name="filter" className="cand-btn-icon" />
            Filters{activeCareerFilters.length > 0 ? ` (${activeCareerFilters.length})` : ''}
          </button>
          <FilterPanel
            open={filterPanelOpen}
            panelId="career-filter-panel"
            title="Career filters"
            labelledBy="career-filter-panel-title"
            onClose={() => setFilterPanelOpen(false)}
            onApply={() => setFilterPanelOpen(false)}
            onClear={clearCareerFilters}
          >
            <div className="cand-filter-section">
              <div className="cand-filter-section-title">Job details</div>
              <div className="cand-filter-grid">
                <div className="cand-filter-field">
                  <label htmlFor="career-category-filter">Category</label>
                  <select id="career-category-filter" className="cand-form-select" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
                    <option value="">All categories</option>
                    {categories.map((category) => <option key={category} value={category}>{category}</option>)}
                  </select>
                </div>
                <div className="cand-filter-field">
                  <label htmlFor="career-employment-filter">Employment type</label>
                  <select id="career-employment-filter" className="cand-form-select" value={employmentFilter} onChange={(event) => setEmploymentFilter(event.target.value)}>
                    <option value="">All employment types</option>
                    {['Full Time', 'Part Time', 'Contract', 'Internship', 'Freelance'].map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                </div>
                <div className="cand-filter-field">
                  <label htmlFor="career-level-filter">Experience level</label>
                  <select id="career-level-filter" className="cand-form-select" value={levelFilter} onChange={(event) => setLevelFilter(event.target.value)}>
                    <option value="">All levels</option>
                    <option value="Entry">Entry level</option>
                    <option value="Junior">Junior</option>
                    <option value="Mid">Mid-level</option>
                    <option value="Senior">Senior</option>
                    <option value="Trainee">Trainee</option>
                  </select>
                </div>
                <div className="cand-filter-field">
                  <label htmlFor="career-setup-filter">Work setup</label>
                  <select id="career-setup-filter" className="cand-form-select" value={setupFilter} onChange={(event) => setSetupFilter(event.target.value)}>
                    <option value="">All work setups</option>
                    <option value="Remote">Remote</option>
                    <option value="Hybrid">Hybrid</option>
                    <option value="Onsite">Onsite</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="cand-filter-section">
              <div className="cand-filter-section-title">Location</div>
              <div className="cand-filter-field">
                <label htmlFor="career-location-filter">Location</label>
                <select id="career-location-filter" className="cand-form-select" value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)}>
                  <option value="">All locations</option>
                  {locations.map((location) => <option key={location} value={location}>{location}</option>)}
                </select>
              </div>
            </div>
            <div className="cand-filter-section">
              <div className="cand-filter-section-title">Match</div>
              <div className="cand-filter-field">
                <label htmlFor="career-alignment-filter">Alignment</label>
                <select id="career-alignment-filter" className="cand-form-select" value={alignFilter} onChange={(event) => setAlignFilter(event.target.value)}>
                  <option value="">All alignments</option>
                  <option value="fit-now">Fit-Now</option>
                  <option value="aspiration">Aspiration</option>
                </select>
              </div>
            </div>
          </FilterPanel>
        </div>
        <label className="cand-sort-control">
          <span className="sr-only">Sort jobs</span>
          <select className="cand-toolbar-select" value={sortOrder} onChange={(event) => setSortOrder(event.target.value as typeof sortOrder)}>
          <option value="newest">Newest</option><option value="oldest">Oldest</option><option value="salary-high">Salary High–Low</option><option value="salary-low">Salary Low–High</option><option value="az">A–Z</option><option value="za">Z–A</option>
          </select>
        </label>
      </div>
      {activeCareerFilters.length > 0 && (
        <div className="cand-active-filter-chips" aria-label="Active career filters">
          {activeCareerFilters.map((filter) => <ActiveFilterChip key={filter.label} label={filter.label} onRemove={filter.onRemove} />)}
          <button className="cand-filter-reset-link" type="button" onClick={clearCareerFilters}>Clear all</button>
        </div>
      )}

      <div className="cand-two-panel">
        <div className="cand-two-panel-left">
          <div className="cand-two-panel-left-hd">Career Paths and Roles</div>
          <div className="cand-kareer-list-scroll">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, index) => <div key={index} className="m-3 h-28 animate-pulse rounded-xl bg-bg" />)
            ) : error ? (
              <div className="p-4 text-sm text-red">Unable to load jobs.<button className="ml-2 font-bold underline" type="button" onClick={onRetry}>Retry</button></div>
            ) : pagedKareers.length > 0 ? (
              pagedKareers.map((job) => (
                <div key={job.id} className={`cand-kareer-item ${selectedId === job.id ? 'active' : ''}`}>
                  <button className="cand-kareer-select" type="button" onClick={() => onSelect(job.id)}>
                    <div className="text-sm font-bold text-dark"><UIIcon name="briefcase" className="cand-chip-icon" />{job.title}</div>
                    <div className="text-xs text-soft-text">{job.company} · {displayOrDash(job.category)}</div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {job.matchedSkills.slice(0, 3).map((skill) => (
                        <span key={`${job.id}-${skill}`} className="rounded-full bg-cream-d px-2 py-0.5 text-[10px] font-semibold text-mid">
                          {cleanSkillDisplayName(skill)}
                        </span>
                      ))}
                    </div>
                    <div className="cand-kareer-item-badges">
                      <span className="cand-kareer-mini-badge">{displayOrDash(job.setup)}</span>
                      <span className="cand-kareer-mini-badge">{displayOrDash(job.jobLevel)}</span>
                      <span className={`cand-kareer-mini-badge ${job.matchCategory === 'fit-now' ? 'fit' : 'asp'}`}>{job.hasMatchScore ? matchCategoryBadge(job, 'Fit-Now') : 'Match not available'}</span>
                    </div>
                    <div className="cand-kareer-view-link">View Details</div>
                  </button>
                  <div className="cand-kareer-card-actions">
                    {job.sourceType === 'internal' ? (
                      <button
                        className={`cand-btn-secondary cand-btn-sm ${onGetApplicationStatus(job.id, job.jobSource) ? 'opacity-70' : ''}`}
                        type="button"
                        disabled={Boolean(onGetApplicationStatus(job.id, job.jobSource))}
                        onClick={() => {
                          onSelect(job.id);
                          if (!onGetApplicationStatus(job.id, job.jobSource)) setPendingApplyJob(job);
                        }}
                      >
                        {onGetApplicationStatus(job.id, job.jobSource) ? 'Applied ✓' : 'Apply'}
                      </button>
                    ) : (
                      <button className="cand-btn-secondary cand-btn-sm" type="button" onClick={() => onSelect(job.id)}>
                        View External Job
                      </button>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <div className="p-4 text-sm text-soft-text">{kareers.length === 0 ? 'No jobs are available right now.' : 'No jobs matched your current filters.'}</div>
            )}
          </div>
          {!isLoading && !error && pageCount > 1 && <div className="flex items-center justify-center gap-3 border-t border-bdr p-3 text-sm"><button type="button" disabled={page === 1} onClick={() => setPage((value) => value - 1)}>Previous</button><span>Page {page} of {pageCount}</span><button type="button" disabled={page === pageCount} onClick={() => setPage((value) => value + 1)}>Next</button></div>}
        </div>
        <div className="cand-two-panel-right">
          {activeSelected ? (
            <>
              <div className="cand-kd-head">
                <h2 className="cand-kd-title">{activeSelected.title}</h2>
                {kareerSubline && <div className="cand-kd-sub">{kareerSubline}</div>}
                {kareerFacts.length > 0 && (
                  <div className="cand-kd-facts">
                    {kareerFacts.map((fact) => (
                      <span key={`${activeSelected.id}-fact-${fact}`} className="cand-kd-fact">{fact}</span>
                    ))}
                  </div>
                )}
              </div>

              {activeSelected.hasMatchScore ? (
                <div className={`cand-kd-match ${activeSelected.matchScore >= 60 ? 'good' : 'grow'}`}>
                  <div className="cand-kd-match-score">{getMatchBadgeLabel(activeSelected)}</div>
                  <p className="cand-kd-match-text">{buildJobExplanation(activeSelected)}</p>
                </div>
              ) : (
                <div className="cand-kd-note">
                  <span>Your match for this role hasn't been calculated yet. You're still welcome to apply.</span>
                  <button className="cand-kd-link" type="button" onClick={onOpenMatches}>See my matches</button>
                </div>
              )}

              <div className="cand-kareer-primary-actions">
                {activeSelected.sourceType === 'internal' ? (
                  isApplied ? (
                    <>
                      <button className="cand-btn-primary" type="button" disabled>
                        Applied ✓
                      </button>
                      <button className="cand-btn-secondary" type="button" onClick={onOpenApplications}>
                        View Application
                      </button>
                      {activeApplication && ['Pending', 'Shortlisted', 'Interviewing'].includes(activeApplication.status) && (
                        <button className="cand-btn-secondary" type="button" onClick={() => onWithdraw(activeApplication)}>
                          Withdraw
                        </button>
                      )}
                    </>
                  ) : (
                    <>
                      <button className="cand-btn-primary" type="button" onClick={() => setPendingApplyJob(activeSelected)}>
                        Apply Now
                      </button>
                      <button className="cand-btn-secondary" type="button" onClick={() => onSave(activeSelected.id)}>
                        <UIIcon name="bookmark" className="cand-btn-icon" />Save Job
                      </button>
                    </>
                  )
                ) : (
                  <button
                    className="cand-btn-primary"
                    type="button"
                    onClick={() => {
                      const fallbackQuery = encodeURIComponent(`${activeSelected.title} ${activeSelected.company} jobs`);
                      window.open(activeSelected.externalUrl || `https://www.google.com/search?q=${fallbackQuery}`, '_blank', 'noopener,noreferrer');
                    }}
                  >
                    <UIIcon name="external" className="cand-btn-icon" />Apply on Employer Site
                  </button>
                )}
              </div>

              <section className="cand-kd-section">
                <h3 className="cand-kd-heading">About the role</h3>
                {activeSelected.description ? (
                  <div className="cand-kd-body whitespace-pre-wrap">{formatJobDescription(activeSelected.description)}</div>
                ) : activeSelected.responsibilities.length === 0 ? (
                  <div className="cand-kd-body cand-kd-muted">The employer hasn't shared a full description yet.</div>
                ) : null}
                {activeSelected.responsibilities.length > 0 && (
                  <>
                    <h4 className="cand-kd-subheading">What you'll do</h4>
                    <ul className="cand-kareer-detail-list cand-kd-body">
                      {activeSelected.responsibilities.map((item) => (
                        <li key={`${activeSelected.id}-resp-${item}`}>{item}</li>
                      ))}
                    </ul>
                  </>
                )}
              </section>

              {(kareerHasSkillMatch || kareerRequiredSkills.length > 0 || kareerNiceSkills.length > 0) && (
                <section className="cand-kd-section">
                  <h3 className="cand-kd-heading">Skills</h3>
                  {kareerHasSkillMatch ? (
                    <>
                      {kareerMatchedSkills.length > 0 && (
                        <>
                          <h4 className="cand-kd-subheading">You already have</h4>
                          <div className="cand-skill-row">
                            {kareerMatchedSkills.map((skill) => (
                              <span key={`${activeSelected.id}-m-${skill}`} className="cand-skill-match"><UIIcon name="check-circle" className="cand-chip-icon" />{skill}</span>
                            ))}
                          </div>
                        </>
                      )}
                      {kareerMissingSkills.length > 0 && (
                        <>
                          <h4 className="cand-kd-subheading">Skills to build</h4>
                          <div className="cand-skill-row">
                            {kareerMissingSkills.map((skill) => (
                              <span key={`${activeSelected.id}-g-${skill}`} className="cand-skill-miss">{skill}</span>
                            ))}
                          </div>
                        </>
                      )}
                    </>
                  ) : kareerRequiredSkills.length > 0 && (
                    <>
                      <h4 className="cand-kd-subheading">Required</h4>
                      <div className="cand-skill-row">
                        {kareerRequiredSkills.map((skill) => (
                          <span key={`${activeSelected.id}-req-${skill}`} className="cand-skill-match">{skill}</span>
                        ))}
                      </div>
                    </>
                  )}
                  {kareerNiceSkills.length > 0 && (
                    <>
                      <h4 className="cand-kd-subheading">Nice to have</h4>
                      <div className="cand-skill-row">
                        {kareerNiceSkills.map((skill) => (
                          <span key={`${activeSelected.id}-nice-${skill}`} className="cand-skill-nice">{skill}</span>
                        ))}
                      </div>
                    </>
                  )}
                </section>
              )}

              {kareerMissingSkills.length > 0 && (
                <div className="cand-kd-next">
                  <div>
                    <div className="cand-kd-next-title">Next step</div>
                    <div className="cand-kd-next-text">Start with {kareerMissingSkills[0]} — it's one of the clearest ways to strengthen your fit.</div>
                  </div>
                  <button className="cand-btn-secondary cand-btn-sm" type="button" onClick={onOpenUpskilling}>
                    <UIIcon name="graduation" className="cand-btn-icon" />Find Learning
                  </button>
                </div>
              )}

              <div className="cand-kareer-footer-note">
                Match scores are guidance only and never stop you from applying. The employer makes the final hiring decision.
              </div>
            </>
          ) : (
            <div className="cand-empty">Select a role from the left panel to view details.</div>
          )}
        </div>
      </div>

      {pendingApplyJob && (
        <ConfirmModal
          title="Apply for this position?"
          description="You are about to apply for this Internal Kareerly job. Your current fit analysis will NOT affect your ability to submit this application. The employer will make the final hiring decision."
          onCancel={() => setPendingApplyJob(null)}
          onConfirm={async () => {
            const applied = await onApply(pendingApplyJob.id);
            if (applied) setSubmittedApplyJob(pendingApplyJob);
            setPendingApplyJob(null);
          }}
          confirmLabel="Submit Application"
        />
      )}

      {submittedApplyJob && (
        <ApplicationSubmittedModal
          onClose={() => setSubmittedApplyJob(null)}
          onOpenApplications={() => {
            setSubmittedApplyJob(null);
            onOpenApplications();
          }}
          onContinue={() => setSubmittedApplyJob(null)}
        />
      )}
    </div>
  );
}

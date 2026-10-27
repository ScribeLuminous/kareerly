import { useMemo, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowsRotate, faBookmark, faBriefcase, faMagnifyingGlassChart, faXmark } from '@fortawesome/free-solid-svg-icons';
import { MatchScoreNotice } from '../../components/MatchScoreNotice';
import RegionFilterNotice from '../../components/RegionFilterNotice';
import { EmptyState, FilterChoice, FilterPanel, SearchField, Segmented, SkeletonRows } from '../../components/ui';
import type { JobMatchRunResults } from '../../types';
import { JobCard } from './JobCard';
import { PageHeader } from './common';
import { knownValue, TOP_MATCHES_PER_CATEGORY, type ApplicationStatus, type DashboardJob, type MatchView } from './model';

type SortOrder = 'recommended' | 'score' | 'title';

type MatchesPageProps = {
  /** Full Fit-Now and Aspiration lists, already in the backend's order. */
  fitNowJobs: DashboardJob[];
  aspirationJobs: DashboardJob[];
  savedJobRows: DashboardJob[];
  view: MatchView;
  onView: (view: MatchView) => void;
  search: string;
  onSearch: (value: string) => void;
  savedJobs: Set<string>;
  getApplicationStatus: (job: DashboardJob) => ApplicationStatus | null;
  onSave: (jobId: string) => void;
  onApply: (job: DashboardJob) => void;
  onOpenJob: (job: DashboardJob) => void;
  /** Desktop split view: the job shown beside the list, and its panel. */
  onAnalyze: () => void;
  isLoading: boolean;
  hasResume: boolean;
  onUploadResume: () => void;
  locationFilter: JobMatchRunResults['location_filter'];
  reportHasMatches: boolean;
  isBusy: boolean;
  onChangeRegion: () => void;
  onRemoveRegionFilter: () => void;
  /** Runs matching again on the latest jobs, skills and preferences. */
  onRefresh: () => void;
};

const setupKey = (value: string) => {
  const text = value.toLowerCase();
  if (text.includes('remote') || text.includes('home')) return 'Remote';
  if (text.includes('hybrid')) return 'Hybrid';
  if (text.includes('site') || text.includes('office')) return 'On-site';
  return '';
};

export function JobMatchesPage({
  fitNowJobs,
  aspirationJobs,
  savedJobRows,
  view,
  onView,
  search,
  onSearch,
  savedJobs,
  getApplicationStatus,
  onSave,
  onApply,
  onOpenJob,
  onAnalyze,
  isLoading,
  hasResume,
  onUploadResume,
  locationFilter,
  reportHasMatches,
  isBusy,
  onChangeRegion,
  onRemoveRegionFilter,
  onRefresh,
}: MatchesPageProps) {
  // "Show all" applies to the list it was pressed on.
  const [showAllFor, setShowAllFor] = useState<MatchView | null>(null);
  const showAll = showAllFor === view;
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [source, setSource] = useState<'' | 'internal' | 'external'>('');
  const [setup, setSetup] = useState('');
  const [level, setLevel] = useState('');
  const [sort, setSort] = useState<SortOrder>('recommended');

  const pool = view === 'fit-now' ? fitNowJobs : view === 'aspiration' ? aspirationJobs : savedJobRows;
  const levels = useMemo(() => Array.from(new Set(pool.map((job) => knownValue(job.jobLevel)).filter(Boolean))).sort(), [pool]);
  const setups = useMemo(() => Array.from(new Set(pool.map((job) => setupKey(job.setup)).filter(Boolean))).sort(), [pool]);
  const hasExternal = pool.some((job) => job.sourceType === 'external');
  const activeFilters = [
    source ? { label: source === 'internal' ? 'Kareerly jobs' : 'External sites', clear: () => setSource('') } : null,
    setup ? { label: setup, clear: () => setSetup('') } : null,
    level ? { label: level, clear: () => setLevel('') } : null,
  ].filter((item): item is { label: string; clear: () => void } => Boolean(item));
  const resetFilters = () => {
    setSource('');
    setSetup('');
    setLevel('');
  };

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const list = pool.filter((job) => {
      if (source && job.sourceType !== source) return false;
      if (setup && setupKey(job.setup) !== setup) return false;
      if (level && knownValue(job.jobLevel) !== level) return false;
      if (!query) return true;
      return [job.title, job.company, job.location, job.category || '', job.jobLevel || '', job.matchedSkills.join(' '), job.missingSkills.join(' ')]
        .join(' ')
        .toLowerCase()
        .includes(query);
    });
    if (sort === 'score') return [...list].sort((a, b) => b.matchScore - a.matchScore);
    if (sort === 'title') return [...list].sort((a, b) => a.title.localeCompare(b.title));
    return list;
  }, [level, pool, search, setup, sort, source]);

  const isFiltered = Boolean(search.trim()) || activeFilters.length > 0;
  const limit = view === 'saved' || showAll || isFiltered ? filtered.length : TOP_MATCHES_PER_CATEGORY;
  const visible = filtered.slice(0, limit);
  const hiddenCount = filtered.length - visible.length;

  const noMatchesYet = fitNowJobs.length === 0 && aspirationJobs.length === 0;

  return (
    <div className="k-page">
      <PageHeader
        title="Matches"
        actions={(
          <>
            {hasResume && (
              <button
                className="k-btn k-btn-secondary"
                type="button"
                onClick={onRefresh}
                disabled={isBusy}
                aria-busy={isBusy}
                title="Check for new jobs and update your matches with your latest resume, skills and preferences"
              >
                <FontAwesomeIcon icon={faArrowsRotate} className={isBusy ? 'fa-spin' : undefined} aria-hidden="true" />
                {isBusy ? 'Refreshing…' : 'Refresh matches'}
              </button>
            )}
            <button className="k-btn k-btn-secondary lg:hidden" type="button" onClick={onAnalyze}>
              <FontAwesomeIcon icon={faMagnifyingGlassChart} aria-hidden="true" />Analyze a job
            </button>
          </>
        )}
      />
      <MatchScoreNotice className="-mt-2 mb-3" />

      <Segmented<MatchView>
        label="Match list"
        value={view}
        onChange={onView}
        options={[
          { value: 'fit-now', label: 'Fit Now', count: fitNowJobs.length },
          { value: 'aspiration', label: 'Aspiration', count: aspirationJobs.length },
          { value: 'saved', label: <><FontAwesomeIcon icon={faBookmark} className="h-3 w-3" aria-hidden="true" />Saved</>, count: savedJobRows.length },
        ]}
      />

      <div className="k-toolbar mt-3">
        <SearchField value={search} onChange={onSearch} label="Search matches" placeholder="Search title or skill" />
        <div className="k-toolbar-controls">
          <FilterPanel open={filtersOpen} onOpenChange={setFiltersOpen} activeCount={activeFilters.length} onClear={resetFilters}>
            {setups.length > 1 && (
              <FilterChoice legend="Work setup" name="match-setup" value={setup} onChange={setSetup} options={[{ value: '', label: 'Any' }, ...setups.map((value) => ({ value, label: value }))]} />
            )}
            {levels.length > 1 && (
              <FilterChoice legend="Level" name="match-level" value={level} onChange={setLevel} options={[{ value: '', label: 'Any' }, ...levels.map((value) => ({ value, label: value }))]} />
            )}
            {hasExternal && (
              <FilterChoice<'' | 'internal' | 'external'>
                legend="Where to apply"
                name="match-source"
                value={source}
                onChange={setSource}
                options={[{ value: '', label: 'Anywhere' }, { value: 'internal', label: 'On Kareerly' }, { value: 'external', label: 'External sites' }]}
              />
            )}
            {setups.length <= 1 && levels.length <= 1 && !hasExternal && <p className="k-secondary">These matches don't differ by setup, level or source.</p>}
          </FilterPanel>
          <label className="k-sort">
            <span className="sr-only">Sort matches</span>
            <select className="k-select" value={sort} onChange={(event) => setSort(event.target.value as SortOrder)}>
              <option value="recommended">Best match</option>
              <option value="score">Highest match</option>
              <option value="title">Title A–Z</option>
            </select>
          </label>
        </div>
      </div>

      {activeFilters.length > 0 && (
        <div className="k-filter-summary" aria-label="Active filters">
          {activeFilters.map((filter) => (
            <button key={filter.label} className="k-chip k-chip-removable" type="button" onClick={filter.clear} aria-label={`Remove ${filter.label} filter`}>
              {filter.label}<FontAwesomeIcon icon={faXmark} aria-hidden="true" />
            </button>
          ))}
          <button className="k-link" type="button" onClick={resetFilters}>Reset</button>
        </div>
      )}

      {view !== 'saved' && (
        <RegionFilterNotice filter={locationFilter} hasMatches={reportHasMatches} onChangeRegion={onChangeRegion} onRemoveFilter={onRemoveRegionFilter} isBusy={isBusy} />
      )}

      {isLoading && noMatchesYet ? (
        <SkeletonRows count={4} label="Loading matches" />
      ) : visible.length === 0 ? (
        view === 'saved' && savedJobRows.length === 0 ? (
          <EmptyState icon={faBookmark} title="No saved jobs" text="Tap the bookmark on any job to keep it here." />
        ) : noMatchesYet && view !== 'saved' ? (
          <EmptyState
            icon={faBriefcase}
            title="No matches yet"
            text={hasResume ? 'Update your resume or preferences to refresh your matches.' : 'Upload your resume to see jobs that fit.'}
            actions={<button className="k-btn k-btn-primary" type="button" onClick={onUploadResume}>{hasResume ? 'Update resume' : 'Upload resume'}</button>}
          />
        ) : (
          <EmptyState
            title={isFiltered ? 'No matches for this search' : `No ${view === 'fit-now' ? 'Fit Now' : 'Aspiration'} matches`}
            text={isFiltered ? 'Try another term or reset the filters.' : undefined}
            actions={isFiltered ? <button className="k-btn k-btn-secondary" type="button" onClick={() => { onSearch(''); resetFilters(); }}>Reset</button> : undefined}
          />
        )
      ) : (
        <div>
          <div>
            <h2 className="sr-only">{view === 'fit-now' ? 'Fit Now matches' : view === 'aspiration' ? 'Aspiration matches' : 'Saved jobs'}</h2>
            <div className="k-job-grid">
              {visible.map((job) => (
                <JobCard
                  key={`${job.jobSource}-${job.id}`}
                  job={job}
                  applicationStatus={getApplicationStatus(job)}
                  isSaved={savedJobs.has(job.id)}
                  onOpen={() => onOpenJob(job)}
                  onApply={() => onApply(job)}
                  onSave={() => onSave(job.id)}
                />
              ))}
            </div>
            {hiddenCount > 0 && (
              <button className="k-btn k-btn-secondary k-btn-block mt-3" type="button" onClick={() => setShowAllFor(view)}>
                Show all {filtered.length} {view === 'fit-now' ? 'Fit Now' : 'Aspiration'} matches
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

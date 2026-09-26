import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCompass, faXmark } from '@fortawesome/free-solid-svg-icons';
import { Banner, EmptyState, FilterChoice, FilterPanel, SearchField, SkeletonRows } from '../../components/ui';
import { JobCard } from './JobCard';
import { PageHeader } from './common';
import type { ApplicationStatus, DashboardJob } from './model';

type SortOrder = 'newest' | 'oldest' | 'salary-high' | 'salary-low' | 'az' | 'za';
const PAGE_SIZE = 20;

type KareersPageProps = {
  kareers: DashboardJob[];
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  savedJobs: Set<string>;
  getApplicationStatus: (job: DashboardJob) => ApplicationStatus | null;
  onSave: (jobId: string) => void;
  onApply: (job: DashboardJob) => void;
  onOpenJob: (job: DashboardJob) => void;
  isDesktop: boolean;
  selectedJobId: string | null;
  renderDetail: (job: DashboardJob) => ReactNode;
};

export function KareersPage({ kareers, isLoading, error, onRetry, savedJobs, getApplicationStatus, onSave, onApply, onOpenJob, isDesktop, selectedJobId, renderDetail }: KareersPageProps) {
  const [searchValue, setSearchValue] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [levelFilter, setLevelFilter] = useState('');
  const [setupFilter, setSetupFilter] = useState('');
  const [employmentFilter, setEmploymentFilter] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [alignFilter, setAlignFilter] = useState('');
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest');
  const [filtersOpen, setFiltersOpen] = useState(false);

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

  const categories = useMemo(() => Array.from(new Set(kareers.map((job) => job.category).filter(Boolean) as string[])).filter((value) => !/not specified/i.test(value)).sort(), [kareers]);
  const locations = useMemo(() => Array.from(new Set(kareers.map((job) => job.location).filter(Boolean))).filter((value) => !/not specified/i.test(value)).sort(), [kareers]);
  const activeFilters = [
    categoryFilter ? { label: categoryFilter, clear: () => setCategoryFilter('') } : null,
    employmentFilter ? { label: employmentFilter, clear: () => setEmploymentFilter('') } : null,
    levelFilter ? { label: `${levelFilter} level`, clear: () => setLevelFilter('') } : null,
    setupFilter ? { label: setupFilter, clear: () => setSetupFilter('') } : null,
    locationFilter ? { label: locationFilter, clear: () => setLocationFilter('') } : null,
    alignFilter ? { label: alignFilter === 'fit-now' ? 'Fit Now' : 'Aspiration', clear: () => setAlignFilter('') } : null,
  ].filter((filter): filter is { label: string; clear: () => void } => Boolean(filter));
  const clearFilters = () => {
    setCategoryFilter('');
    setEmploymentFilter('');
    setLevelFilter('');
    setSetupFilter('');
    setLocationFilter('');
    setAlignFilter('');
  };

  // Paging restarts whenever the search, filters or sort change.
  const listKey = JSON.stringify([alignFilter, categoryFilter, employmentFilter, levelFilter, locationFilter, searchValue, setupFilter, sortOrder]);
  const [paging, setPaging] = useState({ key: listKey, count: PAGE_SIZE });
  const visibleCount = paging.key === listKey ? paging.count : PAGE_SIZE;

  const visible = filteredKareers.slice(0, visibleCount);
  const selected = visible.find((job) => job.id === selectedJobId) || null;
  const selectedIsVisible = Boolean(selected);
  useEffect(() => {
    if (isDesktop && !selectedIsVisible && visible.length > 0) onOpenJob(visible[0]);
  }, [isDesktop, selectedIsVisible, visible, onOpenJob]);

  return (
    <div className="k-page">
      <PageHeader title="Kareers" />
      <div className="k-toolbar">
        <SearchField value={searchValue} onChange={setSearchValue} label="Search jobs" placeholder="Search role, skill or location" />
        <div className="k-toolbar-controls">
          <FilterPanel open={filtersOpen} onOpenChange={setFiltersOpen} activeCount={activeFilters.length} onClear={clearFilters} title="Job filters">
            <FilterChoice legend="Work setup" name="kareer-setup" value={setupFilter} onChange={setSetupFilter}
              options={[{ value: '', label: 'Any' }, { value: 'Remote', label: 'Remote' }, { value: 'Hybrid', label: 'Hybrid' }, { value: 'Onsite', label: 'On-site' }]} />
            <FilterChoice legend="Experience" name="kareer-level" value={levelFilter} onChange={setLevelFilter}
              options={[{ value: '', label: 'Any' }, { value: 'Entry', label: 'Entry' }, { value: 'Junior', label: 'Junior' }, { value: 'Mid', label: 'Mid' }, { value: 'Senior', label: 'Senior' }, { value: 'Trainee', label: 'Trainee' }]} />
            <FilterChoice legend="Employment" name="kareer-employment" value={employmentFilter} onChange={setEmploymentFilter}
              options={[{ value: '', label: 'Any' }, ...['Full Time', 'Part Time', 'Contract', 'Internship', 'Freelance'].map((value) => ({ value, label: value }))]} />
            <FilterChoice legend="Your match" name="kareer-align" value={alignFilter} onChange={setAlignFilter}
              options={[{ value: '', label: 'Any' }, { value: 'fit-now', label: 'Fit Now' }, { value: 'aspiration', label: 'Aspiration' }]} />
            <div className="k-filter-group">
              <label className="k-field block">
                <span className="k-label">Category</span>
                <select className="k-select mt-1.5" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
                  <option value="">All categories</option>
                  {categories.map((category) => <option key={category} value={category}>{category}</option>)}
                </select>
              </label>
            </div>
            <div className="k-filter-group">
              <label className="k-field block">
                <span className="k-label">Location</span>
                <select className="k-select mt-1.5" value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)}>
                  <option value="">All locations</option>
                  {locations.map((location) => <option key={location} value={location}>{location}</option>)}
                </select>
              </label>
            </div>
          </FilterPanel>
          <label className="k-sort">
            <span className="sr-only">Sort jobs</span>
            <select className="k-select" value={sortOrder} onChange={(event) => setSortOrder(event.target.value as SortOrder)}>
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="salary-high">Salary: high to low</option>
              <option value="salary-low">Salary: low to high</option>
              <option value="az">Title A–Z</option>
              <option value="za">Title Z–A</option>
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
          <button className="k-link" type="button" onClick={clearFilters}>Reset</button>
        </div>
      )}

      {isLoading ? (
        <SkeletonRows count={5} label="Loading jobs" />
      ) : error ? (
        <Banner tone="error" actions={<button className="k-btn k-btn-secondary k-btn-sm" type="button" onClick={onRetry}>Try again</button>}>
          Jobs couldn't load.
        </Banner>
      ) : visible.length === 0 ? (
        kareers.length === 0 ? (
          <EmptyState icon={faCompass} title="No jobs posted right now" text="Check back soon." />
        ) : (
          <EmptyState
            title="No jobs match"
            text="Try another search or reset the filters."
            actions={<button className="k-btn k-btn-secondary" type="button" onClick={() => { setSearchValue(''); clearFilters(); }}>Reset</button>}
          />
        )
      ) : (
        <div className={isDesktop ? 'k-split' : undefined}>
          <div>
            <p className="k-meta mb-2" aria-live="polite">{filteredKareers.length} job{filteredKareers.length === 1 ? '' : 's'}</p>
            <h2 className="sr-only">Jobs</h2>
            <div className="k-job-grid">
              {visible.map((job) => (
                <JobCard
                  key={`${job.jobSource}-${job.id}`}
                  job={job}
                  applicationStatus={getApplicationStatus(job)}
                  isSaved={savedJobs.has(job.id)}
                  selected={isDesktop && selected?.id === job.id}
                  onOpen={() => onOpenJob(job)}
                  onApply={() => onApply(job)}
                  onSave={() => onSave(job.id)}
                />
              ))}
            </div>
            {filteredKareers.length > visible.length && (
              <button className="k-btn k-btn-secondary k-btn-block mt-3" type="button" onClick={() => setPaging({ key: listKey, count: visibleCount + PAGE_SIZE })}>
                Show more ({filteredKareers.length - visible.length} left)
              </button>
            )}
          </div>
          {isDesktop && selected && renderDetail(selected)}
        </div>
      )}
    </div>
  );
}

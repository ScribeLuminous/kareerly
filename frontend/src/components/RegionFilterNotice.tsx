import type { JobMatchRunResults } from '../types';
import { regionLabel } from '../lib/regionPreference';

type RegionFilterNoticeProps = {
  filter: JobMatchRunResults['location_filter'];
  /** True when the report has at least one Fit-Now or Aspiration match. */
  hasMatches: boolean;
  onChangeRegion: () => void;
  onRemoveFilter: () => void;
  isBusy?: boolean;
};

/**
 * States which region the matches were limited to and, when the filter left
 * no match, says so and offers to change or remove it. Jobs outside the region
 * are never added to fill the list.
 */
export default function RegionFilterNotice({ filter, hasMatches, onChangeRegion, onRemoveFilter, isBusy = false }: RegionFilterNoticeProps) {
  if (!filter?.active) return null;
  const name = filter.region_name || regionLabel(filter.region) || 'your region';
  const remoteNote = filter.remote_allowed
    ? ' Remote jobs are included because your work setup allows remote work.'
    : '';
  const excluded = (filter.excluded_out_of_region || 0) + (filter.excluded_region_unknown || 0);
  const actions = (
    <div className="k-button-row">
      <button type="button" onClick={onChangeRegion} disabled={isBusy} className="k-btn k-btn-secondary k-btn-sm">
        Change region
      </button>
      <button type="button" onClick={onRemoveFilter} disabled={isBusy} className="k-btn k-btn-ghost k-btn-sm">
        Show jobs anywhere in the Philippines
      </button>
    </div>
  );

  if (!hasMatches) {
    return (
      <div className="k-card mb-4 text-center" role="status" data-testid="region-empty-state">
        <p className="k-empty-title">No matches in {name}</p>
        <p className="k-secondary mx-auto mt-1 max-w-md">
          None of the jobs that fit your resume are in {name}.{remoteNote} Jobs without a confirmed region
          (for example, listed only as “Philippines”) are hidden while a region filter is on.
        </p>
        <div className="mt-3 flex justify-center">{actions}</div>
      </div>
    );
  }

  return (
    <div className="k-banner" role="status" data-testid="region-filter-notice">
      <div className="k-banner-body">
        <div>
          Showing on-site and hybrid jobs in <strong>{name}</strong>
          {filter.location_scope === 'current' ? ' (your region)' : ''}.{remoteNote}
          {excluded > 0 ? ` ${excluded} other match${excluded === 1 ? '' : 'es'} outside it ${excluded === 1 ? 'is' : 'are'} hidden.` : ''}
        </div>
        {actions}
      </div>
    </div>
  );
}

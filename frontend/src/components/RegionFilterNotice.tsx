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
    <div className="mt-3 flex flex-wrap gap-2">
      <button
        type="button"
        onClick={onChangeRegion}
        disabled={isBusy}
        className="rounded-lg border border-rust bg-white px-3 py-2 text-xs font-bold text-rust transition-colors hover:bg-rust-l disabled:opacity-60"
      >
        Change region
      </button>
      <button
        type="button"
        onClick={onRemoveFilter}
        disabled={isBusy}
        className="rounded-lg bg-rust px-3 py-2 text-xs font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        Show jobs anywhere in the Philippines
      </button>
    </div>
  );

  if (!hasMatches) {
    return (
      <div className="mb-4 rounded-xl border border-amber bg-amber-l p-5 text-sm text-mid" role="status" data-testid="region-empty-state">
        <div className="mb-1 font-bold text-dark">No matches in {name}</div>
        <p>
          None of the jobs that fit your resume are in {name}.{remoteNote} Jobs whose region could not be confirmed
          (for example, listed only as “Philippines”) are not shown while a region filter is on.
        </p>
        {actions}
      </div>
    );
  }

  return (
    <div className="mb-4 rounded-xl border border-bdr bg-bg p-4 text-xs text-mid" role="status" data-testid="region-filter-notice">
      Showing on-site and hybrid jobs in <strong className="text-dark">{name}</strong>
      {filter.location_scope === 'current' ? ' (your current region)' : ''}.{remoteNote}
      {excluded > 0 ? ` ${excluded} other matching job${excluded === 1 ? '' : 's'} outside this region or with an unconfirmed region ${excluded === 1 ? 'is' : 'are'} hidden.` : ''}
      {actions}
    </div>
  );
}

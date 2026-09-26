import { useEffect, useState } from 'react';
import { resolveCurrentRegion } from '../lib/api';
import { PH_REGIONS, locationScopeOptions, normalizeLocationScope, regionLabel } from '../lib/regionPreference';
import type { LocationScope } from '../lib/regionPreference';

export type LocationPreferenceValue = { locationScope: LocationScope; region: string };

type LocationPreferenceQuestionProps = {
  scope: string | undefined;
  region: string | undefined;
  onChange: (next: LocationPreferenceValue) => void;
  /** Signed-in candidates have a saved profile location; guests choose their region. */
  isSignedIn: boolean;
  /** The saved profile location; undefined while it is still loading. */
  profileLocation?: string | null;
  name?: string;
};

type LookupState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'resolved'; region: string }
  | { status: 'unresolved' }
  | { status: 'error' };

/**
 * The region question shown in Step 3 and on the dashboard Preferences page.
 * It is separate from the work setup question. For "Only in my current
 * location" a signed-in candidate's region comes from their profile location
 * when the backend can resolve it; otherwise, and for guests, the candidate
 * chooses it. A region is never guessed.
 */
export default function LocationPreferenceQuestion({
  scope,
  region,
  onChange,
  isSignedIn,
  profileLocation,
  name = 'location-scope',
}: LocationPreferenceQuestionProps) {
  const currentScope = normalizeLocationScope(scope);
  const currentRegion = String(region || '').toUpperCase();
  const trimmedLocation = (profileLocation || '').trim();
  // Region code per looked-up location: '' when it names no single region, null when the lookup failed.
  const [lookups, setLookups] = useState<Record<string, string | null>>({});
  const wantsLookup = isSignedIn && currentScope === 'current' && profileLocation !== undefined && Boolean(trimmedLocation);
  const known = Object.prototype.hasOwnProperty.call(lookups, trimmedLocation);

  useEffect(() => {
    if (!wantsLookup || known) return;
    let active = true;
    resolveCurrentRegion(trimmedLocation)
      .then((result) => {
        if (active) setLookups((current) => ({ ...current, [trimmedLocation]: result.currentRegion }));
      })
      .catch(() => {
        if (active) setLookups((current) => ({ ...current, [trimmedLocation]: null }));
      });
    return () => {
      active = false;
    };
  }, [wantsLookup, known, trimmedLocation]);

  let lookup: LookupState = { status: 'idle' };
  if (isSignedIn && currentScope === 'current' && profileLocation !== undefined) {
    const value = lookups[trimmedLocation];
    if (!trimmedLocation) lookup = { status: 'unresolved' };
    else if (!known) lookup = { status: 'loading' };
    else if (value === null) lookup = { status: 'error' };
    else lookup = value ? { status: 'resolved', region: value } : { status: 'unresolved' };
  }
  const resolvedRegion = lookup.status === 'resolved' ? lookup.region : '';

  // The profile location decides the current region whenever it can be resolved.
  useEffect(() => {
    if (currentScope === 'current' && resolvedRegion && resolvedRegion !== currentRegion) {
      onChange({ locationScope: 'current', region: resolvedRegion });
    }
  }, [currentScope, currentRegion, resolvedRegion, onChange]);

  const chooseScope = (next: LocationScope) => {
    if (next === 'anywhere') onChange({ locationScope: 'anywhere', region: '' });
    else if (next === 'current') onChange({ locationScope: 'current', region: resolvedRegion });
    else onChange({ locationScope: 'region', region: currentRegion });
  };

  const regionSelect = (label: string) => (
    <label className="mt-3 block">
      <span className="mb-1 block text-xs font-semibold text-dark">{label}</span>
      <select
        className="w-full rounded-lg border border-bdr bg-white px-3 py-2 text-sm text-mid outline-none focus:border-rust"
        value={currentRegion}
        onChange={(event) => onChange({ locationScope: currentScope, region: event.target.value })}
      >
        <option value="">Select a region…</option>
        {PH_REGIONS.map((option) => (
          <option key={option.code} value={option.code}>{option.name}</option>
        ))}
      </select>
    </label>
  );

  const currentRegionDetails = () => {
    if (!isSignedIn) {
      return regionSelect('Select your current region');
    }
    if (profileLocation === undefined || lookup.status === 'loading' || lookup.status === 'idle') {
      return <p className="mt-3 text-xs text-soft-text">Finding your region from your profile location…</p>;
    }
    if (lookup.status === 'resolved') {
      return (
        <p className="mt-3 rounded-lg border border-bdr bg-bg p-3 text-xs text-mid" data-testid="current-region">
          Using <strong className="text-dark">{regionLabel(lookup.region)}</strong>, based on your profile location
          “{trimmedLocation}”. Update your location in Account Settings if this is not where you live now.
        </p>
      );
    }
    const reason = !trimmedLocation
      ? 'Your profile does not have a location yet.'
      : lookup.status === 'error'
        ? 'We could not look up your region right now.'
        : `We could not tell your region from “${trimmedLocation}”.`;
    return (
      <div className="mt-3 rounded-lg border border-amber bg-amber-l p-3 text-xs text-mid">
        {reason} Please choose your current region.
        {regionSelect('Your current region')}
      </div>
    );
  };

  return (
    <div className="rounded-xl border border-bdr bg-card p-5 transition-all hover:border-rust-m">
      <span className="mb-1 block text-sm font-semibold text-dark">Where do you want to work?</span>
      <p className="mb-3.5 text-xs text-soft-text">
        This limits on-site and hybrid jobs to a region. Your work setup answer is kept separately.
      </p>
      <div className="space-y-2.5" role="radiogroup">
        {locationScopeOptions.map((option) => (
          <label
            key={option.value}
            className="flex cursor-pointer items-start gap-3 rounded-lg border border-bdr bg-white p-3 transition-all hover:border-rust hover:bg-rust-l"
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={currentScope === option.value}
              onChange={() => chooseScope(option.value)}
              className="mt-1 cursor-pointer accent-rust"
            />
            <span>
              <span className="block text-sm font-medium text-mid">{option.label}</span>
              <span className="block text-xs text-soft-text">{option.description}</span>
            </span>
          </label>
        ))}
      </div>
      {currentScope === 'current' && currentRegionDetails()}
      {currentScope === 'region' && regionSelect('Region')}
    </div>
  );
}

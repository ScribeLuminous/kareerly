import type { SurveyAnswers } from '../types';

/**
 * Where a candidate wants job recommendations, separate from work setup.
 * - anywhere: no region filter.
 * - current: the candidate's current region (from the profile location when the
 *   backend can resolve it, otherwise chosen by the candidate).
 * - region: a region the candidate picked.
 */
export type LocationScope = 'anywhere' | 'current' | 'region';

export type RegionOption = { code: string; name: string };

// Mirrors REGIONS in backend/app/services/ph_regions.py (codes and names); a test
// keeps the two in step. Location text is only ever mapped by the backend.
export const PH_REGIONS: RegionOption[] = [
  { code: 'NCR', name: 'National Capital Region (Metro Manila)' },
  { code: 'CAR', name: 'Cordillera Administrative Region (CAR)' },
  { code: 'I', name: 'Region I – Ilocos Region' },
  { code: 'II', name: 'Region II – Cagayan Valley' },
  { code: 'III', name: 'Region III – Central Luzon' },
  { code: 'IV-A', name: 'Region IV-A – CALABARZON' },
  { code: 'IV-B', name: 'MIMAROPA Region' },
  { code: 'V', name: 'Region V – Bicol Region' },
  { code: 'VI', name: 'Region VI – Western Visayas' },
  { code: 'NIR', name: 'Negros Island Region (NIR)' },
  { code: 'VII', name: 'Region VII – Central Visayas' },
  { code: 'VIII', name: 'Region VIII – Eastern Visayas' },
  { code: 'IX', name: 'Region IX – Zamboanga Peninsula' },
  { code: 'X', name: 'Region X – Northern Mindanao' },
  { code: 'XI', name: 'Region XI – Davao Region' },
  { code: 'XII', name: 'Region XII – SOCCSKSARGEN' },
  { code: 'XIII', name: 'Region XIII – Caraga' },
  { code: 'BARMM', name: 'Bangsamoro Autonomous Region in Muslim Mindanao (BARMM)' },
];

export const locationScopeOptions: Array<{ value: LocationScope; label: string; description: string }> = [
  { value: 'anywhere', label: 'Anywhere in the Philippines', description: 'Show jobs in every region.' },
  {
    value: 'current',
    label: 'Only in my current location',
    description: 'Only jobs in the region where you live now. Remote jobs stay if your work setup allows remote work.',
  },
  {
    value: 'region',
    label: 'Choose a region',
    description: 'Only jobs in the region you pick. Remote jobs stay if your work setup allows remote work.',
  },
];

export function normalizeLocationScope(value: unknown): LocationScope {
  const text = String(value || '').trim().toLowerCase();
  return text === 'current' || text === 'region' ? text : 'anywhere';
}

export function regionLabel(code: string | null | undefined): string {
  const value = String(code || '').trim().toUpperCase();
  return PH_REGIONS.find((region) => region.code === value)?.name || '';
}

export function isKnownRegion(code: string | null | undefined): boolean {
  return Boolean(regionLabel(code));
}

/** A region filter needs a known region; "anywhere" needs nothing. */
export function isLocationPreferenceComplete(answers: Pick<SurveyAnswers, 'locationScope' | 'region'> | null | undefined): boolean {
  const scope = normalizeLocationScope(answers?.locationScope);
  return scope === 'anywhere' || isKnownRegion(answers?.region);
}

/** The fields the matching endpoints read; the region is sent only when a filter is on. */
export function locationPreferencePayload(
  answers: Pick<SurveyAnswers, 'locationScope' | 'region'> | null | undefined,
  currentLocation?: string | null,
): { location_scope: LocationScope; region: string; current_location: string } {
  const scope = normalizeLocationScope(answers?.locationScope);
  const region = scope === 'anywhere' ? '' : String(answers?.region || '').trim().toUpperCase();
  return {
    location_scope: scope,
    region: isKnownRegion(region) ? region : '',
    current_location: scope === 'current' ? String(currentLocation || '').trim() : '',
  };
}

/** One line for summaries: "Anywhere in the Philippines" or "Region VII – Central Visayas (current region)". */
export function describeLocationPreference(answers: Pick<SurveyAnswers, 'locationScope' | 'region'> | null | undefined): string {
  const scope = normalizeLocationScope(answers?.locationScope);
  if (scope === 'anywhere') return 'Anywhere in the Philippines';
  const name = regionLabel(answers?.region) || 'Region not chosen';
  return scope === 'current' ? `${name} (current region)` : name;
}

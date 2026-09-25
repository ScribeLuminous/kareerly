import type { JobMatchRunResults, LimitedReport, MatchResultItem } from '../types';

/**
 * Closest Match: when no job passes Fit-Now, the backend returns the jobs
 * nearest to it in `closest_matches`. They failed at least one Fit-Now rule, so
 * they are always labelled as not Fit-Now and never counted as Fit-Now.
 */
export const CLOSEST_MATCH_LABEL = 'Closest Match';

const NO_FIT_NOW_TEXT = 'No fit-now matches returned yet.';
const CLOSEST_INTRO =
  'No job meets every Fit-Now requirement yet. The closest opportunities below show what is still missing.';

/** The closest matches a report shows, within the same per-type limit as the other lists. */
export function closestMatchesFor(
  matchResults: JobMatchRunResults | undefined,
  limitedReport?: LimitedReport,
  limit?: number,
): MatchResultItem[] {
  const source = limitedReport ? limitedReport.closest_matches : matchResults?.closest_matches;
  const items = Array.isArray(source) ? source : [];
  return typeof limit === 'number' ? items.slice(0, Math.max(0, limit)) : items;
}

/** Text for an empty Fit-Now list: the catalogue problem, the closest-match note, or the default. */
export function emptyFitNowText(matchResults: JobMatchRunResults | undefined, closestCount: number): string {
  const catalog = matchResults?.catalog_status;
  if (catalog && catalog.state !== 'available' && catalog.message) return catalog.message;
  if (closestCount > 0) return matchResults?.recommendation_notice || CLOSEST_INTRO;
  return NO_FIT_NOW_TEXT;
}

function percentText(match: MatchResultItem | undefined): string {
  const raw = Number(match?.match_percentage);
  if (!Number.isFinite(raw)) return '';
  return ` at ${Math.round(raw <= 1 && raw >= 0 ? raw * 100 : raw)}%`;
}

/** Summary card line for Fit-Now; names the closest opportunity without calling it Fit-Now. */
export function fitNowSummaryDetail(
  topFitNow: MatchResultItem | undefined,
  topFitNowPercent: number | null,
  topClosest: MatchResultItem | undefined,
): string {
  if (topFitNow) {
    const percent = topFitNowPercent === null ? '' : ` at ${Math.round(topFitNowPercent)}%`;
    return `Best match: ${topFitNow.job_title || 'Untitled role'}${percent}.`;
  }
  if (topClosest) {
    return `Best match: Not available yet. Closest opportunity (not Fit-Now): ${topClosest.job_title || 'Untitled role'}${percentText(topClosest)}.`;
  }
  return 'Best match: Not available yet';
}

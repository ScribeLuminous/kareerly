// Saved matches are a snapshot of the job catalogue when they ran. A job posted
// or edited after that is missing from them (or scored on its old details), so
// the dashboard re-runs matching instead of showing the old snapshot.

export interface CatalogueTimestamps {
  created_at?: string | null;
  updated_at?: string | null;
}

function time(value: string | null | undefined): number {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/** True when any listed job was posted or edited after the saved run. Unknown times never count. */
export function isMatchRunStale(savedAt: string | null | undefined, jobs: CatalogueTimestamps[]): boolean {
  const ranAt = time(savedAt);
  if (!Number.isFinite(ranAt)) return false;
  return jobs.some((job) => time(job.created_at) > ranAt || time(job.updated_at) > ranAt);
}

// Must match BACKEND_VERSION in backend/app/main.py (tests/backendVersion.test.mjs
// checks this). The website is deployed on every merge; the backend is not, so a
// mismatch means the backend still runs older matching code.
export const EXPECTED_BACKEND_VERSION = '2026.10.14-job-level-cap';

export type BackendVersionCheck =
  | { status: 'current' }
  // Reachable, but older (no version, or a different one).
  | { status: 'outdated'; reported: string | null; expected: string }
  // Could not be read (asleep, offline, blocked); other errors already explain that.
  | { status: 'unknown' };

/** Compare the /api/health/config payload with the version this website was built for. */
export function assessBackendVersion(config: unknown): BackendVersionCheck {
  if (!config || typeof config !== 'object') return { status: 'unknown' };
  const reported = (config as { backend_version?: unknown }).backend_version;
  const version = typeof reported === 'string' && reported.trim() ? reported.trim() : null;
  return version === EXPECTED_BACKEND_VERSION
    ? { status: 'current' }
    : { status: 'outdated', reported: version, expected: EXPECTED_BACKEND_VERSION };
}

export function outdatedBackendMessage(check: Extract<BackendVersionCheck, { status: 'outdated' }>): { summary: string; detail: string } {
  return {
    summary: 'Kareerly\'s matching service is running an older version than this website, so job matches, skill gaps and learning recommendations may be out of date.',
    detail: `Site admin: redeploy the backend. It reports version ${check.reported || '(none)'}; this website expects ${check.expected}.`,
  };
}

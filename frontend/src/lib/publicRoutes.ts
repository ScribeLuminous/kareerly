// URLs of the screens a signed-out visitor moves between, so Back, Forward and
// refresh keep them where they were (audit UX-01). Signed-in workspaces have
// their own routes (pages/candidate/routes.ts, pages/employer/routes.ts).

export type PublicView =
  | 'landing'
  | 'onboarding'
  | 'candidate-login'
  | 'employer-login'
  | 'admin-login'
  | 'signup-default'
  | 'candidate-signup'
  | 'employer-signup'
  | 'password-recovery';

export type AccountKind = 'candidate' | 'employer' | 'admin';

export const PUBLIC_VIEW_PATHS: Record<PublicView, string> = {
  landing: '/',
  onboarding: '/start',
  'candidate-login': '/candidate/login',
  'employer-login': '/employer/login',
  'admin-login': '/admin/login',
  'signup-default': '/signup',
  'candidate-signup': '/signup/job-seeker',
  'employer-signup': '/signup/employer',
  'password-recovery': '/forgot-password',
};

const VIEW_BY_PATH = new Map<string, PublicView>(
  (Object.entries(PUBLIC_VIEW_PATHS) as Array<[PublicView, string]>).map(([view, path]) => [path, view]),
);

export function isPublicView(view: string): view is PublicView {
  return Object.prototype.hasOwnProperty.call(PUBLIC_VIEW_PATHS, view);
}

/** The public screen a path shows, or null for any other path. */
export function publicViewFromPath(pathname: string): PublicView | null {
  const path = pathname.replace(/\/+$/, '') || '/';
  return VIEW_BY_PATH.get(path) ?? null;
}

/** The password-recovery URL, remembering which login it returns to. */
export function passwordRecoveryPath(account: AccountKind): string {
  return account === 'candidate' ? PUBLIC_VIEW_PATHS['password-recovery'] : `${PUBLIC_VIEW_PATHS['password-recovery']}?account=${account}`;
}

/** Which login a recovery page returns to, from its URL. */
export function recoveryAccountFromSearch(search: string): AccountKind {
  const account = new URLSearchParams(search).get('account');
  return account === 'employer' || account === 'admin' ? account : 'candidate';
}

/** The login URL that brings the visitor back to `next` after signing in. */
export function loginPathFor(account: 'candidate' | 'employer', next: string): string {
  return `${PUBLIC_VIEW_PATHS[account === 'employer' ? 'employer-login' : 'candidate-login']}?next=${encodeURIComponent(next)}`;
}

/**
 * The page a login URL asked to return to, if it is one of the app's own
 * workspace pages (`isAllowed`); null otherwise, so the parameter can never
 * send someone to another site.
 */
export function safeNextPath(search: string, isAllowed: (path: string) => boolean): string | null {
  const next = new URLSearchParams(search).get('next') || '';
  if (!next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return null;
  const path = next.split(/[?#]/)[0];
  return isAllowed(path) ? path : null;
}

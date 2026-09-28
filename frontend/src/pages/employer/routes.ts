// Kept apart from the model so the app shell can check employer URLs without
// loading the employer workspace.
export type EmployerPage = 'dashboard' | 'jobs' | 'candidates' | 'messages' | 'account';

export const EMPLOYER_PAGE_PATHS: Record<EmployerPage, string> = {
  dashboard: '/employer/dashboard',
  jobs: '/employer/jobs',
  candidates: '/employer/candidates',
  messages: '/employer/messages',
  account: '/employer/account',
};

const JOB_DETAIL_PATH = /^\/employer\/jobs\/([^/]+)$/;

/** A job's own page, e.g. /employer/jobs/EMP-123. */
export function employerJobPath(jobId: string): string {
  return `${EMPLOYER_PAGE_PATHS.jobs}/${encodeURIComponent(jobId)}`;
}

/** The job id in a job page URL, or '' on any other page. */
export function employerJobIdFromPath(pathname: string): string {
  const match = pathname.replace(/\/+$/, '').match(JOB_DETAIL_PATH);
  if (!match) return '';
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return '';
  }
}

export function employerPageFromPath(pathname: string): EmployerPage {
  const path = pathname.replace(/\/+$/, '');
  if (JOB_DETAIL_PATH.test(path)) return 'jobs';
  const match = (Object.entries(EMPLOYER_PAGE_PATHS) as Array<[EmployerPage, string]>).find(([, value]) => value === path);
  return match ? match[0] : 'dashboard';
}

export function isEmployerWorkspacePath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, '');
  return Object.values(EMPLOYER_PAGE_PATHS).includes(path) || JOB_DETAIL_PATH.test(path);
}

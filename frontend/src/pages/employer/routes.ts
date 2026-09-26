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

export function employerPageFromPath(pathname: string): EmployerPage {
  const path = pathname.replace(/\/+$/, '');
  const match = (Object.entries(EMPLOYER_PAGE_PATHS) as Array<[EmployerPage, string]>).find(([, value]) => value === path);
  return match ? match[0] : 'dashboard';
}

export function isEmployerWorkspacePath(pathname: string): boolean {
  return Object.values(EMPLOYER_PAGE_PATHS).includes(pathname.replace(/\/+$/, ''));
}

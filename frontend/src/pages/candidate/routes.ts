import type { DashboardPage } from './model';

/** Each candidate page has its own URL so Back, refresh and links work. */
export const PAGE_PATHS: Record<DashboardPage, string> = {
  dashboard: '/candidate/dashboard',
  jobmatches: '/candidate/matches',
  'external-job': '/candidate/matches/analyze',
  skillgaps: '/candidate/skills',
  upskilling: '/candidate/skills/learning',
  kareers: '/candidate/kareers',
  applications: '/candidate/applications',
  messages: '/candidate/applications/messages',
  preferences: '/candidate/preferences',
  account: '/candidate/profile',
};

export function pageFromPath(pathname: string): DashboardPage {
  const path = pathname.replace(/\/+$/, '') || '/';
  const exact = (Object.entries(PAGE_PATHS) as Array<[DashboardPage, string]>).find(([, value]) => value === path);
  return exact ? exact[0] : 'dashboard';
}

export function isCandidateWorkspacePath(pathname: string): boolean {
  return Object.values(PAGE_PATHS).includes(pathname.replace(/\/+$/, ''));
}

export type NavSection = 'home' | 'matches' | 'applications' | 'skills' | 'kareers';

/**
 * The navigation destination a page belongs to (account pages belong to none).
 * Messages sit under Applications and Analyze a job is a Kareers tool, so they
 * keep their own URLs but light up their parent in the navigation.
 */
export function navSectionFor(page: DashboardPage): NavSection | null {
  switch (page) {
    case 'dashboard':
      return 'home';
    case 'jobmatches':
      return 'matches';
    case 'skillgaps':
    case 'upskilling':
      return 'skills';
    case 'applications':
    case 'messages':
      return 'applications';
    case 'kareers':
    case 'external-job':
      return 'kareers';
    default:
      return null;
  }
}

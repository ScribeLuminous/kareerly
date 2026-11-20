// The browser-tab title for each screen (audit UX-03), so tabs, history and
// screen readers say where the visitor is.

const SITE = 'Kareerly';
const HOME_TITLE = 'Kareerly - Find the job that fits you';

const VIEW_TITLES: Record<string, string> = {
  onboarding: 'Get your career report',
  'candidate-login': 'Log in',
  'employer-login': 'Employer log in',
  'admin-login': 'Admin log in',
  'signup-default': 'Create an account',
  'candidate-signup': 'Sign up as a job seeker',
  'employer-signup': 'Sign up as an employer',
  'password-recovery': 'Reset your password',
  'password-reset': 'Choose a new password',
  'admin-dashboard': 'Admin',
};

// Longest prefix first, so /candidate/skills/learning is not read as /candidate/skills.
const PATH_TITLES: Array<[string, string]> = [
  ['/candidate/matches/analyze', 'Analyze a job'],
  ['/candidate/applications/messages', 'Messages'],
  ['/candidate/skills/learning', 'Learning'],
  ['/candidate/dashboard', 'Home'],
  ['/candidate/matches', 'Matches'],
  ['/candidate/skills', 'Skills'],
  ['/candidate/kareers', 'Kareers'],
  ['/candidate/applications', 'Applications'],
  ['/candidate/preferences', 'Preferences'],
  ['/candidate/profile', 'Profile'],
  ['/employer/dashboard', 'Employer home'],
  ['/employer/jobs/assessments', 'Assessment templates'],
  ['/employer/jobs', 'Jobs'],
  ['/employer/candidates', 'Candidates'],
  ['/employer/insights', 'Insights'],
  ['/employer/messages', 'Messages'],
  ['/employer/account', 'Company account'],
];

export function pageTitle(view: string, pathname: string): string {
  if (view === 'landing') return HOME_TITLE;
  if (view === 'dashboard' || view === 'employer-dashboard') {
    const path = pathname.replace(/\/+$/, '');
    const match = PATH_TITLES.find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`));
    if (match) return `${match[1]} - ${SITE}`;
  }
  const title = VIEW_TITLES[view];
  return title ? `${title} - ${SITE}` : HOME_TITLE;
}

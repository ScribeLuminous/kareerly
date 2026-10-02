// Kept apart from the model so the app shell can check employer URLs without
// loading the employer workspace.
export type EmployerPage = 'dashboard' | 'jobs' | 'candidates' | 'insights' | 'messages' | 'account';

export const EMPLOYER_PAGE_PATHS: Record<EmployerPage, string> = {
  dashboard: '/employer/dashboard',
  jobs: '/employer/jobs',
  candidates: '/employer/candidates',
  insights: '/employer/insights',
  messages: '/employer/messages',
  account: '/employer/account',
};

// "assessments" is the templates section under Jobs and "new" is the job
// editor, never a job id.
const JOB_DETAIL_PATH = /^\/employer\/jobs\/(?!assessments$|new$)([^/]+)$/;
const JOB_EDITOR_PATH = /^\/employer\/jobs\/(?:new|(?!assessments\/)([^/]+)\/edit)$/;
const TEMPLATES_PATH = /^\/employer\/jobs\/assessments(?:\/([^/]+))?$/;

/** The job editor page: a blank posting, or an existing job's edit page. */
export function employerJobEditorPath(jobId = ''): string {
  return jobId ? `${EMPLOYER_PAGE_PATHS.jobs}/${encodeURIComponent(jobId)}/edit` : `${EMPLOYER_PAGE_PATHS.jobs}/new`;
}

/**
 * Where the URL is within the job editor: null outside it, '' for a new job,
 * otherwise the id of the job being edited.
 */
export function employerJobEditorIdFromPath(pathname: string): string | null {
  const match = pathname.replace(/\/+$/, '').match(JOB_EDITOR_PATH);
  if (!match) return null;
  try {
    return match[1] ? decodeURIComponent(match[1]) : '';
  } catch {
    return null;
  }
}

/** The assessment templates list, or one template's page ('new' for a blank one). */
export function employerTemplatePath(templateId = ''): string {
  return `${EMPLOYER_PAGE_PATHS.jobs}/assessments${templateId ? `/${encodeURIComponent(templateId)}` : ''}`;
}

/**
 * Where the URL is within the templates section: null outside it, '' on the
 * list, otherwise the template id (or 'new').
 */
export function employerTemplateIdFromPath(pathname: string): string | null {
  const match = pathname.replace(/\/+$/, '').match(TEMPLATES_PATH);
  if (!match) return null;
  try {
    return match[1] ? decodeURIComponent(match[1]) : '';
  } catch {
    return null;
  }
}

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
  if (JOB_DETAIL_PATH.test(path) || JOB_EDITOR_PATH.test(path) || TEMPLATES_PATH.test(path)) return 'jobs';
  const match = (Object.entries(EMPLOYER_PAGE_PATHS) as Array<[EmployerPage, string]>).find(([, value]) => value === path);
  return match ? match[0] : 'dashboard';
}

export function isEmployerWorkspacePath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, '');
  return Object.values(EMPLOYER_PAGE_PATHS).includes(path) || JOB_DETAIL_PATH.test(path) || JOB_EDITOR_PATH.test(path) || TEMPLATES_PATH.test(path);
}

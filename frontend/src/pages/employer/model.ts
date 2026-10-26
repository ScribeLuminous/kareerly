import { savedMatchScore } from '../../lib/uiData';
import { splitJobContent, toListItems } from '../../lib/jobDescription';
import { splitLocation } from '../../lib/phProvinces';

export type { EmployerPage } from './routes';
export { EMPLOYER_PAGE_PATHS, employerJobEditorIdFromPath, employerJobEditorPath, employerJobIdFromPath, employerJobPath, employerPageFromPath, employerTemplateIdFromPath, employerTemplatePath, isEmployerWorkspacePath } from './routes';
export { EMPLOYER_COMPANY_SIZES, EMPLOYER_INDUSTRIES } from '../../lib/employerOptions';

export type JobStatus = 'open' | 'draft' | 'closed' | 'archived';

export type CandidateStatus = 'Pending' | 'Shortlisted' | 'Interviewing' | 'Hired' | 'Rejected' | 'Withdrawn';

export type MessageRequestState = 'none' | 'pending' | 'accepted' | 'declined' | 'ignored';

export type ToastType = '' | 'success' | 'warn' | 'danger';

export type ReviewAction = 'shortlisted' | 'interviewing' | 'hired' | 'rejected';


export type EmployerJob = {
  id: string;
  databaseId?: string;
  title: string;
  category: string;
  subcategory: string;
  experienceLevel: string;
  description: string;
  responsibilities: string[];
  qualifications: string[];
  requiredSkills: string[];
  niceToHaveSkills: string[];
  workSetup: string;
  employmentType: string;
  city: string;
  province: string;
  salaryRange: string;
  deadline: string;
  status: JobStatus;
  postedDate: string;
};

export type EmployerJobPostRow = {
  id: string;
  job_id: string;
  category_code: string | null;
  category_name: string | null;
  job_subcategory?: string | null;
  job_title: string;
  company_name: string | null;
  location: string | null;
  work_setup: string | null;
  employment_type: string | null;
  job_level: string | null;
  salary_min_php: number | null;
  salary_max_php: number | null;
  job_description: string | null;
  responsibilities?: string | null;
  qualifications?: string | null;
  required_skills: string | null;
  preferred_skills: string | null;
  posting_status: string | null;
  application_deadline?: string | null;
  created_at: string | null;
};

export type MessageEntry = {
  from: 'employer' | 'candidate';
  text: string;
  time: string;
};

export type CandidateApplication = {
  id: string;
  publicId: string;
  fullName: string;
  role: string;
  jobId: string;
  /**
   * The candidate-side ranking score saved when they applied (semantic text
   * similarity plus skill coverage). Kept for reference only: its text
   * similarity part is not stored, so it cannot be explained to a reviewer
   * and is not shown as a match figure.
   */
  applyTimeRankingScore: number | null;
  matchedSkills: string[];
  missingSkills: string[];
  status: CandidateStatus;
  appliedDate: string;
  /** Latest of applying, a stage change or a message (ISO timestamp). */
  lastActivity: string;
  location: string;
  messageRequestState: MessageRequestState;
  messages: MessageEntry[];
};

export type JobApplicationRow = {
  id: string;
  user_id: string;
  job_source?: 'internal' | 'employer' | null;
  job_id: string;
  job_title?: string | null;
  company_name?: string | null;
  candidate_name?: string | null;
  candidate_email?: string | null;
  candidate_location?: string | null;
  match_score?: number | null;
  matched_skills?: string[] | null;
  missing_skills?: string[] | null;
  message_request_state?: MessageRequestState | null;
  status?: string | null;
  created_at?: string | null;
  applied_at?: string | null;
  updated_at?: string | null;
};

export type ApplicationMessageRow = {
  id: string;
  application_id: string;
  sender_user_id: string;
  sender_role: 'candidate' | 'employer';
  message_kind: 'request' | 'message';
  message_text: string;
  created_at: string | null;
};

export type NotificationItem = {
  id: string;
  title: string;
  message: string;
  time: string;
  type: 'match' | 'app' | 'msg' | 'warn' | 'job';
  unread: boolean;
};

export type JobFormState = {
  title: string;
  category: string;
  subcategory: string;
  experienceLevel: string;
  description: string;
  responsibilities: string;
  qualifications: string;
  workSetup: string;
  employmentType: string;
  city: string;
  province: string;
  salaryRange: string;
  deadline: string;
  status: JobStatus;
};

export const jobCategoryOptions = [
  {
    code: 'K01',
    label: 'Software and Web Development',
    value: 'Software and Web Development',
    subcategories: ['Software Development', 'Web Development'],
  },
  {
    code: 'K02',
    label: 'Data, Analytics, and Artificial Intelligence',
    value: 'Data, Analytics, and Artificial Intelligence',
    subcategories: ['Data Analytics', 'Artificial Intelligence'],
  },
  {
    code: 'K03',
    label: 'IT Infrastructure and Cybersecurity',
    value: 'IT Infrastructure and Cybersecurity',
    subcategories: ['IT Infrastructure', 'Cybersecurity'],
  },
  {
    code: 'K04',
    label: 'Finance and Accounting',
    value: 'Finance and Accounting',
    subcategories: ['Accounting', 'Finance'],
  },
  {
    code: 'K05',
    label: 'Office Administration and Records',
    value: 'Office Administration and Records',
    subcategories: ['Office Administration', 'Records Management'],
  },
  {
    code: 'K06',
    label: 'Human Resources and Project Management',
    value: 'Human Resources and Project Management',
    subcategories: ['Human Resources', 'Project Management'],
  },
  {
    code: 'K07',
    label: 'Sales and Purchasing',
    value: 'Sales and Purchasing',
    subcategories: ['Sales', 'Purchasing'],
  },
  {
    code: 'K08',
    label: 'Marketing and Public Relations',
    value: 'Marketing and Public Relations',
    subcategories: ['Marketing', 'Public Relations'],
  },
  {
    code: 'K09',
    label: 'Customer Service and Retail',
    value: 'Customer Service and Retail',
    subcategories: ['Customer Service', 'Retail'],
  },
  {
    code: 'K10',
    label: 'Writing, Language, and Communications',
    value: 'Writing, Language, and Communications',
    subcategories: ['Writing', 'Communications'],
  },
  {
    code: 'K11',
    label: 'Design, Media, and Performing Arts',
    value: 'Design, Media, and Performing Arts',
    subcategories: ['Design', 'Media', 'Performing Arts'],
  },
  {
    code: 'K12',
    label: 'Education and Training',
    value: 'Education and Training',
    subcategories: ['Education', 'Training'],
  },
  {
    code: 'K13',
    label: 'Social and Community Services',
    value: 'Social and Community Services',
    subcategories: ['Social Services', 'Community Services'],
  },
  {
    code: 'K14',
    label: 'Healthcare and Clinical Services',
    value: 'Healthcare and Clinical Services',
    subcategories: ['Healthcare', 'Clinical Services'],
  },
  {
    code: 'K15',
    label: 'Caregiving and Wellness',
    value: 'Caregiving and Wellness',
    subcategories: ['Caregiving', 'Wellness'],
  },
  {
    code: 'K16',
    label: 'Engineering and Architecture',
    value: 'Engineering and Architecture',
    subcategories: ['Engineering', 'Architecture'],
  },
  {
    code: 'K17',
    label: 'Construction and Skilled Trades',
    value: 'Construction and Skilled Trades',
    subcategories: ['Construction', 'Skilled Trades'],
  },
  {
    code: 'K18',
    label: 'Hospitality and Tourism',
    value: 'Hospitality and Tourism',
    subcategories: ['Hospitality', 'Tourism'],
  },
  {
    code: 'K19',
    label: 'Food Service and Personal Care',
    value: 'Food Service and Personal Care',
    subcategories: ['Food Service', 'Personal Care'],
  },
  {
    code: 'K20',
    label: 'Logistics, Transport, and Warehousing',
    value: 'Logistics, Transport, and Warehousing',
    subcategories: ['Logistics', 'Transport', 'Warehousing'],
  },
  {
    code: 'K21',
    label: 'Manufacturing and Quality Operations',
    value: 'Manufacturing and Quality Operations',
    subcategories: ['Manufacturing', 'Quality Operations'],
  },
  {
    code: 'K22',
    label: 'Agriculture, Forestry, Fishery, and Environment',
    value: 'Agriculture, Forestry, Fishery, and Environment',
    subcategories: ['Agriculture', 'Forestry', 'Fishery', 'Environment'],
  },
  {
    code: 'K23',
    label: 'Public Administration and Government',
    value: 'Public Administration and Government',
    subcategories: ['Public Administration', 'Government'],
  },
  {
    code: 'K24',
    label: 'Legal, Security, and Protective Services',
    value: 'Legal, Security, and Protective Services',
    subcategories: ['Legal', 'Security', 'Protective Services'],
  },
];

export const jobSubcategoryMap = jobCategoryOptions.reduce<Record<string, string[]>>((map, category) => {
  map[category.value] = category.subcategories;
  return map;
}, {});

export const MIN_EMPLOYER_SALARY = 10000;

export const getSalaryAmounts = (value: string): { minimum: number; maximum: number } => {
  const amounts = Array.from(value.matchAll(/[0-9][0-9,\s.]*/g))
    .map((match) => Number(match[0].replace(/[^\d]/g, '')))
    .filter((amount) => Number.isFinite(amount) && amount > 0);
  return {
    minimum: amounts[0] || 0,
    maximum: amounts[1] || amounts[0] || 0,
  };
};

/** The editor's "minimum-maximum" salary as numbers; 0 for a side left empty. */
export const parseSalaryInput = (value: string): { minimum: number; maximum: number } => {
  const [minimum = '', maximum = ''] = value.split('-');
  const amount = (part: string) => Number(part.replace(/[^\d]/g, '')) || 0;
  return { minimum: amount(minimum), maximum: amount(maximum) };
};

/** Back from formatPesoSalary to the editor's "minimum-maximum" form. */
export const toSalaryInputValue = (value: string): string => {
  const text = value.trim();
  const { minimum, maximum } = getSalaryAmounts(text);
  if (!minimum) return '';
  // Drafts can be saved with only one side of the range.
  if (/^up to/i.test(text)) return `-${minimum}`;
  if (/^from/i.test(text)) return `${minimum}-`;
  return `${minimum}-${maximum}`;
};

export const formatPesoSalary = (value: string): string => {
  const { minimum, maximum } = parseSalaryInput(value);
  if (minimum && maximum) return `₱${minimum.toLocaleString('en-PH')} - ${maximum.toLocaleString('en-PH')}`;
  if (minimum) return `From ₱${minimum.toLocaleString('en-PH')}`;
  if (maximum) return `Up to ₱${maximum.toLocaleString('en-PH')}`;
  return '';
};

export const getCategoryCode = (categoryValue: string): string => jobCategoryOptions.find((category) => category.value === categoryValue)?.code || '';

export const splitSkills = (value: string | null | undefined): string[] =>
  String(value || '')
    .split(',')
    .map((skill) => skill.trim())
    .filter(Boolean);

export const mapPostingStatusToJobStatus = (status: string | null | undefined): JobStatus => {
  if (status === 'active' || status === 'open') return 'open';
  if (status === 'closed') return 'closed';
  if (status === 'archived') return 'archived';
  return 'draft';
};

export const mapApplicationStatus = (status: string | null | undefined): CandidateStatus => {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'shortlisted') return 'Shortlisted';
  if (normalized === 'interviewing') return 'Interviewing';
  if (normalized === 'hired') return 'Hired';
  if (normalized === 'rejected') return 'Rejected';
  if (normalized === 'withdrawn') return 'Withdrawn';
  return 'Pending';
};

export const toEmployerJob = (row: EmployerJobPostRow): EmployerJob => {
  const content = splitJobContent(row.job_description || '');
  return {
    id: row.job_id,
    databaseId: row.id,
    title: row.job_title,
    category: row.category_name || '',
    subcategory: row.job_subcategory || '',
    experienceLevel: row.job_level || '',
    description: content.description,
    responsibilities: row.responsibilities ? toListItems(row.responsibilities) : content.responsibilities,
    qualifications: row.qualifications ? toListItems(row.qualifications) : content.qualifications,
    requiredSkills: splitSkills(row.required_skills),
    niceToHaveSkills: splitSkills(row.preferred_skills),
    workSetup: row.work_setup || '',
    employmentType: row.employment_type || '',
    ...splitLocation(row.location),
    salaryRange: formatPesoSalary(`${row.salary_min_php || ''}-${row.salary_max_php || ''}`),
    deadline: row.application_deadline || '',
    status: row.posting_status !== 'archived' && row.application_deadline && row.application_deadline <= todayIso() ? 'closed' : mapPostingStatusToJobStatus(row.posting_status),
    postedDate: row.created_at ? row.created_at.slice(0, 10) : '',
  };
};

export const mapMessageRequestState = (state: string | null | undefined): MessageRequestState => {
  if (state === 'pending' || state === 'accepted' || state === 'declined' || state === 'ignored') return state;
  return 'none';
};

export const toMessageEntry = (row: ApplicationMessageRow): MessageEntry => ({
  from: row.sender_role === 'employer' ? 'employer' : 'candidate',
  text: row.message_text,
  time: row.created_at ? formatDateLabel(row.created_at.slice(0, 10)) : 'Time unavailable',
});

export const toCandidateApplication = (row: JobApplicationRow, jobs: EmployerJob[], messages: ApplicationMessageRow[] = [], publicId = ''): CandidateApplication => {
  const relatedJob = jobs.find((job) => job.id === row.job_id);
  const status = mapApplicationStatus(row.status);
  const matchedSkills = Array.isArray(row.matched_skills) ? row.matched_skills.filter(Boolean) : [];
  const missingSkills = Array.isArray(row.missing_skills) ? row.missing_skills.filter(Boolean) : [];

  return {
    id: row.id,
    publicId,
    fullName: row.candidate_name || row.candidate_email || `Candidate ${String(row.user_id || row.id).slice(0, 8)}`,
    role: row.job_title || relatedJob?.title || 'Untitled role',
    jobId: row.job_id,
    applyTimeRankingScore: savedMatchScore(row.match_score),
    matchedSkills,
    missingSkills,
    status,
    appliedDate: (row.applied_at || row.created_at || '').slice(0, 10),
    lastActivity: [row.applied_at, row.created_at, row.updated_at, ...messages.map((message) => message.created_at)]
      .filter((value): value is string => Boolean(value))
      .sort()
      .pop() || '',
    location: row.candidate_location || 'Location not provided',
    messageRequestState: mapMessageRequestState(row.message_request_state),
    messages: messages.map(toMessageEntry),
  };
};

export const emptyJobForm: JobFormState = {
  title: '',
  category: '',
  subcategory: '',
  experienceLevel: '',
  description: '',
  responsibilities: '',
  qualifications: '',
  workSetup: '',
  employmentType: '',
  city: '',
  province: '',
  salaryRange: '',
  deadline: '',
  status: 'draft',
};

export const initialJobs: EmployerJob[] = [];

export const initialApplications: CandidateApplication[] = [];

export const initialNotifications: NotificationItem[] = [];

export function getInitials(label: string): string {
  const parts = label.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'EM';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
}

export function maskedName(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  return parts
    .map((part) => {
      if (part.length <= 1) return part;
      return `${part[0]}${'*'.repeat(Math.max(4, part.length - 1))}`;
    })
    .join(' ');
}

export function formatDateLabel(value: string): string {
  const parsed = new Date(value);
  if (!value || Number.isNaN(parsed.getTime())) return 'Date unavailable';
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function todayIso(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function shouldRevealIdentity(status: CandidateStatus): boolean {
  return status === 'Interviewing' || status === 'Hired' || status === 'Rejected';
}

export function statusActionLabel(action: ReviewAction): string {
  if (action === 'shortlisted') return 'Shortlist this applicant';
  if (action === 'interviewing') return 'Move to Interviewing';
  if (action === 'hired') return 'Mark as hired';
  return 'Reject this application';
}

export function statusActionMessage(action: ReviewAction, candidateId: string): string {
  if (action === 'shortlisted') return `Moving ${candidateId} to Shortlisted sends them this job's Candidate Assessment.`;
  if (action === 'interviewing') {
    return 'Moving to Interviewing will unlock full candidate profile details and allow message requests.';
  }
  if (action === 'hired') return 'Marking this application as Hired records a final recruitment outcome.';
  return 'Rejecting this applicant is a final decision and will close this application.';
}

// ---------- Display helpers for the redesigned employer views ----------

/** The name an employer may see: masked until Interviewing. */
export function candidateDisplayName(candidate: Pick<CandidateApplication, 'status' | 'fullName'>): string {
  return shouldRevealIdentity(candidate.status) ? candidate.fullName : maskedName(candidate.fullName);
}

/** How an applicant is titled: their name once revealed, otherwise their candidate ID. */
export function applicantTitle(candidate: Pick<CandidateApplication, 'status' | 'fullName' | 'publicId'>): string {
  return shouldRevealIdentity(candidate.status) ? candidate.fullName : candidate.publicId || 'Applicant';
}

export function candidateStatusBadgeClass(status: CandidateStatus): string {
  if (status === 'Hired') return 'k-badge k-badge-success';
  if (status === 'Interviewing' || status === 'Shortlisted') return 'k-badge k-badge-info';
  if (status === 'Rejected') return 'k-badge k-badge-danger';
  if (status === 'Withdrawn') return 'k-badge k-badge-outline';
  return 'k-badge k-badge-high';
}

export function jobStatusBadgeClass(status: JobStatus): string {
  if (status === 'open') return 'k-badge k-badge-success';
  if (status === 'draft') return 'k-badge k-badge-high';
  return 'k-badge k-badge-outline';
}

export const JOB_STATUS_LABEL: Record<JobStatus, string> = { open: 'Open', draft: 'Draft', closed: 'Closed', archived: 'Archived' };

/** What employer_job_posts.posting_status stores for each job status. */
export const JOB_POSTING_STATUS: Record<JobStatus, string> = { open: 'active', draft: 'draft', closed: 'closed', archived: 'archived' };

export const ACTIVE_CANDIDATE_STATUSES: CandidateStatus[] = ['Pending', 'Shortlisted', 'Interviewing'];

export function jobLocation(job: Pick<EmployerJob, 'city' | 'province'>): string {
  return [job.city, job.province].filter(Boolean).join(', ');
}

/** Days until a deadline (negative once passed), or null when there is none. */
export function daysUntil(dateIso: string, today = todayIso()): number | null {
  if (!dateIso) return null;
  const target = new Date(`${dateIso}T00:00:00`);
  const base = new Date(`${today}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  return Math.round((target.getTime() - base.getTime()) / 86_400_000);
}


// Stored as the full sentence; the label is what the employer picks from.
export const REJECTION_REASONS: Array<{ value: string; label: string }> = [
  { value: 'Another candidate more closely matched the role requirements.', label: 'Another candidate more closely matched the role requirements' },
  { value: 'The application did not demonstrate the required level of relevant experience.', label: 'Required relevant experience was not sufficiently demonstrated' },
  { value: 'The application did not demonstrate one or more essential technical skills.', label: 'Essential technical skills were not sufficiently demonstrated' },
  { value: "The candidate's availability did not align with the role's current requirements.", label: 'Availability did not align with the role requirements' },
  { value: "The candidate's location or work-setup preference did not align with this position.", label: 'Location or work-setup preference did not align' },
  { value: 'The position has been placed on hold or is no longer being filled.', label: 'Position placed on hold or no longer being filled' },
  { value: 'The compensation expectations could not be aligned with the approved range.', label: 'Compensation expectations did not align with the approved range' },
];

export const EXPERIENCE_LEVELS = ['Entry-level / Fresh Graduate', 'Junior (1-2 yrs)', 'Mid-level (3-5 yrs)', 'Senior (5+ yrs)'];
export const WORK_SETUPS = ['Remote', 'Hybrid', 'On-site'];
export const EMPLOYMENT_TYPES = ['Full-time', 'Part-time', 'Contract', 'Temporary', 'Internship'];

export type JobStats = { applications: number; pending: number; inReview: number; closed: number };
export const EMPTY_JOB_STATS: JobStats = { applications: 0, pending: 0, inReview: 0, closed: 0 };

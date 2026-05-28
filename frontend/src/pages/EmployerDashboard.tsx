import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import {
  faArrowRight,
  faBan,
  faBars,
  faBell,
  faBookmark,
  faBolt,
  faBriefcase,
  faBuilding,
  faCalendar,
  faCalendarCheck,
  faCheck,
  faChevronDown,
  faCircle,
  faCircleInfo,
  faCircleXmark,
  faClock,
  faComments,
  faEnvelope,
  faEye,
  faFlag,
  faGear,
  faHandshake,
  faLayerGroup,
  faLock,
  faLocationDot,
  faMagnifyingGlass,
  faPaperPlane,
  faPenToSquare,
  faPlus,
  faRightFromBracket,
  faShieldHalved,
  faStar,
  faTable,
  faTableCellsLarge,
  faTag,
  faUserTie,
  faUsers,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import Logo from '../components/Logo';
import './employer-dashboard-v5.css';

type EmployerDashboardProps = {
  employer: { name: string; email: string; company: string } | null;
  onHome: () => void;
  onLogin: () => void;
  onSignUp: () => void;
  onLogout?: () => void;
};

type EmployerPage = 'dashboard' | 'jobs' | 'candidates' | 'messages' | 'account';
type JobStatus = 'open' | 'draft' | 'closed';
type CandidateStatus = 'Pending' | 'Shortlisted' | 'Interviewing' | 'Hired' | 'Rejected' | 'Withdrawn';
type MessageRequestState = 'none' | 'pending' | 'accepted' | 'declined' | 'ignored';
type ToastType = '' | 'success' | 'warn' | 'danger';
type MatchBucket = 'top' | 'good' | 'partial';
type CandidateFilter = 'all' | 'pending' | 'shortlisted' | 'interviewing' | 'hired' | 'rejected' | 'withdrawn';
type ReviewAction = 'shortlisted' | 'interviewing' | 'hired' | 'rejected';
type CandidateView = 'kanban' | 'table';
type JobsPanelMode = 'detail' | 'edit' | 'new';

type IconName =
  | 'menu'
  | 'bell'
  | 'chevron-down'
  | 'dashboard'
  | 'briefcase'
  | 'users'
  | 'messages'
  | 'building'
  | 'cog'
  | 'star'
  | 'layers'
  | 'calendar-check'
  | 'envelope'
  | 'times-circle'
  | 'clock'
  | 'bolt'
  | 'plus'
  | 'search'
  | 'edit'
  | 'close'
  | 'shield'
  | 'table'
  | 'eye'
  | 'bookmark'
  | 'handshake'
  | 'ban'
  | 'flag'
  | 'paper-plane'
  | 'check'
  | 'lock'
  | 'map-pin'
  | 'tag'
  | 'calendar'
  | 'arrow-right'
  | 'info'
  | 'user-tie'
  | 'logout';

type EmployerJob = {
  id: string;
  title: string;
  category: string;
  subcategory: string;
  experienceLevel: string;
  description: string;
  requiredSkills: string[];
  niceToHaveSkills: string[];
  workSetup: string;
  city: string;
  province: string;
  salaryRange: string;
  deadline: string;
  status: JobStatus;
  postedDate: string;
};

type MessageEntry = {
  from: 'employer' | 'candidate';
  text: string;
  time: string;
};

type CandidateApplication = {
  id: string;
  fullName: string;
  role: string;
  jobId: string;
  matchPercent: number;
  matchedSkills: string[];
  missingSkills: string[];
  status: CandidateStatus;
  appliedDate: string;
  location: string;
  matchSummary: string;
  strengthNote: string;
  gapNote: string;
  recommendation: string;
  messageRequestState: MessageRequestState;
  messages: MessageEntry[];
};

type NotificationItem = {
  id: string;
  title: string;
  message: string;
  time: string;
  type: 'match' | 'app' | 'msg' | 'warn' | 'job';
  unread: boolean;
};

type JobFormState = {
  title: string;
  category: string;
  subcategory: string;
  experienceLevel: string;
  description: string;
  workSetup: string;
  location: string;
  salaryRange: string;
  deadline: string;
  status: JobStatus;
};

const jobSubcategoryMap: Record<string, string[]> = {
  engineering: ['Frontend', 'Backend', 'Full Stack', 'DevOps', 'QA / Testing'],
  data: ['Data Analyst', 'Data Engineer', 'Data Scientist', 'Business Intelligence', 'Analytics'],
  sales: ['Account Executive', 'Sales Manager', 'Business Development', 'Digital Marketing'],
  operations: ['Operations Manager', 'Project Manager', 'Process Improvement'],
  design: ['UI/UX Designer', 'Graphic Designer', 'Product Designer'],
};

const emptyJobForm: JobFormState = {
  title: '',
  category: '',
  subcategory: '',
  experienceLevel: '',
  description: '',
  workSetup: '',
  location: '',
  salaryRange: '',
  deadline: '',
  status: 'draft',
};

const initialJobs: EmployerJob[] = [
  {
    id: 'job-1',
    title: 'Junior Data Analyst',
    category: 'data',
    subcategory: 'Data Analyst',
    experienceLevel: 'Entry-level / Fresh Graduate',
    description:
      'Support data preparation, dashboard updates, and reporting workflows for internal business teams.',
    requiredSkills: ['SQL', 'Excel', 'Data Cleaning', 'Power BI'],
    niceToHaveSkills: ['Python', 'Tableau'],
    workSetup: 'Remote',
    city: 'Makati',
    province: 'NCR',
    salaryRange: 'PHP 25,000 - PHP 40,000',
    deadline: '2026-06-30',
    status: 'open',
    postedDate: '2026-05-20',
  },
  {
    id: 'job-2',
    title: 'Senior Frontend Engineer',
    category: 'engineering',
    subcategory: 'Frontend',
    experienceLevel: 'Senior (5+ yrs)',
    description:
      'Lead feature development for our web platform and collaborate with product/design on scalable interfaces.',
    requiredSkills: ['React', 'JavaScript', 'CSS', 'Git', 'System Design'],
    niceToHaveSkills: ['TypeScript', 'Testing', 'CI/CD'],
    workSetup: 'Hybrid',
    city: 'Taguig',
    province: 'NCR',
    salaryRange: 'PHP 90,000 - PHP 130,000',
    deadline: '2026-06-15',
    status: 'open',
    postedDate: '2026-05-15',
  },
];

const initialApplications: CandidateApplication[] = [
  {
    id: 'CDT-001',
    fullName: 'Daniela Abad',
    role: 'Junior Data Analyst',
    jobId: 'job-1',
    matchPercent: 95,
    matchedSkills: ['SQL', 'Excel', 'Data Cleaning'],
    missingSkills: ['Power BI'],
    status: 'Interviewing',
    appliedDate: '2026-05-22',
    location: 'Metro Manila, NCR',
    matchSummary:
      'Strong alignment with 3 of 4 required skills. Power BI is the main gap. Recommended for interview.',
    strengthNote: 'Strong technical foundation in SQL, Excel, and data cleaning tasks.',
    gapNote: 'Power BI remains the primary missing required skill for this role.',
    recommendation:
      'Applicant meets the 90%+ threshold. Interview is recommended to validate adaptability.',
    messageRequestState: 'accepted',
    messages: [
      {
        from: 'employer',
        text: 'Good day! We would like to schedule an initial interview this week. Are you available Thursday or Friday, 10 AM to 4 PM?',
        time: 'May 24, 2026 · 8:14 AM',
      },
      {
        from: 'candidate',
        text: 'Thank you for reaching out! Thursday at 2 PM works for me.',
        time: 'May 24, 2026 · 9:02 AM',
      },
    ],
  },
  {
    id: 'CDT-002',
    fullName: 'Marco Santos',
    role: 'Senior Frontend Engineer',
    jobId: 'job-2',
    matchPercent: 92,
    matchedSkills: ['React', 'JavaScript', 'CSS', 'Git'],
    missingSkills: ['System Design'],
    status: 'Shortlisted',
    appliedDate: '2026-05-20',
    location: 'Pasig, NCR',
    matchSummary:
      'Very strong frontend profile. One gap remains in system design. Priority review candidate.',
    strengthNote: 'Excellent React and JavaScript expertise with strong implementation history.',
    gapNote: 'System design skills are not evidenced in submitted profile artifacts.',
    recommendation: 'Move to Interviewing when role bandwidth allows for architecture assessment.',
    messageRequestState: 'none',
    messages: [],
  },
  {
    id: 'CDT-003',
    fullName: 'Andrea Cruz',
    role: 'Junior Data Analyst',
    jobId: 'job-1',
    matchPercent: 79,
    matchedSkills: ['Excel', 'Data Entry'],
    missingSkills: ['SQL', 'Power BI', 'Python'],
    status: 'Withdrawn',
    appliedDate: '2026-05-10',
    location: 'Caloocan, NCR',
    matchSummary: 'Candidate withdrew this application. Record is closed and read-only.',
    strengthNote: 'Base administrative and spreadsheet familiarity.',
    gapNote: 'Multiple required analytics skills remain uncovered.',
    recommendation: 'No further action available — application withdrawn by candidate.',
    messageRequestState: 'none',
    messages: [],
  },
  {
    id: 'CDT-004',
    fullName: 'Jared Dela Cruz',
    role: 'Junior Data Analyst',
    jobId: 'job-1',
    matchPercent: 88,
    matchedSkills: ['SQL', 'Tableau'],
    missingSkills: ['Power BI', 'Python'],
    status: 'Pending',
    appliedDate: '2026-05-18',
    location: 'Quezon City, NCR',
    matchSummary:
      'Good alignment with relevant SQL and dashboard skills; improvement needed for BI and scripting.',
    strengthNote: 'SQL and Tableau coverage suggests workable reporting readiness.',
    gapNote: 'Power BI and Python are still missing and should be validated via assessment.',
    recommendation: 'Shortlist for next-pass review and technical screen.',
    messageRequestState: 'none',
    messages: [],
  },
  {
    id: 'CDT-005',
    fullName: 'Riza Mendoza',
    role: 'Senior Frontend Engineer',
    jobId: 'job-2',
    matchPercent: 72,
    matchedSkills: ['JavaScript'],
    missingSkills: ['React', 'CSS', 'Git', 'System Design'],
    status: 'Pending',
    appliedDate: '2026-05-15',
    location: 'Manila, NCR',
    matchSummary:
      'Partial alignment with notable gaps in core frontend stack requirements for this opening.',
    strengthNote: 'Has JavaScript fundamentals that could support growth for junior pipelines.',
    gapNote: 'Missing React, CSS, Git, and system design knowledge for this senior role.',
    recommendation: 'Proceed only if pipeline is limited and role requirements are adjusted.',
    messageRequestState: 'none',
    messages: [],
  },
  {
    id: 'CDT-006',
    fullName: 'Paolo Reyes',
    role: 'Senior Frontend Engineer',
    jobId: 'job-2',
    matchPercent: 90,
    matchedSkills: ['React', 'JavaScript', 'Git'],
    missingSkills: ['System Design', 'Advanced CSS'],
    status: 'Interviewing',
    appliedDate: '2026-05-24',
    location: 'Mandaluyong, NCR',
    matchSummary:
      'High-potential profile. Good practical engineering fit with one architectural depth gap.',
    strengthNote: 'Strong role-aligned coding stack with production-ready project experience.',
    gapNote: 'System design depth requires deeper interviewer validation.',
    recommendation: 'Interview already initiated; await response to messaging request.',
    messageRequestState: 'pending',
    messages: [],
  },
  {
    id: 'CDT-007',
    fullName: 'Hana Ibanez',
    role: 'Junior Data Analyst',
    jobId: 'job-1',
    matchPercent: 97,
    matchedSkills: ['SQL', 'Excel', 'Data Cleaning', 'Power BI'],
    missingSkills: [],
    status: 'Hired',
    appliedDate: '2026-05-07',
    location: 'Quezon City, NCR',
    matchSummary: 'Strong end-to-end role fit with complete required-skill coverage. Candidate hired.',
    strengthNote: 'All required role competencies are validated with strong interview outcomes.',
    gapNote: 'No critical skill gaps noted for this role.',
    recommendation: 'Candidate accepted and moved to hired status.',
    messageRequestState: 'accepted',
    messages: [
      {
        from: 'employer',
        text: 'Congratulations, we are happy to move forward with your offer package.',
        time: 'May 20, 2026 · 11:15 AM',
      },
      {
        from: 'candidate',
        text: 'Thank you very much. I’m excited to join the team.',
        time: 'May 20, 2026 · 11:34 AM',
      },
    ],
  },
  {
    id: 'CDT-008',
    fullName: 'Rafael Mendoza',
    role: 'Senior Frontend Engineer',
    jobId: 'job-2',
    matchPercent: 68,
    matchedSkills: ['JavaScript'],
    missingSkills: ['React', 'CSS', 'Git', 'System Design'],
    status: 'Rejected',
    appliedDate: '2026-05-08',
    location: 'Manila, NCR',
    matchSummary: 'Application closed after review due to major role-skill gaps for this opening.',
    strengthNote: 'Has foundational JavaScript knowledge.',
    gapNote: 'Multiple required role skills remain missing for the target level.',
    recommendation: 'Final status set to Rejected for this job requisition.',
    messageRequestState: 'none',
    messages: [],
  },
];

const initialNotifications: NotificationItem[] = [
  {
    id: 'notif-1',
    type: 'match',
    title: 'New Top Match - 95% fit',
    message: 'Candidate CDT-001 applied for Junior Data Analyst.',
    time: '2 hours ago',
    unread: true,
  },
  {
    id: 'notif-2',
    type: 'app',
    title: '3 new applications received',
    message: 'Senior Frontend Engineer now has 27 total applicants.',
    time: '4 hours ago',
    unread: true,
  },
  {
    id: 'notif-3',
    type: 'msg',
    title: 'Message request accepted',
    message: 'CDT-001 accepted your interview message request.',
    time: '5 hours ago',
    unread: true,
  },
  {
    id: 'notif-4',
    type: 'warn',
    title: 'Application withdrawn',
    message: 'CDT-003 withdrew their application for Data Analyst.',
    time: 'Yesterday',
    unread: true,
  },
  {
    id: 'notif-5',
    type: 'job',
    title: 'Job posting updated',
    message: 'Junior Data Analyst is now Open and accepting applications.',
    time: '2 days ago',
    unread: false,
  },
];

const iconMap: Record<IconName, IconDefinition> = {
  menu: faBars,
  bell: faBell,
  'chevron-down': faChevronDown,
  dashboard: faTableCellsLarge,
  briefcase: faBriefcase,
  users: faUsers,
  messages: faComments,
  building: faBuilding,
  cog: faGear,
  star: faStar,
  layers: faLayerGroup,
  'calendar-check': faCalendarCheck,
  envelope: faEnvelope,
  'times-circle': faCircleXmark,
  clock: faClock,
  bolt: faBolt,
  plus: faPlus,
  search: faMagnifyingGlass,
  edit: faPenToSquare,
  close: faXmark,
  shield: faShieldHalved,
  table: faTable,
  eye: faEye,
  bookmark: faBookmark,
  handshake: faHandshake,
  ban: faBan,
  flag: faFlag,
  'paper-plane': faPaperPlane,
  check: faCheck,
  lock: faLock,
  'map-pin': faLocationDot,
  tag: faTag,
  calendar: faCalendar,
  'arrow-right': faArrowRight,
  info: faCircleInfo,
  'user-tie': faUserTie,
  logout: faRightFromBracket,
};

function UIIcon({ name, className = '' }: { name: IconName; className?: string }) {
  const iconClass = `emp-inline-icon ${className}`.trim();
  return <FontAwesomeIcon className={iconClass} icon={iconMap[name] || faCircle} aria-hidden="true" />;
}

function getInitials(label: string): string {
  const parts = label.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'EM';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
}

function maskedName(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  return parts
    .map((part) => {
      if (part.length <= 1) return part;
      return `${part[0]}${'*'.repeat(Math.max(4, part.length - 1))}`;
    })
    .join(' ');
}

function getStatusBadgeClass(status: CandidateStatus): string {
  if (status === 'Pending') return 'emp-status-badge emp-status-pending';
  if (status === 'Shortlisted') return 'emp-status-badge emp-status-shortlisted';
  if (status === 'Interviewing') return 'emp-status-badge emp-status-interviewing';
  if (status === 'Hired') return 'emp-status-badge emp-status-hired';
  if (status === 'Rejected') return 'emp-status-badge emp-status-rejected';
  return 'emp-status-badge emp-status-withdrawn';
}

function getMatchBucket(score: number): MatchBucket {
  if (score >= 90) return 'top';
  if (score >= 75) return 'good';
  return 'partial';
}

function matchBucketLabel(bucket: MatchBucket): string {
  if (bucket === 'top') return 'Top Match (90%+)';
  if (bucket === 'good') return 'Good Match (75-89%)';
  return 'Partial Match (<75%)';
}

function formatDateLabel(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function todayIso(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function statusToFilter(status: CandidateStatus): CandidateFilter {
  return status.toLowerCase() as CandidateFilter;
}

function shouldRevealIdentity(status: CandidateStatus): boolean {
  return status === 'Interviewing' || status === 'Hired' || status === 'Rejected';
}

function getMatchColor(score: number): string {
  if (score >= 90) return 'var(--green)';
  if (score >= 75) return 'var(--amber)';
  return 'var(--soft)';
}

function statusActionLabel(action: ReviewAction): string {
  if (action === 'shortlisted') return 'Move to Shortlisted';
  if (action === 'interviewing') return 'Move to Interviewing';
  if (action === 'hired') return 'Mark as Hired';
  return 'Reject Application';
}

function statusActionMessage(action: ReviewAction, candidateId: string): string {
  if (action === 'shortlisted') return `Moving ${candidateId} to Shortlisted will mark them as a priority applicant.`;
  if (action === 'interviewing') {
    return 'Moving to Interviewing will unlock full candidate profile details and allow message requests.';
  }
  if (action === 'hired') return 'Marking this application as Hired records a final recruitment outcome.';
  return 'Rejecting this applicant is a final decision and will close this application.';
}

export default function EmployerDashboard({ employer, onHome, onLogin, onSignUp, onLogout }: EmployerDashboardProps) {
  void onLogin;
  void onSignUp;

  if (!employer) {
    return (
      <div className="min-h-screen bg-bg px-6 py-16">
        <div className="mx-auto max-w-lg rounded-xl border border-bdr bg-card p-6 text-center">
          <h2 className="font-display text-2xl font-bold text-dark">Employer Dashboard is for registered employers only</h2>
          <p className="mt-2 text-sm text-soft">Please sign in with an employer account to access recruitment pages.</p>
        </div>
      </div>
    );
  }

  const companyName = employer.company || 'Employer Workspace';
  const companyInitials = getInitials(companyName);
  const contactName = employer.name || 'Employer Manager';
  const [activePage, setActivePage] = useState<EmployerPage>('dashboard');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => (typeof window !== 'undefined' ? window.innerWidth < 900 : false));
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [jobs, setJobs] = useState<EmployerJob[]>(initialJobs);
  const [applications, setApplications] = useState<CandidateApplication[]>(initialApplications);
  const [notifications, setNotifications] = useState<NotificationItem[]>(initialNotifications);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  const [jobSearch, setJobSearch] = useState('');
  const [jobStatusFilter, setJobStatusFilter] = useState<'all' | JobStatus>('all');
  const [selectedJobId, setSelectedJobId] = useState<string>(initialJobs[0]?.id || '');
  const [jobsPanelMode, setJobsPanelMode] = useState<JobsPanelMode>('detail');
  const [jobForm, setJobForm] = useState<JobFormState>(emptyJobForm);
  const [requiredSkillsDraft, setRequiredSkillsDraft] = useState<string[]>([]);
  const [niceSkillsDraft, setNiceSkillsDraft] = useState<string[]>([]);
  const [requiredSkillInput, setRequiredSkillInput] = useState('');
  const [niceSkillInput, setNiceSkillInput] = useState('');
  const [candidateFilter, setCandidateFilter] = useState<CandidateFilter>('all');
  const [candidateJobFilter, setCandidateJobFilter] = useState<string>('');
  const [candidateSearch, setCandidateSearch] = useState('');
  const [candidateView, setCandidateView] = useState<CandidateView>('kanban');
  const [privacyAccordionOpen, setPrivacyAccordionOpen] = useState(false);
  const [hiredSectionOpen, setHiredSectionOpen] = useState(false);
  const [closedSectionOpen, setClosedSectionOpen] = useState(false);
  const [selectedThreadId, setSelectedThreadId] = useState<string>('');
  const [messageSearch, setMessageSearch] = useState('');
  const [messageDraft, setMessageDraft] = useState('');
  const [reviewModalId, setReviewModalId] = useState<string | null>(null);
  const [confirmModal, setConfirmModal] = useState<{ open: boolean; action: ReviewAction | null; candidateId: string | null }>({
    open: false,
    action: null,
    candidateId: null,
  });
  const [deleteProfileModalOpen, setDeleteProfileModalOpen] = useState(false);
  const [accountProfile, setAccountProfile] = useState({
    company: companyName,
    industry: 'Information Technology',
    size: '51-200 employees',
    location: 'Manila, NCR, Philippines',
    website: 'https://techcorp.ph',
    about:
      'TechCorp Inc is a Manila-based IT solutions company specializing in data engineering, analytics, and software development.',
    contactPerson: contactName,
    contactRole: 'HR Manager',
    contactEmail: employer.email,
    contactNumber: '+63 917 456 7890',
  });
  const toastTimerRef = useRef<number | null>(null);

  const unreadCount = useMemo(() => notifications.filter((item) => item.unread).length, [notifications]);

  const allApplicationsCount = applications.length;
  const openJobsCount = jobs.filter((job) => job.status === 'open').length;
  const topMatchesCount = applications.filter((candidate) => candidate.matchPercent >= 90).length;
  const interviewingCount = applications.filter((candidate) => candidate.status === 'Interviewing').length;

  const jobMap = useMemo(() => new Map(jobs.map((job) => [job.id, job])), [jobs]);

  const topAlerts = useMemo(() => {
    const strong = applications
      .filter((candidate) => candidate.matchPercent >= 90 && candidate.status !== 'Withdrawn')
      .slice(0, 3);
    const withdrawn = applications.find((candidate) => candidate.status === 'Withdrawn');
    const rows: Array<{ id: string; type: 'match' | 'warn'; title: string; desc: string; meta: string }> = strong.map((candidate) => ({
      id: `${candidate.id}-alert`,
      type: 'match',
      title: `${candidate.id} - ${candidate.matchPercent}% match for ${candidate.role}`,
      desc: candidate.matchSummary,
      meta: `Applied ${formatDateLabel(candidate.appliedDate)} · Top Match category`,
    }));
    if (withdrawn) {
      rows.push({
        id: `${withdrawn.id}-withdrawn`,
        type: 'warn',
        title: `${withdrawn.id} withdrew their application`,
        desc: `The candidate withdrew from ${withdrawn.role}. This record is now closed and read-only.`,
        meta: `Withdrawn ${formatDateLabel(withdrawn.appliedDate)}`,
      });
    }
    return rows;
  }, [applications]);

  const jobPostingSummary = useMemo(() => {
    return jobs
      .filter((job) => job.status === 'open')
      .map((job) => ({
        ...job,
        applicantCount: applications.filter((candidate) => candidate.jobId === job.id).length,
      }));
  }, [applications, jobs]);

  const filteredJobs = useMemo(() => {
    const query = jobSearch.trim().toLowerCase();
    return jobs.filter((job) => {
      if (jobStatusFilter !== 'all' && job.status !== jobStatusFilter) return false;
      if (!query) return true;
      return `${job.title} ${job.subcategory} ${job.city} ${job.province}`.toLowerCase().includes(query);
    });
  }, [jobSearch, jobStatusFilter, jobs]);

  useEffect(() => {
    if (jobsPanelMode !== 'detail') return;
    if (!selectedJobId || !filteredJobs.some((job) => job.id === selectedJobId)) {
      setSelectedJobId(filteredJobs[0]?.id || '');
    }
  }, [filteredJobs, jobsPanelMode, selectedJobId]);

  const selectedJob = useMemo(() => jobs.find((job) => job.id === selectedJobId) || null, [jobs, selectedJobId]);

  const jobStats = useMemo(() => {
    return new Map(
      jobs.map((job) => {
        const candidates = applications.filter((candidate) => candidate.jobId === job.id);
        const top = candidates.filter((candidate) => candidate.matchPercent >= 90).length;
        const good = candidates.filter(
          (candidate) => candidate.matchPercent >= 75 && candidate.matchPercent < 90,
        ).length;
        const partial = candidates.filter((candidate) => candidate.matchPercent < 75).length;
        return [job.id, { applications: candidates.length, top, good, partial }];
      }),
    );
  }, [applications, jobs]);

  const filteredCandidates = useMemo(() => {
    const query = candidateSearch.trim().toLowerCase();
    return applications.filter((candidate) => {
      if (candidateFilter !== 'all' && statusToFilter(candidate.status) !== candidateFilter) return false;
      if (candidateJobFilter && candidate.jobId !== candidateJobFilter) return false;
      if (!query) return true;
      const searchCorpus = [
        candidate.id,
        candidate.fullName,
        candidate.role,
        candidate.status,
        matchBucketLabel(getMatchBucket(candidate.matchPercent)),
        ...candidate.matchedSkills,
        ...candidate.missingSkills,
      ]
        .join(' ')
        .toLowerCase();
      return searchCorpus.includes(query);
    });
  }, [applications, candidateFilter, candidateJobFilter, candidateSearch]);

  const activeCandidates = useMemo(
    () => filteredCandidates.filter((candidate) => ['Pending', 'Shortlisted', 'Interviewing'].includes(candidate.status)),
    [filteredCandidates],
  );

  const hiredCandidates = useMemo(
    () => filteredCandidates.filter((candidate) => candidate.status === 'Hired'),
    [filteredCandidates],
  );

  const closedCandidates = useMemo(
    () => filteredCandidates.filter((candidate) => candidate.status === 'Rejected' || candidate.status === 'Withdrawn'),
    [filteredCandidates],
  );

  const groupedCandidates = useMemo(() => {
    const top = activeCandidates.filter((candidate) => getMatchBucket(candidate.matchPercent) === 'top');
    const good = activeCandidates.filter((candidate) => getMatchBucket(candidate.matchPercent) === 'good');
    const partial = activeCandidates.filter((candidate) => getMatchBucket(candidate.matchPercent) === 'partial');
    return { top, good, partial };
  }, [activeCandidates]);

  const messageThreads = useMemo(() => {
    return applications.filter(
      (candidate) =>
        (candidate.status === 'Interviewing' || candidate.status === 'Hired') &&
        (candidate.messageRequestState === 'accepted' || candidate.messageRequestState === 'pending'),
    );
  }, [applications]);

  const filteredMessageThreads = useMemo(() => {
    const query = messageSearch.trim().toLowerCase();
    if (!query) return messageThreads;

    return messageThreads.filter((candidate) => {
      const corpus = [
        candidate.id,
        shouldRevealIdentity(candidate.status) ? candidate.fullName : maskedName(candidate.fullName),
        candidate.role,
        candidate.status,
        candidate.messageRequestState === 'accepted' ? 'accepted' : 'request pending',
      ]
        .join(' ')
        .toLowerCase();
      return corpus.includes(query);
    });
  }, [messageSearch, messageThreads]);

  useEffect(() => {
    if (filteredMessageThreads.length === 0) {
      setSelectedThreadId('');
      return;
    }
    if (!selectedThreadId || !filteredMessageThreads.some((candidate) => candidate.id === selectedThreadId)) {
      setSelectedThreadId(filteredMessageThreads[0].id);
    }
  }, [filteredMessageThreads, selectedThreadId]);

  const selectedThreadCandidate = filteredMessageThreads.find((candidate) => candidate.id === selectedThreadId) || null;
  const canSendMessage = selectedThreadCandidate?.messageRequestState === 'accepted';

  const reviewCandidate = applications.find((candidate) => candidate.id === reviewModalId) || null;
  const reviewJob = reviewCandidate ? jobMap.get(reviewCandidate.jobId) || null : null;

  const closePanels = () => {
    setNotifOpen(false);
    setProfileOpen(false);
  };

  const showToast = (message: string, type: ToastType = '') => {
    if (!message) return;
    setToast({ message, type });
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 3600);
  };

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  const markNotificationsRead = () => {
    setNotifications((current) => current.map((item) => ({ ...item, unread: false })));
    showToast('All notifications marked as read.', 'success');
  };

  const goPage = (page: EmployerPage) => {
    setActivePage(page);
    if (typeof window !== 'undefined' && window.innerWidth < 900) {
      setSidebarCollapsed(true);
    }
  };

  const toFormLocation = (job: EmployerJob) => `${job.city}${job.province ? `, ${job.province}` : ''}`;

  const parseFormLocation = (location: string): { city: string; province: string } => {
    const parts = location
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    const city = parts[0] || '';
    const province = parts.slice(1).join(', ') || '';
    return { city, province };
  };

  const startNewJobForm = () => {
    setJobsPanelMode('new');
    setJobForm(emptyJobForm);
    setRequiredSkillsDraft([]);
    setNiceSkillsDraft([]);
    setRequiredSkillInput('');
    setNiceSkillInput('');
  };

  const startEditJobForm = (job: EmployerJob) => {
    setSelectedJobId(job.id);
    setJobsPanelMode('edit');
    setJobForm({
      title: job.title,
      category: job.category,
      subcategory: job.subcategory,
      experienceLevel: job.experienceLevel,
      description: job.description,
      workSetup: job.workSetup,
      location: toFormLocation(job),
      salaryRange: job.salaryRange,
      deadline: job.deadline,
      status: job.status,
    });
    setRequiredSkillsDraft(job.requiredSkills);
    setNiceSkillsDraft(job.niceToHaveSkills);
    setRequiredSkillInput('');
    setNiceSkillInput('');
  };

  const cancelJobPanel = () => {
    setJobsPanelMode('detail');
    if (!selectedJobId && filteredJobs[0]) {
      setSelectedJobId(filteredJobs[0].id);
    }
  };

  const updateJobForm = <K extends keyof JobFormState>(field: K, value: JobFormState[K]) => {
    if (field === 'category') {
      setJobForm((current) => ({ ...current, category: String(value), subcategory: '' }));
      return;
    }
    setJobForm((current) => ({ ...current, [field]: value }));
  };

  const addSkillDraft = (kind: 'required' | 'nice') => {
    const raw = kind === 'required' ? requiredSkillInput : niceSkillInput;
    const value = raw.trim();
    if (!value) return;
    if (kind === 'required') {
      if (requiredSkillsDraft.some((skill) => skill.toLowerCase() === value.toLowerCase())) {
        showToast('Required skill already added.', 'warn');
        return;
      }
      setRequiredSkillsDraft((current) => [...current, value]);
      setRequiredSkillInput('');
      return;
    }
    if (niceSkillsDraft.some((skill) => skill.toLowerCase() === value.toLowerCase())) {
      showToast('Nice-to-have skill already added.', 'warn');
      return;
    }
    setNiceSkillsDraft((current) => [...current, value]);
    setNiceSkillInput('');
  };

  const removeSkillDraft = (kind: 'required' | 'nice', value: string) => {
    if (kind === 'required') {
      setRequiredSkillsDraft((current) => current.filter((skill) => skill !== value));
      return;
    }
    setNiceSkillsDraft((current) => current.filter((skill) => skill !== value));
  };

  const validateJobForm = (): string | null => {
    if (!jobForm.title.trim()) return 'Job Title is required.';
    if (!jobForm.category.trim()) return 'Job Category is required.';
    if (!jobForm.subcategory.trim()) return 'Subcategory is required.';
    if (!jobForm.experienceLevel.trim()) return 'Experience Level is required.';
    if (!jobForm.description.trim()) return 'Job Description is required.';
    if (requiredSkillsDraft.length === 0) return 'Add at least one required skill.';
    if (!jobForm.workSetup.trim()) return 'Work Setup is required.';
    if (!jobForm.location.trim()) return 'Location is required.';
    if (!jobForm.salaryRange.trim()) return 'Salary Range is required.';
    if (!jobForm.deadline.trim()) return 'Application Deadline is required.';
    return null;
  };

  const saveJobForm = (mode: 'draft' | 'post') => {
    const error = validateJobForm();
    if (error) {
      showToast(error, 'warn');
      return;
    }
    const status: JobStatus = mode === 'draft' ? 'draft' : jobForm.status === 'closed' ? 'closed' : 'open';
    const { city, province } = parseFormLocation(jobForm.location);
    if (jobsPanelMode === 'edit' && selectedJobId) {
      setJobs((current) =>
        current.map((job) =>
          job.id === selectedJobId
            ? {
                ...job,
                title: jobForm.title.trim(),
                category: jobForm.category,
                subcategory: jobForm.subcategory,
                experienceLevel: jobForm.experienceLevel,
                description: jobForm.description.trim(),
                requiredSkills: requiredSkillsDraft,
                niceToHaveSkills: niceSkillsDraft,
                workSetup: jobForm.workSetup,
                city: city || job.city,
                province: province || job.province,
                salaryRange: jobForm.salaryRange.trim(),
                deadline: jobForm.deadline,
                status,
              }
            : job,
        ),
      );
      showToast(mode === 'draft' ? 'Job draft saved.' : 'Job posting updated.', 'success');
    } else {
      const newJob: EmployerJob = {
        id: `job-${Date.now()}`,
        title: jobForm.title.trim(),
        category: jobForm.category,
        subcategory: jobForm.subcategory,
        experienceLevel: jobForm.experienceLevel,
        description: jobForm.description.trim(),
        requiredSkills: requiredSkillsDraft,
        niceToHaveSkills: niceSkillsDraft,
        workSetup: jobForm.workSetup,
        city,
        province,
        salaryRange: jobForm.salaryRange.trim(),
        deadline: jobForm.deadline,
        status,
        postedDate: todayIso(),
      };
      setJobs((current) => [newJob, ...current]);
      setSelectedJobId(newJob.id);
      showToast(mode === 'draft' ? 'Job saved as draft.' : 'Job posted successfully.', 'success');
    }
    setJobsPanelMode('detail');
  };

  const closeJobPosting = (jobId: string) => {
    setJobs((current) => current.map((job) => (job.id === jobId ? { ...job, status: 'closed' } : job)));
    showToast('Job closed.', 'warn');
  };

  const openReview = (candidateId: string) => {
    setReviewModalId(candidateId);
  };

  const closeReview = () => {
    setReviewModalId(null);
  };

  const openConfirmStatus = (action: ReviewAction, candidateId: string) => {
    setConfirmModal({ open: true, action, candidateId });
  };

  const closeConfirm = () => {
    setConfirmModal({ open: false, action: null, candidateId: null });
  };

  const applyStatusChange = () => {
    if (!confirmModal.action || !confirmModal.candidateId) return;
    const nextStatus: CandidateStatus =
      confirmModal.action === 'shortlisted'
        ? 'Shortlisted'
        : confirmModal.action === 'interviewing'
          ? 'Interviewing'
          : confirmModal.action === 'hired'
            ? 'Hired'
            : 'Rejected';
    setApplications((current) =>
      current.map((candidate) =>
        candidate.id === confirmModal.candidateId && !['Hired', 'Rejected', 'Withdrawn'].includes(candidate.status)
          ? {
              ...candidate,
              status: nextStatus,
            }
          : candidate,
      ),
    );
    if (nextStatus === 'Interviewing') {
      showToast(`${confirmModal.candidateId} moved to Interviewing. Message requests are now available.`, 'success');
    } else {
      showToast(`${confirmModal.candidateId} moved to ${nextStatus}.`, 'success');
    }
    closeConfirm();
    closeReview();
  };

  const sendMessageRequest = (candidateId: string) => {
    let changed = false;
    setApplications((current) =>
      current.map((candidate) => {
        if (candidate.id !== candidateId) return candidate;
        if (candidate.status !== 'Interviewing') return candidate;
        if (candidate.messageRequestState !== 'none') return candidate;
        changed = true;
        return { ...candidate, messageRequestState: 'pending' };
      }),
    );
    if (!changed) {
      showToast('Message request is not available for this applicant.', 'warn');
      return;
    }
    setNotifications((current) => [
      {
        id: `notif-${Date.now()}`,
        type: 'msg',
        title: 'Message request sent',
        message: `${candidateId} message request is now pending candidate acceptance.`,
        time: 'Just now',
        unread: true,
      },
      ...current,
    ]);
    showToast(`Message request sent to ${candidateId}.`, 'success');
    goPage('messages');
    setSelectedThreadId(candidateId);
    closeReview();
  };

  const selectThreadFromCandidates = (candidateId: string) => {
    const threadExists = messageThreads.some((candidate) => candidate.id === candidateId);
    goPage('messages');
    if (threadExists) {
      setSelectedThreadId(candidateId);
      return;
    }
    showToast('No active message thread for this candidate yet.', 'warn');
  };

  const sendMessage = () => {
    if (!selectedThreadCandidate || selectedThreadCandidate.messageRequestState !== 'accepted') return;
    const text = messageDraft.trim();
    if (!text) return;
    const entry: MessageEntry = { from: 'employer', text, time: 'Just now' };
    setApplications((current) =>
      current.map((candidate) =>
        candidate.id === selectedThreadCandidate.id ? { ...candidate, messages: [...candidate.messages, entry] } : candidate,
      ),
    );
    setMessageDraft('');
    showToast('Message sent.', 'success');
  };

  const requestDeleteEmployerProfile = () => {
    setDeleteProfileModalOpen(false);
    showToast('Profile deletion request submitted. A confirmation email will be sent.', 'success');
  };

  const handleLogout = () => {
    setNotifOpen(false);
    setProfileOpen(false);
    setReviewModalId(null);
    setConfirmModal({ open: false, action: null, candidateId: null });
    if (onLogout) {
      onLogout();
      return;
    }
    onHome();
  };

  const filteredJobsForRole = useMemo(() => jobs.filter((job) => job.status !== 'closed'), [jobs]);
  const selectedJobStats = selectedJob ? jobStats.get(selectedJob.id) || { applications: 0, top: 0, good: 0, partial: 0 } : null;

  return (
    <div className="emp-dashboard">
      <header className="emp-topbar">
        <div className="emp-topbar-left">
          <button className="emp-menu-toggle" type="button" onClick={() => setSidebarCollapsed((value) => !value)}>
            <UIIcon name="menu" className="emp-icon-lg" />
          </button>
          <div className="emp-logo-wrap">
            <Logo size="module" onClick={() => goPage('dashboard')} />
            <span className="emp-logo-suffix">Employer</span>
          </div>
        </div>
        <div className="emp-topbar-right">
          <div className="emp-greeting">
            Good day, <strong>{companyName}</strong>
          </div>
          <div className="emp-notif-wrap">
            <button
              className="emp-notif-btn"
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setNotifOpen((value) => !value);
                setProfileOpen(false);
              }}
            >
              <UIIcon name="bell" className="emp-icon-lg" />
              {unreadCount > 0 && <span className="emp-notif-badge">{unreadCount}</span>}
            </button>
            {notifOpen && (
              <div className="emp-notif-dropdown" onClick={(event) => event.stopPropagation()}>
                <div className="emp-notif-header">
                  <strong>Notifications</strong>
                  <button className="emp-notif-mark" type="button" onClick={markNotificationsRead}>
                    Mark all read
                  </button>
                </div>
                {notifications.map((item) => (
                  <div key={item.id} className={`emp-notif-item ${item.unread ? 'unread' : ''}`}>
                    <div className={`emp-notif-icon ${item.type}`}>
                      <UIIcon
                        name={
                          item.type === 'match'
                            ? 'star'
                            : item.type === 'app'
                              ? 'layers'
                              : item.type === 'msg'
                                ? 'envelope'
                                : item.type === 'warn'
                                  ? 'times-circle'
                                  : 'briefcase'
                        }
                      />
                    </div>
                    <div>
                      <div className="emp-notif-text">
                        <strong>{item.title}</strong>
                        {item.message}
                      </div>
                      <div className="emp-notif-time">{item.time}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="emp-profile-wrap">
            <button
              className="emp-profile-trigger"
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setProfileOpen((value) => !value);
                setNotifOpen(false);
              }}
            >
              <div className="emp-avatar">{companyInitials}</div>
              <UIIcon name="chevron-down" className="emp-icon-sm text-soft" />
            </button>
            {profileOpen && (
              <div className="emp-profile-dropdown" onClick={(event) => event.stopPropagation()}>
                <div className="emp-profile-header">
                  <div className="text-[13px] font-bold text-dark">{companyName}</div>
                  <div className="text-[11px] text-soft">{employer.email}</div>
                </div>
                <button
                  className="emp-profile-item"
                  type="button"
                  onClick={() => {
                    goPage('account');
                    setProfileOpen(false);
                  }}
                >
                  <UIIcon name="building" />
                  Account Settings
                </button>
                <hr className="emp-divider" />
                <button
                  className="emp-profile-item danger"
                  type="button"
                  onClick={() => {
                    setProfileOpen(false);
                    handleLogout();
                  }}
                >
                  <UIIcon name="logout" />
                  Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className={`emp-main ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`} onClick={closePanels}>
        <aside className={`emp-sidebar ${sidebarCollapsed ? 'collapsed' : ''}`} onClick={(event) => event.stopPropagation()}>
          <div className="emp-sidebar-inner">
            <div className="emp-sidebar-title">Recruitment</div>
            <SidebarItem icon="dashboard" active={activePage === 'dashboard'} onClick={() => goPage('dashboard')}>
              Dashboard
            </SidebarItem>
            <SidebarItem icon="briefcase" active={activePage === 'jobs'} onClick={() => goPage('jobs')}>
              Manage Jobs
            </SidebarItem>
            <SidebarItem icon="users" active={activePage === 'candidates'} onClick={() => goPage('candidates')}>
              Candidates
            </SidebarItem>
            <button className={`emp-nav-item ${activePage === 'messages' ? 'active' : ''}`} type="button" onClick={() => goPage('messages')}>
              <UIIcon name="messages" />
              Messages
              {messageThreads.length > 0 && <span className="emp-nav-badge">{messageThreads.length}</span>}
            </button>
            <div className="emp-sidebar-title">Settings</div>
            <SidebarItem icon="building" active={activePage === 'account'} onClick={() => goPage('account')}>
              Account Settings
            </SidebarItem>
          </div>
          <div className="emp-sidebar-bottom">
            <button className="emp-profile-card" type="button" onClick={() => goPage('account')}>
              <div className="emp-profile-card-avatar">{companyInitials}</div>
              <div>
                <div className="text-[13px] font-bold text-dark">{companyName}</div>
                <div className="text-[11px] text-soft">
                  <UIIcon name="map-pin" className="emp-icon-sm mr-1" />
                  {accountProfile.location}
                </div>
              </div>
              <UIIcon name="cog" className="ml-auto text-soft" />
            </button>
          </div>
        </aside>

        <main className={`emp-content ${sidebarCollapsed ? 'expanded' : ''}`}>
          {activePage === 'dashboard' && (
            <div>
              <div className="emp-page-header">
                <h1 className="emp-page-title">Recruitment Overview</h1>
                <p className="emp-page-subtitle">Your hiring activity, top matches, and pending actions</p>
              </div>

              <div className="emp-metrics-grid">
                <MetricCard icon="layers" iconClass="rust" number={allApplicationsCount} label="Total Applications" numberClass="rust" />
                <MetricCard icon="briefcase" iconClass="forest" number={openJobsCount} label="Open Jobs" numberClass="forest" />
                <MetricCard icon="star" iconClass="green" number={topMatchesCount} label="Top Matches (90%+)" numberClass="green" />
                <MetricCard icon="calendar-check" iconClass="mauve" number={interviewingCount} label="Interviewing" numberClass="mauve" />
              </div>

              <div className="emp-dashboard-grid">
                <div>
                  <div className="emp-section-box">
                    <h2 className="emp-section-title">
                      <UIIcon name="star" /> New Top Match Alerts
                    </h2>
                    {topAlerts.length > 0 ? (
                      <>
                        {topAlerts.map((alert) => (
                          <div key={alert.id} className="emp-alert-item">
                            <div className={`emp-alert-icon ${alert.type === 'warn' ? 'warn' : 'match'}`}>
                              <UIIcon name={alert.type === 'warn' ? 'times-circle' : 'star'} />
                            </div>
                            <div>
                              <div className="emp-alert-title">{alert.title}</div>
                              <div className="emp-alert-desc">{alert.desc}</div>
                              <div className="emp-alert-meta">{alert.meta}</div>
                            </div>
                          </div>
                        ))}
                        <button className="emp-btn-secondary w-full justify-center" type="button" onClick={() => goPage('candidates')}>
                          Review All Applicants <UIIcon name="arrow-right" />
                        </button>
                      </>
                    ) : (
                      <div className="emp-empty">No top match alerts available.</div>
                    )}
                  </div>
                </div>
                <div>
                  <div className="emp-section-box">
                    <h2 className="emp-section-title">
                      <UIIcon name="bolt" /> Quick Actions
                    </h2>
                    <div className="grid gap-2">
                      <button
                        className="emp-btn-primary w-full justify-center"
                        type="button"
                        onClick={() => {
                          goPage('jobs');
                          startNewJobForm();
                        }}
                      >
                        <UIIcon name="plus" />
                        Post New Job
                      </button>
                      <button className="emp-btn-secondary w-full justify-center" type="button" onClick={() => goPage('candidates')}>
                        <UIIcon name="users" />
                        Review Applicants
                      </button>
                      <button className="emp-btn-secondary w-full justify-center" type="button" onClick={() => goPage('messages')}>
                        <UIIcon name="messages" />
                        View Messages
                      </button>
                    </div>
                  </div>
                  <div className="emp-section-box">
                    <h2 className="emp-section-title">
                      <UIIcon name="briefcase" /> Job Posting Summary
                    </h2>
                    {jobPostingSummary.length > 0 ? (
                      <>
                        {jobPostingSummary.map((job) => (
                          <div key={job.id} className="flex items-center justify-between border-b border-bdr py-2 last:border-b-0">
                            <div>
                              <div className="text-[13px] font-bold text-dark">{job.title}</div>
                              <div className="text-[11px] text-soft">
                                {applications.filter((candidate) => candidate.jobId === job.id).length} applications · Closes {formatDateLabel(job.deadline)}
                              </div>
                            </div>
                            <span className={`emp-job-status ${job.status}`}>{job.status}</span>
                          </div>
                        ))}
                        <button className="emp-btn-secondary mt-3 w-full justify-center" type="button" onClick={() => goPage('jobs')}>
                          Manage Jobs <UIIcon name="arrow-right" />
                        </button>
                      </>
                    ) : (
                      <div className="emp-empty">No open jobs yet.</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activePage === 'jobs' && (
            <div>
              <div className="emp-page-header">
                <h1 className="emp-page-title">Manage Jobs</h1>
                <p className="emp-page-subtitle">Post, update, and review your job postings in one workspace</p>
              </div>
              <div className="emp-jobs-workspace">
                <div className="emp-jobs-list-panel">
                  <div className="emp-jobs-list-header">
                    <div className="emp-jobs-search">
                      <UIIcon name="search" className="emp-jobs-search-icon" />
                      <input
                        className="emp-input"
                        value={jobSearch}
                        placeholder="Search jobs..."
                        onChange={(event) => setJobSearch(event.target.value)}
                      />
                    </div>
                    <div className="emp-jobs-filter-row">
                      <button className={`emp-jobs-chip ${jobStatusFilter === 'all' ? 'active' : ''}`} type="button" onClick={() => setJobStatusFilter('all')}>
                        All
                      </button>
                      <button className={`emp-jobs-chip ${jobStatusFilter === 'open' ? 'active' : ''}`} type="button" onClick={() => setJobStatusFilter('open')}>
                        Open
                      </button>
                      <button className={`emp-jobs-chip ${jobStatusFilter === 'draft' ? 'active' : ''}`} type="button" onClick={() => setJobStatusFilter('draft')}>
                        Draft
                      </button>
                      <button className={`emp-jobs-chip ${jobStatusFilter === 'closed' ? 'active' : ''}`} type="button" onClick={() => setJobStatusFilter('closed')}>
                        Closed
                      </button>
                    </div>
                  </div>
                  <div className="emp-job-list-body">
                    {filteredJobs.length > 0 ? (
                      filteredJobs.map((job) => {
                        const stats = jobStats.get(job.id) || { applications: 0, top: 0, good: 0, partial: 0 };
                        return (
                          <button
                            key={job.id}
                            className={`emp-job-list-item ${selectedJobId === job.id && jobsPanelMode === 'detail' ? 'active' : ''}`}
                            type="button"
                            onClick={() => {
                              setSelectedJobId(job.id);
                              setJobsPanelMode('detail');
                            }}
                          >
                            <div className="emp-job-list-top">
                              <div className="emp-job-list-title">{job.title}</div>
                              <span className={`emp-job-status ${job.status}`}>{job.status}</span>
                            </div>
                            <div className="emp-job-list-meta">
                              <span>
                                <UIIcon name="map-pin" className="emp-icon-sm" /> {job.city}, {job.province}
                              </span>
                              <span>
                                <UIIcon name="clock" className="emp-icon-sm" /> Closes {formatDateLabel(job.deadline)}
                              </span>
                            </div>
                            <div className="emp-job-list-stats">
                              <span className="emp-job-list-stat">{stats.applications} applicants</span>
                              <span className="emp-job-list-stat top">{stats.top} Top</span>
                              <span className="emp-job-list-stat good">{stats.good} Good</span>
                            </div>
                          </button>
                        );
                      })
                    ) : (
                      <div className="emp-empty">No jobs found for this filter.</div>
                    )}
                    <button className="emp-btn-primary emp-post-job-btn" type="button" onClick={startNewJobForm}>
                      <UIIcon name="plus" />
                      Post New Job
                    </button>
                  </div>
                </div>

                <div className="emp-jobs-detail-panel">
                  {jobsPanelMode === 'detail' && selectedJob && selectedJobStats && (
                    <div>
                      <div className="emp-job-detail-header">
                        <div>
                          <div className="emp-job-detail-title">{selectedJob.title}</div>
                          <div className="emp-job-detail-meta">
                            <UIIcon name="tag" className="emp-icon-sm" /> {selectedJob.subcategory} ·{' '}
                            <UIIcon name="map-pin" className="emp-icon-sm" /> {selectedJob.city}, {selectedJob.province} · {selectedJob.workSetup} ·{' '}
                            <UIIcon name="calendar" className="emp-icon-sm" /> Closes {formatDateLabel(selectedJob.deadline)}
                          </div>
                        </div>
                        <div className="emp-job-detail-actions">
                          <span className={`emp-job-status ${selectedJob.status}`}>{selectedJob.status}</span>
                          <button className="emp-btn-secondary" type="button" onClick={() => startEditJobForm(selectedJob)}>
                            <UIIcon name="edit" />
                            Edit
                          </button>
                          <button
                            className="emp-btn-secondary"
                            type="button"
                            onClick={() => {
                              setCandidateJobFilter(selectedJob.id);
                              goPage('candidates');
                            }}
                          >
                            <UIIcon name="users" />
                            Applicants
                          </button>
                          <button className="emp-btn-secondary" type="button" onClick={() => closeJobPosting(selectedJob.id)}>
                            <UIIcon name="times-circle" />
                            Close
                          </button>
                        </div>
                      </div>

                      <div className="emp-job-detail-section-label">Applicant Summary</div>
                      <div className="emp-job-detail-stats-row">
                        <div className="emp-job-detail-stat">
                          <div className="emp-job-detail-stat-num">{selectedJobStats.applications}</div>
                          <div className="emp-job-detail-stat-label">Total</div>
                        </div>
                        <div className="emp-job-detail-stat">
                          <div className="emp-job-detail-stat-num text-green">{selectedJobStats.top}</div>
                          <div className="emp-job-detail-stat-label">Top 90%+</div>
                        </div>
                        <div className="emp-job-detail-stat">
                          <div className="emp-job-detail-stat-num text-amber">{selectedJobStats.good}</div>
                          <div className="emp-job-detail-stat-label">Good 75-89%</div>
                        </div>
                        <div className="emp-job-detail-stat">
                          <div className="emp-job-detail-stat-num text-soft">{selectedJobStats.partial}</div>
                          <div className="emp-job-detail-stat-label">Partial</div>
                        </div>
                      </div>

                      <div className="emp-job-detail-section-label">Job Description</div>
                      <div className="emp-job-detail-box">{selectedJob.description}</div>

                      <div className="emp-job-detail-section-label">Required Skills</div>
                      <div className="emp-skill-chips">
                        {selectedJob.requiredSkills.map((skill) => (
                          <span key={`${selectedJob.id}-req-${skill}`} className="emp-skill-chip emp-skill-matched">
                            {skill}
                          </span>
                        ))}
                        {selectedJob.niceToHaveSkills.map((skill) => (
                          <span key={`${selectedJob.id}-nice-${skill}`} className="emp-skill-chip emp-skill-missing">
                            {skill}
                          </span>
                        ))}
                      </div>

                      <div className="emp-job-detail-section-label">Salary &amp; Setup</div>
                      <div className="emp-job-detail-meta-row">
                        <span>
                          <UIIcon name="tag" className="emp-icon-sm" /> {selectedJob.salaryRange}
                        </span>
                        <span>
                          <UIIcon name="calendar-check" className="emp-icon-sm" /> {selectedJob.experienceLevel}
                        </span>
                        <span>
                          <UIIcon name="briefcase" className="emp-icon-sm" /> {selectedJob.workSetup}
                        </span>
                      </div>
                    </div>
                  )}

                  {jobsPanelMode === 'detail' && !selectedJob && (
                    <div className="emp-empty">
                      Select a job from the left panel or click <strong>Post New Job</strong>.
                    </div>
                  )}

                  {(jobsPanelMode === 'new' || jobsPanelMode === 'edit') && (
                    <JobEditorPanel
                      editing={jobsPanelMode === 'edit'}
                      form={jobForm}
                      requiredSkills={requiredSkillsDraft}
                      niceSkills={niceSkillsDraft}
                      requiredSkillInput={requiredSkillInput}
                      niceSkillInput={niceSkillInput}
                      onCancel={cancelJobPanel}
                      onUpdateForm={updateJobForm}
                      onRequiredInput={setRequiredSkillInput}
                      onNiceInput={setNiceSkillInput}
                      onAddRequired={() => addSkillDraft('required')}
                      onAddNice={() => addSkillDraft('nice')}
                      onRemoveRequired={(skill) => removeSkillDraft('required', skill)}
                      onRemoveNice={(skill) => removeSkillDraft('nice', skill)}
                      onSaveDraft={() => saveJobForm('draft')}
                      onPost={() => saveJobForm('post')}
                    />
                  )}
                </div>
              </div>
            </div>
          )}

          {activePage === 'candidates' && (
            <div>
              <div className="emp-candidates-header">
                <div>
                  <h1 className="emp-page-title">Candidates</h1>
                  <p className="emp-page-subtitle">Applicants from your job postings only — privacy-aware review</p>
                </div>
                <button className="emp-privacy-pill" type="button" onClick={() => setPrivacyAccordionOpen((value) => !value)}>
                  <UIIcon name="shield" className="emp-icon-sm" />
                  Privacy-aware review
                  <UIIcon name="chevron-down" className={`emp-icon-sm ${privacyAccordionOpen ? 'rotate-180' : ''}`} />
                </button>
              </div>

              {privacyAccordionOpen && (
                <div className="emp-privacy-accordion">
                  <div className="emp-privacy-rule"><UIIcon name="eye" /> Candidate identity is masked during Pending and Shortlisted.</div>
                  <div className="emp-privacy-rule"><UIIcon name="check" /> Full profile details are revealed only at Interviewing, Hired, or Rejected.</div>
                  <div className="emp-privacy-rule"><UIIcon name="times-circle" /> Withdrawn applications remain closed/read-only and cannot be reactivated, rejected, hired, or messaged.</div>
                  <div className="emp-privacy-rule"><UIIcon name="ban" /> Global candidate search and cross-employer profile access are not permitted.</div>
                </div>
              )}

              <div className="emp-candidate-search">
                <UIIcon name="search" className="emp-candidate-search-icon" />
                <input
                  className="emp-input"
                  value={candidateSearch}
                  placeholder="Search candidate ID, role, skills, or match category..."
                  onChange={(event) => setCandidateSearch(event.target.value)}
                />
              </div>

              <div className="emp-candidate-toolbar">
                <div className="emp-cand-tabs">
                  <CandidateFilterTab active={candidateFilter === 'all'} onClick={() => setCandidateFilter('all')}>All</CandidateFilterTab>
                  <CandidateFilterTab active={candidateFilter === 'pending'} onClick={() => setCandidateFilter('pending')}>Pending</CandidateFilterTab>
                  <CandidateFilterTab active={candidateFilter === 'shortlisted'} onClick={() => setCandidateFilter('shortlisted')}>Shortlisted</CandidateFilterTab>
                  <CandidateFilterTab active={candidateFilter === 'interviewing'} onClick={() => setCandidateFilter('interviewing')}>Interviewing</CandidateFilterTab>
                  <CandidateFilterTab active={candidateFilter === 'hired'} onClick={() => setCandidateFilter('hired')}>Hired</CandidateFilterTab>
                  <CandidateFilterTab active={candidateFilter === 'rejected'} onClick={() => setCandidateFilter('rejected')}>Rejected</CandidateFilterTab>
                  <CandidateFilterTab active={candidateFilter === 'withdrawn'} onClick={() => setCandidateFilter('withdrawn')}>Withdrawn</CandidateFilterTab>
                </div>
                <div className="emp-candidate-toolbar-actions">
                  <select className="emp-select" value={candidateJobFilter} onChange={(event) => setCandidateJobFilter(event.target.value)}>
                    <option value="">All Jobs</option>
                    {filteredJobsForRole.map((job) => (
                      <option key={job.id} value={job.id}>
                        {job.title}
                      </option>
                    ))}
                  </select>
                  <div className="emp-view-toggle">
                    <button className={`emp-view-btn ${candidateView === 'kanban' ? 'active' : ''}`} type="button" onClick={() => setCandidateView('kanban')}>
                      <UIIcon name="layers" className="emp-icon-sm" /> Kanban
                    </button>
                    <button className={`emp-view-btn ${candidateView === 'table' ? 'active' : ''}`} type="button" onClick={() => setCandidateView('table')}>
                      <UIIcon name="table" className="emp-icon-sm" /> Table
                    </button>
                  </div>
                </div>
              </div>

              <div className="emp-candidate-note">
                <UIIcon name="info" className="emp-icon-sm" />
                Match groups are review aids only: Top (90%+), Good (75-89%), Partial (&lt;75%).
              </div>

              {candidateView === 'kanban' ? (
                <>
                  <div className="emp-kanban">
                    <CandidateGroup title="Top Matches (90%+)" type="top" candidates={groupedCandidates.top} onReview={openReview} />
                    <CandidateGroup title="Good Matches (75-89%)" type="good" candidates={groupedCandidates.good} onReview={openReview} />
                    <CandidateGroup title="Partial Matches (<75%)" type="partial" candidates={groupedCandidates.partial} onReview={openReview} />
                  </div>

                  <div className="emp-final-section">
                    <button className="emp-final-header" type="button" onClick={() => setHiredSectionOpen((value) => !value)}>
                      <span><UIIcon name="handshake" /> Hired Applications ({hiredCandidates.length})</span>
                      <UIIcon name="chevron-down" className={hiredSectionOpen ? 'rotate-180' : ''} />
                    </button>
                    {hiredSectionOpen && (
                      <div className="emp-final-body">
                        {hiredCandidates.length > 0 ? (
                          hiredCandidates.map((candidate) => (
                            <FinalCandidateCard key={candidate.id} candidate={candidate} onReview={openReview} />
                          ))
                        ) : (
                          <div className="emp-empty">No hired applications for this filter.</div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="emp-final-section">
                    <button className="emp-final-header" type="button" onClick={() => setClosedSectionOpen((value) => !value)}>
                      <span><UIIcon name="times-circle" /> Closed Applications ({closedCandidates.length})</span>
                      <UIIcon name="chevron-down" className={closedSectionOpen ? 'rotate-180' : ''} />
                    </button>
                    {closedSectionOpen && (
                      <div className="emp-final-body">
                        {closedCandidates.length > 0 ? (
                          closedCandidates.map((candidate) => (
                            <FinalCandidateCard key={candidate.id} candidate={candidate} onReview={openReview} />
                          ))
                        ) : (
                          <div className="emp-empty">No closed applications for this filter.</div>
                        )}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="emp-section-box">
                  <div className="emp-table-wrap">
                    <table className="emp-table">
                      <thead>
                        <tr>
                          <th>Candidate</th>
                          <th>Applied Role</th>
                          <th>Match</th>
                          <th>Category</th>
                          <th>Applied</th>
                          <th>Status</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredCandidates.map((candidate) => {
                          const bucket = getMatchBucket(candidate.matchPercent);
                          const bucketColor = bucket === 'top' ? 'text-green' : bucket === 'good' ? 'text-amber' : 'text-rust';
                          return (
                            <tr key={candidate.id} className={candidate.status === 'Withdrawn' ? 'withdrawn-row' : ''}>
                              <td>
                                <span className={`font-bold ${candidate.status === 'Withdrawn' ? 'text-soft' : 'text-dark'}`}>{candidate.id}</span>
                                <div className="text-[11px] text-soft">
                                  {shouldRevealIdentity(candidate.status) ? candidate.fullName : maskedName(candidate.fullName)}
                                </div>
                              </td>
                              <td>{candidate.role}</td>
                              <td>
                                <span className="font-display font-extrabold" style={{ color: getMatchColor(candidate.matchPercent) }}>
                                  {candidate.matchPercent}%
                                </span>
                              </td>
                              <td>
                                <span className={`text-[11px] font-bold ${bucketColor}`}>{matchBucketLabel(bucket)}</span>
                              </td>
                              <td className="text-[12px] text-soft">{formatDateLabel(candidate.appliedDate)}</td>
                              <td>
                                <span className={getStatusBadgeClass(candidate.status)}>{candidate.status}</span>
                              </td>
                              <td>
                                <button className="emp-review-btn" type="button" onClick={() => openReview(candidate.id)}>
                                  <UIIcon name="eye" className="mr-1" />
                                  {candidate.status === 'Withdrawn' ? 'View' : 'Review'}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                        {filteredCandidates.length === 0 && (
                          <tr>
                            <td colSpan={7}>
                              <div className="emp-empty">No applicants match the selected filters.</div>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {activePage === 'messages' && (
            <div>
              <div className="emp-page-header">
                <h1 className="emp-page-title">Messages</h1>
                <p className="emp-page-subtitle">Interview-stage candidate communications initiated after Interviewing status</p>
              </div>
              <div className="emp-info-notice mb-5">
                <UIIcon name="info" className="mt-[2px]" />
                <span>
                  <strong>Messaging Rule:</strong> Employers may initiate a message request only after moving an applicant to Interviewing. The request remains pending until the candidate accepts. If the candidate declines or ignores, no active thread opens. Messaging is not available for Pending, Shortlisted, Rejected, or Withdrawn applicants.
                </span>
              </div>
              <div className="emp-msg-layout">
                <div className="emp-msg-list">
                  <div className="emp-msg-list-hd">
                    <span>Conversations</span>
                    <span className="emp-msg-list-count">{filteredMessageThreads.length}/{messageThreads.length}</span>
                  </div>
                  <div className="emp-msg-search-wrap">
                    <UIIcon name="search" className="emp-msg-search-icon" />
                    <input
                      className="emp-msg-search"
                      value={messageSearch}
                      onChange={(event) => setMessageSearch(event.target.value)}
                      placeholder="Search candidate or role..."
                    />
                  </div>
                  <div className="emp-msg-list-scroll">
                    {filteredMessageThreads.length > 0 ? (
                      filteredMessageThreads.map((candidate) => (
                        <button
                          key={candidate.id}
                          className={`emp-msg-thread ${selectedThreadId === candidate.id ? 'active' : ''}`}
                          type="button"
                          onClick={() => setSelectedThreadId(candidate.id)}
                        >
                          <div className="emp-msg-thread-co">
                            {candidate.id} · {shouldRevealIdentity(candidate.status) ? candidate.fullName : maskedName(candidate.fullName)}
                          </div>
                          <div className="emp-msg-thread-job">
                            {candidate.role} · <span className={getStatusBadgeClass(candidate.status)}>{candidate.status}</span>
                          </div>
                          <span className={`emp-msg-req ${candidate.messageRequestState}`}>
                            {candidate.messageRequestState === 'accepted' ? 'Accepted' : 'Request Pending'}
                          </span>
                        </button>
                      ))
                    ) : (
                      <div className="p-4 text-sm text-soft">
                        {messageThreads.length > 0 ? 'No conversations match your search.' : 'No active message threads yet.'}
                      </div>
                    )}
                  </div>
                </div>
                <div className="emp-msg-panel">
                  {selectedThreadCandidate ? (
                    <>
                      <div className="emp-msg-panel-hd">
                        <div>
                          <h4 className="text-sm font-bold text-dark">
                            {selectedThreadCandidate.id} — {selectedThreadCandidate.role}
                          </h4>
                          <p className="text-xs text-soft">
                            {selectedThreadCandidate.status} · {selectedThreadCandidate.matchPercent}% match · Message request{' '}
                            {selectedThreadCandidate.messageRequestState === 'accepted' ? 'accepted' : 'pending'}
                          </p>
                        </div>
                        <div className="emp-msg-hd-actions">
                          <button type="button" onClick={() => showToast('Block action recorded.', 'warn')}>
                            <UIIcon name="ban" className="mr-1" />
                            Block
                          </button>
                          <button type="button" onClick={() => showToast('Report submitted.', 'warn')}>
                            <UIIcon name="flag" className="mr-1" />
                            Report
                          </button>
                        </div>
                      </div>
                      <div className="emp-msg-body">
                        {selectedThreadCandidate.messageRequestState === 'pending' && (
                          <div className="emp-msg-status-box pending">
                            <div className="mb-1 font-bold">
                              <UIIcon name="clock" className="mr-1" />
                              Message Request Pending
                            </div>
                            <div className="text-xs">
                              Your message request was sent and is awaiting candidate acceptance. No active thread opens until acceptance.
                            </div>
                          </div>
                        )}
                        {selectedThreadCandidate.messageRequestState === 'accepted' && (
                          <>
                            <div className="emp-msg-status-box accepted">
                              <div className="mb-1 font-bold">
                                <UIIcon name="check" className="mr-1" />
                                Request Accepted
                              </div>
                              <div className="text-xs">Candidate accepted your request. You can now continue the conversation.</div>
                            </div>
                            {selectedThreadCandidate.messages.map((entry, index) => (
                              <div key={`${selectedThreadCandidate.id}-${index}`} className="flex flex-col">
                                <div className={`emp-msg-bubble-sender ${entry.from === 'employer' ? 'text-right' : ''}`}>
                                  {entry.from === 'employer' ? `${companyName} HR (You)` : selectedThreadCandidate.id}
                                </div>
                                <div className={entry.from === 'employer' ? 'emp-msg-bubble-employer' : 'emp-msg-bubble-candidate'}>
                                  {entry.text}
                                </div>
                                <div className={`emp-msg-bubble-time ${entry.from === 'employer' ? 'text-right' : ''}`}>{entry.time}</div>
                              </div>
                            ))}
                          </>
                        )}
                      </div>
                      <div className="emp-msg-composer">
                        <textarea
                          className="emp-msg-input"
                          value={messageDraft}
                          rows={1}
                          placeholder={
                            canSendMessage
                              ? 'Type your message...'
                              : 'Waiting for candidate acceptance. Composer is disabled.'
                          }
                          disabled={!canSendMessage}
                          onChange={(event) => setMessageDraft(event.target.value)}
                        />
                        <button className="emp-msg-send" type="button" disabled={!canSendMessage} onClick={sendMessage}>
                          <UIIcon name="paper-plane" />
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="emp-empty m-4">No message threads available.</div>
                  )}
                </div>
              </div>
            </div>
          )}

          {activePage === 'account' && (
            <div>
              <div className="emp-page-header">
                <h1 className="emp-page-title">Account Settings</h1>
                <p className="emp-page-subtitle">Manage your company profile, contact details, and account security</p>
              </div>

              <div className="emp-acct-grid">
                <div className="emp-acct-section">
                  <div className="emp-acct-title">
                    <UIIcon name="building" />
                    Company Profile
                  </div>
                  <div className="emp-form-group mb-4">
                    <label className="emp-form-label">Company / Employer Name</label>
                    <input
                      className="emp-input"
                      value={accountProfile.company}
                      onChange={(event) => setAccountProfile((current) => ({ ...current, company: event.target.value }))}
                    />
                  </div>
                  <div className="emp-form-group mb-4">
                    <label className="emp-form-label">Industry</label>
                    <select
                      className="emp-select"
                      value={accountProfile.industry}
                      onChange={(event) => setAccountProfile((current) => ({ ...current, industry: event.target.value }))}
                    >
                      <option>Information Technology</option>
                      <option>Data &amp; Analytics</option>
                      <option>Finance &amp; Banking</option>
                      <option>BPO &amp; Outsourcing</option>
                      <option>Government &amp; Public Sector</option>
                    </select>
                  </div>
                  <div className="emp-form-group mb-4">
                    <label className="emp-form-label">Company Size</label>
                    <select
                      className="emp-select"
                      value={accountProfile.size}
                      onChange={(event) => setAccountProfile((current) => ({ ...current, size: event.target.value }))}
                    >
                      <option>1-10 employees</option>
                      <option>11-50 employees</option>
                      <option>51-200 employees</option>
                      <option>201-500 employees</option>
                      <option>500+ employees</option>
                    </select>
                  </div>
                  <div className="emp-form-group mb-4">
                    <label className="emp-form-label">Company Location</label>
                    <input
                      className="emp-input"
                      value={accountProfile.location}
                      onChange={(event) => setAccountProfile((current) => ({ ...current, location: event.target.value }))}
                    />
                  </div>
                  <div className="emp-form-group mb-4">
                    <label className="emp-form-label">Company Website (Optional)</label>
                    <input
                      className="emp-input"
                      value={accountProfile.website}
                      onChange={(event) => setAccountProfile((current) => ({ ...current, website: event.target.value }))}
                    />
                  </div>
                  <div className="emp-form-group mb-4">
                    <label className="emp-form-label">About the Company</label>
                    <textarea
                      className="emp-textarea"
                      style={{ minHeight: 90 }}
                      value={accountProfile.about}
                      onChange={(event) => setAccountProfile((current) => ({ ...current, about: event.target.value }))}
                    />
                  </div>
                  <button className="emp-btn-primary" type="button" onClick={() => showToast('Company profile saved.', 'success')}>
                    <UIIcon name="check" />
                    Save Profile
                  </button>
                </div>

                <div>
                  <div className="emp-acct-section">
                    <div className="emp-acct-title">
                      <UIIcon name="user-tie" />
                      Contact Person
                    </div>
                    <div className="emp-form-group mb-4">
                      <label className="emp-form-label">Contact Person Name</label>
                      <input
                        className="emp-input"
                        value={accountProfile.contactPerson}
                        onChange={(event) => setAccountProfile((current) => ({ ...current, contactPerson: event.target.value }))}
                      />
                    </div>
                    <div className="emp-form-group mb-4">
                      <label className="emp-form-label">Position / Role</label>
                      <input
                        className="emp-input"
                        value={accountProfile.contactRole}
                        onChange={(event) => setAccountProfile((current) => ({ ...current, contactRole: event.target.value }))}
                      />
                    </div>
                    <div className="emp-form-group mb-4">
                      <label className="emp-form-label">Email Address</label>
                      <input
                        className="emp-input"
                        type="email"
                        value={accountProfile.contactEmail}
                        onChange={(event) => setAccountProfile((current) => ({ ...current, contactEmail: event.target.value }))}
                      />
                    </div>
                    <div className="emp-form-group mb-4">
                      <label className="emp-form-label">Contact Number</label>
                      <input
                        className="emp-input"
                        value={accountProfile.contactNumber}
                        onChange={(event) => setAccountProfile((current) => ({ ...current, contactNumber: event.target.value }))}
                      />
                    </div>
                    <button className="emp-btn-primary" type="button" onClick={() => showToast('Contact details saved.', 'success')}>
                      <UIIcon name="check" />
                      Save Contact
                    </button>
                  </div>

                  <div className="emp-acct-section">
                    <div className="emp-acct-title">
                      <UIIcon name="lock" />
                      Password &amp; Security
                    </div>
                    <div className="emp-form-group mb-4">
                      <label className="emp-form-label">Current Password</label>
                      <input className="emp-input" type="password" placeholder="Enter current password" />
                    </div>
                    <div className="emp-form-group mb-4">
                      <label className="emp-form-label">New Password</label>
                      <input className="emp-input" type="password" placeholder="Enter new password" />
                    </div>
                    <div className="emp-form-group mb-4">
                      <label className="emp-form-label">Confirm New Password</label>
                      <input className="emp-input" type="password" placeholder="Confirm new password" />
                    </div>
                    <button className="emp-btn-primary" type="button" onClick={() => showToast('Password updated.', 'success')}>
                      <UIIcon name="check" />
                      Update Password
                    </button>
                  </div>
                </div>
              </div>

              <div className="emp-section-box">
                <div className="emp-acct-title !mb-3">
                  <UIIcon name="shield" />
                  Privacy &amp; Access Control
                </div>
                <p className="mb-3 text-sm text-mid">
                  Your employer account operates within Kareerly role-based access controls. The following boundaries apply:
                </p>
                <div className="grid gap-2 text-sm text-mid">
                  <div className="flex gap-2">
                    <UIIcon name="check" className="mt-[3px] text-green" />
                    <span>You may view only applicants to your own job postings.</span>
                  </div>
                  <div className="flex gap-2">
                    <UIIcon name="times-circle" className="mt-[3px] text-red" />
                    <span>No global candidate search, browsing, or cross-employer profile access.</span>
                  </div>
                  <div className="flex gap-2">
                    <UIIcon name="times-circle" className="mt-[3px] text-red" />
                    <span>Withdrawn applicants are closed/read-only and cannot be reactivated or messaged.</span>
                  </div>
                  <div className="flex gap-2">
                    <UIIcon name="check" className="mt-[3px] text-green" />
                    <span>Early applicant review uses data masking until Interviewing stage.</span>
                  </div>
                  <div className="flex gap-2">
                    <UIIcon name="check" className="mt-[3px] text-green" />
                    <span>Messaging is available only after Interviewing and candidate acceptance.</span>
                  </div>
                </div>
                <p className="mt-3 text-xs italic text-soft">
                  This prototype does not independently verify employer identity or organization legitimacy.
                </p>
              </div>

              <div className="emp-section-box emp-delete-box">
                <div className="emp-acct-title !mb-3 text-red">
                  <UIIcon name="times-circle" />
                  Delete Employer Profile
                </div>
                <p className="mb-3 text-sm text-mid">
                  Requesting profile deletion removes your employer account and related records where applicable, including job postings, applicant records, and message history.
                </p>
                <button className="emp-btn-danger" type="button" onClick={() => setDeleteProfileModalOpen(true)}>
                  <UIIcon name="times-circle" />
                  Request Employer Profile Deletion
                </button>
              </div>
            </div>
          )}
        </main>
      </div>

      {reviewCandidate && (
        <ApplicantReviewModal
          candidate={reviewCandidate}
          job={reviewJob}
          onClose={closeReview}
          onAction={openConfirmStatus}
          onSendRequest={sendMessageRequest}
          onOpenMessages={selectThreadFromCandidates}
        />
      )}

      {confirmModal.open && confirmModal.action && confirmModal.candidateId && (
        <ConfirmActionModal
          title={`${statusActionLabel(confirmModal.action)}?`}
          description={statusActionMessage(confirmModal.action, confirmModal.candidateId)}
          onCancel={closeConfirm}
          onConfirm={applyStatusChange}
        />
      )}

      {deleteProfileModalOpen && (
        <DeleteProfileModal
          onCancel={() => setDeleteProfileModalOpen(false)}
          onConfirm={requestDeleteEmployerProfile}
        />
      )}

      {toast && <div className={`emp-toast ${toast.type}`}>{toast.message}</div>}
    </div>
  );
}

function SidebarItem({
  icon,
  active,
  onClick,
  children,
}: {
  icon: IconName;
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button className={`emp-nav-item ${active ? 'active' : ''}`} type="button" onClick={onClick}>
      <UIIcon name={icon} />
      {children}
    </button>
  );
}

function MetricCard({
  icon,
  iconClass,
  number,
  label,
  numberClass,
}: {
  icon: IconName;
  iconClass: string;
  number: number;
  label: string;
  numberClass: string;
}) {
  return (
    <div className="emp-metric-card">
      <div className={`emp-metric-icon ${iconClass}`}>
        <UIIcon name={icon} className="emp-icon-lg" />
      </div>
      <div className={`emp-metric-number ${numberClass}`}>{number}</div>
      <div className="emp-metric-label">{label}</div>
    </div>
  );
}

function CandidateFilterTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button className={`emp-cand-tab ${active ? 'active' : ''}`} type="button" onClick={onClick}>
      {children}
    </button>
  );
}

function CandidateGroup({
  title,
  type,
  candidates,
  onReview,
}: {
  title: string;
  type: MatchBucket;
  candidates: CandidateApplication[];
  onReview: (candidateId: string) => void;
}) {
  return (
    <div className="emp-kanban-col">
      <div className={`emp-kanban-header ${type}`}>
        <UIIcon name={type === 'top' ? 'star' : type === 'good' ? 'check' : 'times-circle'} />
        {title}
        <span className="emp-kanban-count">{candidates.length}</span>
      </div>
      <div className="emp-kanban-content">
        {candidates.length > 0 ? (
          candidates.map((candidate) => {
            return (
              <div key={candidate.id} className={`emp-app-card ${candidate.status === 'Withdrawn' ? 'withdrawn' : ''}`}>
                <div className="emp-app-head">
                  <div className="emp-app-avatar">{getInitials(candidate.fullName)}</div>
                  <div>
                    <div className="emp-app-name">
                      {shouldRevealIdentity(candidate.status) ? candidate.fullName : maskedName(candidate.fullName)}
                    </div>
                    <div className="emp-app-id">{candidate.id}</div>
                  </div>
                </div>
                <div className="emp-app-match-row">
                  <div className="emp-app-match" style={{ color: getMatchColor(candidate.matchPercent) }}>
                    {candidate.matchPercent}%
                  </div>
                  <div className="emp-app-role">{candidate.role}</div>
                </div>
                <div>
                  <span className="emp-skill-label">Matched Skills</span>
                  <div className="emp-skill-chips">
                    {candidate.matchedSkills.slice(0, 4).map((skill) => (
                      <span key={`${candidate.id}-match-${skill}`} className="emp-skill-chip emp-skill-matched">
                        {skill}
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <span className="emp-skill-label">Missing Skills</span>
                  <div className="emp-skill-chips">
                    {candidate.missingSkills.slice(0, 4).map((skill) => (
                      <span key={`${candidate.id}-gap-${skill}`} className="emp-skill-chip emp-skill-missing">
                        {skill}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="emp-app-foot">
                  <span className={getStatusBadgeClass(candidate.status)}>{candidate.status}</span>
                  <button className="emp-link-action" type="button" onClick={() => onReview(candidate.id)}>
                    {candidate.status === 'Withdrawn' ? 'View' : 'Review'}
                  </button>
                </div>
              </div>
            );
          })
        ) : (
          <div className="emp-empty">No candidates in this group.</div>
        )}
      </div>
    </div>
  );
}

function FinalCandidateCard({
  candidate,
  onReview,
}: {
  candidate: CandidateApplication;
  onReview: (candidateId: string) => void;
}) {
  return (
    <div className={`emp-final-card ${candidate.status === 'Withdrawn' ? 'withdrawn' : ''}`}>
      <div className="emp-final-card-top">
        <div className="emp-final-avatar">{getInitials(candidate.fullName)}</div>
        <div>
          <div className="emp-final-name">{shouldRevealIdentity(candidate.status) ? candidate.fullName : maskedName(candidate.fullName)}</div>
          <div className="emp-final-role">
            {candidate.id} · {candidate.role}
          </div>
        </div>
      </div>
      <div className="emp-skill-chips">
        {candidate.matchedSkills.slice(0, 3).map((skill) => (
          <span key={`${candidate.id}-final-match-${skill}`} className="emp-skill-chip emp-skill-matched">
            {skill}
          </span>
        ))}
      </div>
      {candidate.status === 'Withdrawn' && <div className="emp-final-note">Withdrawn by candidate. Read-only record.</div>}
      <div className="emp-final-footer">
        <span className={getStatusBadgeClass(candidate.status)}>{candidate.status}</span>
        <button className="emp-link-action" type="button" onClick={() => onReview(candidate.id)}>
          View
        </button>
      </div>
    </div>
  );
}

function ApplicantReviewModal({
  candidate,
  job,
  onClose,
  onAction,
  onSendRequest,
  onOpenMessages,
}: {
  candidate: CandidateApplication;
  job: EmployerJob | null;
  onClose: () => void;
  onAction: (action: ReviewAction, candidateId: string) => void;
  onSendRequest: (candidateId: string) => void;
  onOpenMessages: (candidateId: string) => void;
}) {
  const bucket = getMatchBucket(candidate.matchPercent);
  const bucketLabel = matchBucketLabel(bucket);
  const isFinal = candidate.status === 'Hired' || candidate.status === 'Rejected' || candidate.status === 'Withdrawn';
  const isWithdrawn = candidate.status === 'Withdrawn';
  const revealIdentity = shouldRevealIdentity(candidate.status);

  return (
    <div className="emp-modal-overlay" onClick={onClose}>
      <div className="emp-modal lg" onClick={(event) => event.stopPropagation()}>
        <div className="emp-modal-header">
          <div>
            <div className="emp-modal-title">Applicant Review — {candidate.id}</div>
            <div className="emp-modal-subtitle">
              {candidate.id} · {candidate.role}
            </div>
          </div>
          <button className="emp-modal-close" type="button" onClick={onClose}>
            <UIIcon name="close" />
          </button>
        </div>

        {isWithdrawn && (
          <div className="emp-withdrawn-banner">
            <UIIcon name="times-circle" className="mt-[2px]" />
            <div>
              <strong>Withdrawn by Candidate</strong>
              <br />
              <span className="text-xs">
                This application is closed and read-only. You cannot reactivate, message, or move this record.
              </span>
            </div>
          </div>
        )}

        <div className="emp-review-sec">
          <div
            className="emp-match-band"
            style={{
              background:
                candidate.matchPercent >= 90
                  ? 'var(--green-l)'
                  : candidate.matchPercent >= 75
                    ? 'var(--amber-l)'
                    : 'var(--rust-l)',
              color:
                candidate.matchPercent >= 90
                  ? 'var(--green)'
                  : candidate.matchPercent >= 75
                    ? 'var(--amber)'
                    : 'var(--rust)',
            }}
          >
            <UIIcon name="star" />
            {candidate.matchPercent}% Match
            <span className="text-xs opacity-80">· {bucketLabel}</span>
          </div>

          {!revealIdentity && (
            <div className="emp-masked-notice">
              <UIIcon name="eye" className="mt-[2px]" />
              <span>
                Early applicant review uses <strong>data masking</strong>. Name, age, gender, and direct contact details remain hidden during Pending and Shortlisted stages.
              </span>
            </div>
          )}

          <div className="emp-detail-grid">
            <div>
              <div className="emp-detail-label">Candidate ID</div>
              <div className="emp-detail-value">{candidate.id}</div>
            </div>
            <div>
              <div className="emp-detail-label">Applied Role</div>
              <div className="emp-detail-value">{candidate.role}</div>
            </div>
            <div>
              <div className="emp-detail-label">Match Category</div>
              <div className="emp-detail-value">{bucketLabel}</div>
            </div>
            <div>
              <div className="emp-detail-label">Application Status</div>
              <div className="emp-detail-value">
                <span className={getStatusBadgeClass(candidate.status)}>{candidate.status}</span>
              </div>
            </div>
            {revealIdentity && (
              <>
                <div>
                  <div className="emp-detail-label">Full Name</div>
                  <div className="emp-detail-value">{candidate.fullName}</div>
                </div>
                <div>
                  <div className="emp-detail-label">Location</div>
                  <div className="emp-detail-value">{candidate.location}</div>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="emp-review-sec">
          <div className="emp-review-sec-title">Matched Skills (Required)</div>
          <div className="emp-skill-chips">
            {candidate.matchedSkills.map((skill) => (
              <span key={`${candidate.id}-modal-match-${skill}`} className="emp-skill-chip emp-skill-matched">
                {skill}
              </span>
            ))}
          </div>
        </div>

        <div className="emp-review-sec">
          <div className="emp-review-sec-title">Missing Skills (Required)</div>
          <div className="emp-skill-chips">
            {candidate.missingSkills.map((skill) => (
              <span key={`${candidate.id}-modal-gap-${skill}`} className="emp-skill-chip emp-skill-missing">
                {skill}
              </span>
            ))}
          </div>
        </div>

        <div className="emp-review-sec">
          <div className="emp-review-sec-title">Match Analysis</div>
          <div className="emp-analysis-box strength">
            <div className="emp-analysis-title">
              <UIIcon name="check" />
              Strength
            </div>
            {candidate.strengthNote}
          </div>
          <div className="emp-analysis-box gap">
            <div className="emp-analysis-title">
              <UIIcon name="times-circle" />
              Gap
            </div>
            {candidate.gapNote}
          </div>
          <div className="emp-analysis-box rec">
            <div className="emp-analysis-title">
              <UIIcon name="arrow-right" />
              Recommendation
            </div>
            {candidate.recommendation}
          </div>
          <div className="mt-2 rounded-lg bg-bg p-3 text-sm text-mid">{candidate.matchSummary}</div>
          {job && (
            <div className="mt-2 text-xs text-soft">
              Applied to: <strong className="text-mid">{job.title}</strong> · {job.city}, {job.province}
            </div>
          )}
        </div>

        <div className="emp-review-sec">
          <div className="emp-review-sec-title">Application Status Actions</div>
          <div className="mb-3 text-xs text-soft">
            Final hiring decisions remain the employer’s responsibility. Kareerly provides skill-alignment decision support only.
          </div>

          {isFinal ? (
            <div className="rounded-lg bg-bg p-4 text-center text-sm text-soft">
              <UIIcon name="lock" className="mr-1" />
              This application is in a final state. No further status changes are allowed.
            </div>
          ) : candidate.status === 'Pending' ? (
            <div className="emp-status-actions">
              <button className="emp-status-btn" type="button" onClick={() => onAction('shortlisted', candidate.id)}>
                <UIIcon name="bookmark" />
                Shortlist
              </button>
              <button className="emp-status-btn primary" type="button" onClick={() => onAction('interviewing', candidate.id)}>
                <UIIcon name="calendar-check" />
                Move to Interviewing
              </button>
              <button
                className="emp-status-btn danger"
                style={{ gridColumn: 'span 2' }}
                type="button"
                onClick={() => onAction('rejected', candidate.id)}
              >
                <UIIcon name="times-circle" />
                Reject
              </button>
            </div>
          ) : candidate.status === 'Shortlisted' ? (
            <div className="emp-status-actions">
              <button className="emp-status-btn primary" type="button" onClick={() => onAction('interviewing', candidate.id)}>
                <UIIcon name="calendar-check" />
                Move to Interviewing
              </button>
              <button className="emp-status-btn danger" type="button" onClick={() => onAction('rejected', candidate.id)}>
                <UIIcon name="times-circle" />
                Reject
              </button>
            </div>
          ) : (
            <div className="emp-status-actions">
              <button className="emp-status-btn primary" type="button" onClick={() => onAction('hired', candidate.id)}>
                <UIIcon name="handshake" />
                Mark as Hired
              </button>
              <button className="emp-status-btn danger" type="button" onClick={() => onAction('rejected', candidate.id)}>
                <UIIcon name="times-circle" />
                Reject
              </button>
              {candidate.messageRequestState === 'none' ? (
                <button
                  className="emp-status-btn"
                  style={{ gridColumn: 'span 2' }}
                  type="button"
                  onClick={() => onSendRequest(candidate.id)}
                >
                  <UIIcon name="messages" />
                  Send Message Request
                </button>
              ) : (
                <button
                  className="emp-status-btn"
                  style={{ gridColumn: 'span 2' }}
                  type="button"
                  onClick={() => onOpenMessages(candidate.id)}
                >
                  <UIIcon name="messages" />
                  {candidate.messageRequestState === 'accepted' ? 'Open Messages' : 'View Pending Message Request'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ConfirmActionModal({
  title,
  description,
  onCancel,
  onConfirm,
}: {
  title: string;
  description: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="emp-modal-overlay" onClick={onCancel}>
      <div className="emp-modal sm" onClick={(event) => event.stopPropagation()}>
        <div className="emp-modal-header">
          <div className="emp-modal-title">{title}</div>
          <button className="emp-modal-close" type="button" onClick={onCancel}>
            <UIIcon name="close" />
          </button>
        </div>
        <div className="text-sm text-mid">{description}</div>
        <div className="emp-modal-footer">
          <button className="emp-btn-secondary" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="emp-btn-primary" type="button" onClick={onConfirm}>
            <UIIcon name="check" />
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

function JobEditorPanel({
  editing,
  form,
  requiredSkills,
  niceSkills,
  requiredSkillInput,
  niceSkillInput,
  onCancel,
  onUpdateForm,
  onRequiredInput,
  onNiceInput,
  onAddRequired,
  onAddNice,
  onRemoveRequired,
  onRemoveNice,
  onSaveDraft,
  onPost,
}: {
  editing: boolean;
  form: JobFormState;
  requiredSkills: string[];
  niceSkills: string[];
  requiredSkillInput: string;
  niceSkillInput: string;
  onCancel: () => void;
  onUpdateForm: <K extends keyof JobFormState>(field: K, value: JobFormState[K]) => void;
  onRequiredInput: (value: string) => void;
  onNiceInput: (value: string) => void;
  onAddRequired: () => void;
  onAddNice: () => void;
  onRemoveRequired: (skill: string) => void;
  onRemoveNice: (skill: string) => void;
  onSaveDraft: () => void;
  onPost: () => void;
}) {
  const subcategoryOptions = form.category ? jobSubcategoryMap[form.category] || [] : [];

  return (
    <div className="emp-job-editor">
      <div className="emp-job-editor-header">
        <div>
          <div className="emp-job-editor-title">{editing ? 'Edit Job Posting' : 'Post New Job'}</div>
          <div className="emp-job-editor-subtitle">All required fields are marked with *</div>
        </div>
        <button className="emp-btn-secondary" type="button" onClick={onCancel}>
          <UIIcon name="close" />
          Cancel
        </button>
      </div>

      <div className="emp-form-grid">
        <div className="emp-form-group">
          <label className="emp-form-label required">Job Title</label>
          <input className="emp-input" value={form.title} onChange={(event) => onUpdateForm('title', event.target.value)} placeholder="e.g., Junior Data Analyst" />
        </div>
        <div className="emp-form-group">
          <label className="emp-form-label required">Category</label>
          <select className="emp-select" value={form.category} onChange={(event) => onUpdateForm('category', event.target.value)}>
            <option value="">Select category</option>
            <option value="engineering">Engineering</option>
            <option value="data">Data &amp; Analytics</option>
            <option value="sales">Sales &amp; Marketing</option>
            <option value="operations">Operations</option>
            <option value="design">Design &amp; Creative</option>
          </select>
        </div>
      </div>

      <div className="emp-form-grid">
        <div className="emp-form-group">
          <label className="emp-form-label required">Sub-category</label>
          <select className="emp-select" value={form.subcategory} onChange={(event) => onUpdateForm('subcategory', event.target.value)}>
            <option value="">Select sub-category</option>
            {subcategoryOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
        <div className="emp-form-group">
          <label className="emp-form-label required">Experience Level</label>
          <select className="emp-select" value={form.experienceLevel} onChange={(event) => onUpdateForm('experienceLevel', event.target.value)}>
            <option value="">Select level</option>
            <option value="Entry-level / Fresh Graduate">Entry-level / Fresh Graduate</option>
            <option value="Junior (1-2 yrs)">Junior (1-2 yrs)</option>
            <option value="Mid-level (3-5 yrs)">Mid-level (3-5 yrs)</option>
            <option value="Senior (5+ yrs)">Senior (5+ yrs)</option>
          </select>
        </div>
      </div>

      <div className="emp-form-grid">
        <div className="emp-form-group">
          <label className="emp-form-label required">Work Setup</label>
          <select className="emp-select" value={form.workSetup} onChange={(event) => onUpdateForm('workSetup', event.target.value)}>
            <option value="">Select setup</option>
            <option value="Remote">Remote</option>
            <option value="Hybrid">Hybrid</option>
            <option value="On-site">On-site</option>
          </select>
        </div>
        <div className="emp-form-group">
          <label className="emp-form-label required">Location</label>
          <input className="emp-input" value={form.location} onChange={(event) => onUpdateForm('location', event.target.value)} placeholder="e.g., Makati, NCR" />
        </div>
      </div>

      <div className="emp-form-grid">
        <div className="emp-form-group">
          <label className="emp-form-label required">Salary Range</label>
          <input
            className="emp-input"
            value={form.salaryRange}
            onChange={(event) => onUpdateForm('salaryRange', event.target.value)}
            placeholder="e.g., PHP 25,000 - PHP 40,000"
          />
        </div>
        <div className="emp-form-group">
          <label className="emp-form-label required">Application Deadline</label>
          <input className="emp-input" type="date" value={form.deadline} onChange={(event) => onUpdateForm('deadline', event.target.value)} />
        </div>
      </div>

      <div className="emp-form-grid full">
        <div className="emp-form-group">
          <label className="emp-form-label required">Job Description</label>
          <textarea
            className="emp-textarea"
            style={{ minHeight: 96 }}
            value={form.description}
            placeholder="Describe the role, responsibilities, and expectations..."
            onChange={(event) => onUpdateForm('description', event.target.value)}
          />
        </div>
      </div>

      <div className="emp-form-grid full">
        <div className="emp-form-group">
          <label className="emp-form-label required">Required Skills</label>
          <div className="emp-skill-input-row">
            <input
              className="emp-input"
              value={requiredSkillInput}
              placeholder="e.g., SQL"
              onChange={(event) => onRequiredInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  onAddRequired();
                }
              }}
            />
            <button className="emp-btn-forest" type="button" onClick={onAddRequired}>
              <UIIcon name="plus" />
              Add
            </button>
          </div>
          <div className="emp-added-skills">
            {requiredSkills.map((skill) => (
              <span key={`req-${skill}`} className="emp-skill-tag">
                {skill}
                <button type="button" onClick={() => onRemoveRequired(skill)}>
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="emp-form-grid full">
        <div className="emp-form-group">
          <label className="emp-form-label">Nice-to-Have Skills</label>
          <div className="emp-skill-input-row">
            <input
              className="emp-input"
              value={niceSkillInput}
              placeholder="e.g., Power BI"
              onChange={(event) => onNiceInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  onAddNice();
                }
              }}
            />
            <button className="emp-btn-secondary" type="button" onClick={onAddNice}>
              <UIIcon name="plus" />
              Add
            </button>
          </div>
          <div className="emp-added-skills">
            {niceSkills.map((skill) => (
              <span key={`nice-${skill}`} className="emp-skill-tag nice">
                {skill}
                <button type="button" onClick={() => onRemoveNice(skill)}>
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="emp-form-grid">
        <div className="emp-form-group">
          <label className="emp-form-label required">Status</label>
          <select className="emp-select" value={form.status} onChange={(event) => onUpdateForm('status', event.target.value as JobStatus)}>
            <option value="open">Open</option>
            <option value="draft">Draft</option>
            <option value="closed">Closed</option>
          </select>
        </div>
      </div>

      <div className="emp-job-editor-actions">
        <button className="emp-btn-secondary" type="button" onClick={onSaveDraft}>
          <UIIcon name="bookmark" />
          Save Draft
        </button>
        <button className="emp-btn-primary" type="button" onClick={onPost}>
          <UIIcon name="paper-plane" />
          Post Job
        </button>
      </div>
    </div>
  );
}

function DeleteProfileModal({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="emp-modal-overlay" onClick={onCancel}>
      <div className="emp-modal sm" onClick={(event) => event.stopPropagation()}>
        <div className="emp-modal-header">
          <div className="emp-modal-title text-red">Delete Employer Profile</div>
          <button className="emp-modal-close" type="button" onClick={onCancel}>
            <UIIcon name="close" />
          </button>
        </div>
        <div className="emp-danger-notice">
          <UIIcon name="times-circle" />
          <span>
            This is a deletion request. You will receive an email confirmation before any employer data is removed.
          </span>
        </div>
        <p className="mt-3 text-sm text-soft">
          This prototype does not independently verify employer identity or organization legitimacy.
        </p>
        <div className="emp-modal-footer">
          <button className="emp-btn-secondary" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="emp-btn-danger" type="button" onClick={onConfirm}>
            <UIIcon name="times-circle" />
            Request Deletion
          </button>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import {
  faArrowUpRightFromSquare,
  faBars,
  faBell,
  faBook,
  faBookmark,
  faBriefcase,
  faBuilding,
  faBullseye,
  faChartLine,
  faChevronDown,
  faCircleCheck,
  faClipboard,
  faClock,
  faColumns,
  faComments,
  faCompass,
  faEye,
  faFilter,
  faGraduationCap,
  faLaptop,
  faLayerGroup,
  faLightbulb,
  faList,
  faLocationDot,
  faMagnifyingGlass,
  faPaperPlane,
  faPuzzlePiece,
  faRightFromBracket,
  faRocket,
  faShieldHalved,
  faSliders,
  faTableCellsLarge,
  faTrash,
  faUpload,
  faUser,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import Logo from '../components/Logo';
import { useOnboarding } from '../hooks/useOnboarding';
import { analyzeResume, fetchAvailableJobs, runJobMatches, validateCertificateFile } from '../lib/api';
import type { AvailableJobItem } from '../lib/api';
import type { LearningRecommendation as RunLearningRecommendation } from '../types';
import { extractMatchPercent, formatMatchPercentLabel } from '../lib/matchScoring';
import type { CourseRecommendation, JobMatch, MatchResultItem, ParsedResume, PrioritizedSkillGap, SkillGap, SurveyAnswers } from '../types';
import './candidate-dashboard-v5.css';

type DashboardProps = {
  currentUser: { name: string; email: string } | null;
  onHome: () => void;
  onLogin: () => void;
  onSignUp: () => void;
  onUpdateResume: () => void;
  onLogout: () => void;
};

type DashboardPage =
  | 'dashboard'
  | 'jobmatches'
  | 'skillgaps'
  | 'applications'
  | 'preferences'
  | 'account'
  | 'kareers'
  | 'upskilling'
  | 'messages';

type JobFilter = 'all' | 'fit-now' | 'aspiration' | 'internal' | 'external' | 'saved';
type UpskillTab = 'recommended' | 'inprogress' | 'completed' | 'by-gap';
type ToastType = '' | 'success' | 'warn' | 'danger';
type ApplicationStatus = 'Pending' | 'Shortlisted' | 'Interviewing' | 'Hired' | 'Rejected' | 'Withdrawn';
type MessageRequestState = 'Pending' | 'Accepted' | 'Declined' | 'Ignored';
type SeverityLevel = 'Critical' | 'High' | 'Moderate';
type SkillCategory = 'Core Office Tools' | 'Programming & Scripting' | 'Statistical Analysis' | 'Data Visualization' | 'Data Engineering' | 'Other';
type ProgressStatus = {
  label: string;
  className: string;
  interpretation: string;
};
type IconName =
  | 'menu'
  | 'bell'
  | 'chevron-down'
  | 'dashboard'
  | 'briefcase'
  | 'lightbulb'
  | 'clipboard'
  | 'sliders'
  | 'user'
  | 'compass'
  | 'book'
  | 'message'
  | 'chart'
  | 'target'
  | 'search'
  | 'clock'
  | 'list'
  | 'upload'
  | 'trash'
  | 'logout'
  | 'puzzle'
  | 'layers'
  | 'graduation'
  | 'building'
  | 'location'
  | 'setup'
  | 'eye'
  | 'external'
  | 'bookmark'
  | 'paper-plane'
  | 'shield'
  | 'columns'
  | 'filter'
  | 'check-circle'
  | 'rocket';

type DashboardJob = {
  id: string;
  title: string;
  company: string;
  location: string;
  setup: string;
  salary: string;
  matchScore: number;
  hasMatchScore: boolean;
  matchCategory: 'fit-now' | 'aspiration';
  sourceType: 'internal' | 'external';
  matchedSkills: string[];
  missingSkills: string[];
  explanation: string;
  category?: string;
  subCategory?: string;
  jobLevel?: string;
  niceToHaveSkills?: string[];
  externalUrl?: string;
};

const TOP_MATCHES_PER_CATEGORY = 10;

type DashboardGap = {
  skill: string;
  severity: SeverityLevel;
  affectedCount: number;
  recommendedLevel: string;
  category: SkillCategory;
  relatedJobs: string[];
};

type DashboardCourse = {
  id: string;
  title: string;
  provider: string;
  duration: string;
  level: string;
  certificateAvailable: boolean;
  isFree: boolean;
  gapTag: string;
  url?: string;
  source: 'backend';
};

type DashboardApplication = {
  id: string;
  jobId: string;
  jobTitle: string;
  company: string;
  matchScore: number;
  status: ApplicationStatus;
  dateApplied: string;
  sourceType: 'internal' | 'external';
};

type EvidenceUploadRecord = {
  id: string;
  title: string;
  uploadedAt: string;
  status: 'Pending Verification' | 'Verified';
};

type ResumeAnalyzeResponse = Awaited<ReturnType<typeof analyzeResume>>;

const defaultSurveyAnswers: SurveyAnswers = {
  industry: 'tech',
  role: 'data analyst',
  setup: 'remote',
  salary: 'entry',
  skill: 'python',
};

const industryLabels: Record<string, string> = {
  tech: 'Technology & Software',
  finance: 'Finance & Banking',
  bpo: 'BPO & Customer Service',
  healthcare: 'Healthcare & Medical',
  other: 'Other',
};

const setupLabels: Record<string, string> = {
  remote: '100% Work from Home',
  hybrid: 'Hybrid',
  onsite: 'On-site',
  flexible: 'Flexible - no preference',
};

const salaryLabels: Record<string, string> = {
  entry: 'Entry level',
  '20-30': 'PHP 20,000 - PHP 30,000/month',
  '30-50': 'PHP 30,000 - PHP 50,000/month',
  '50-80': 'PHP 50,000 - PHP 80,000/month',
  '80+': 'PHP 80,000+/month',
  '25000-40000': 'PHP 25,000 - PHP 40,000/month',
  '40000-60000': 'PHP 40,000 - PHP 60,000/month',
  '60000+': 'PHP 60,000+/month',
  unsure: "I'm not sure",
};

const iconMap: Record<IconName, IconDefinition> = {
  menu: faBars,
  bell: faBell,
  'chevron-down': faChevronDown,
  dashboard: faTableCellsLarge,
  briefcase: faBriefcase,
  lightbulb: faLightbulb,
  clipboard: faClipboard,
  sliders: faSliders,
  user: faUser,
  compass: faCompass,
  book: faBook,
  message: faComments,
  chart: faChartLine,
  target: faBullseye,
  search: faMagnifyingGlass,
  clock: faClock,
  list: faList,
  upload: faUpload,
  trash: faTrash,
  logout: faRightFromBracket,
  puzzle: faPuzzlePiece,
  layers: faLayerGroup,
  graduation: faGraduationCap,
  building: faBuilding,
  location: faLocationDot,
  setup: faLaptop,
  eye: faEye,
  external: faArrowUpRightFromSquare,
  bookmark: faBookmark,
  'paper-plane': faPaperPlane,
  shield: faShieldHalved,
  columns: faColumns,
  filter: faFilter,
  'check-circle': faCircleCheck,
  rocket: faRocket,
};

function UIIcon({ name, className = '' }: { name: IconName; className?: string }) {
  const baseClass = `cand-inline-icon ${className}`.trim();
  return <FontAwesomeIcon className={baseClass} icon={iconMap[name] || faBars} aria-hidden="true" />;
}

function normalizeSkill(value: string): string {
  return value.toLowerCase().replace(/\s*\([^)]*\)/g, '').trim();
}

function titleCase(value: string): string {
  return value.replace(/\b\w/g, (char) => char.toUpperCase());
}

function scoreColorClass(score: number): string {
  if (score >= 85) return 'var(--rust)';
  if (score >= 75) return 'var(--forest)';
  if (score >= 65) return 'var(--mauve)';
  return 'var(--tan)';
}

function getMatchScoreBadge(job: DashboardJob): string {
  return formatMatchPercentLabel(job.hasMatchScore ? job.matchScore : null);
}

function getMatchScoreColor(job: DashboardJob): string {
  if (!job.hasMatchScore) return 'var(--soft)';
  return scoreColorClass(job.matchScore);
}

function getInitials(name: string, email: string): string {
  const source = name.trim() || email.split('@')[0] || 'User';
  const words = source.split(/[\s._-]+/).filter(Boolean);
  return (words.slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || 'U').slice(0, 2);
}

function formatDateLabel(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function getSkillLabel(skill: unknown): string {
  if (typeof skill === 'string') return skill.trim();
  if (skill && typeof skill === 'object') {
    const record = skill as Record<string, unknown>;
    const label = record.name || record.skill_name || record.title || record.message;
    if (typeof label === 'string') return label.trim();
  }
  return '';
}

function extractSkillsFromResume(resume: ParsedResume | null | undefined): string[] {
  return (resume?.skills || []).map(getSkillLabel).filter(Boolean);
}

function extractResumeText(resume: ParsedResume | null | undefined): string {
  if (!resume) return '';
  return (
    resume.normalized_for_matching?.resume_text_for_matching ||
    resume.cleanedText ||
    resume.cleaned_text ||
    resume.rawText ||
    resume.raw_text ||
    ''
  ).trim();
}

function getInternalExternalHint(text: string): 'internal' | 'external' {
  const value = text.toLowerCase();
  if (value.includes('external') || value.includes('jobstreet') || value.includes('linkedin') || value.includes('indeed')) {
    return 'external';
  }
  return 'internal';
}

function classifySkillCategory(skill: string): SkillCategory {
  const value = normalizeSkill(skill);
  if (/(excel|word|powerpoint|google sheets|google workspace|docs|slides|office|canva)/.test(value)) return 'Core Office Tools';
  if (/(python|sql|javascript|typescript|java|c\+\+|react|node|api|git|linux|pandas|numpy|programming)/.test(value)) return 'Programming & Scripting';
  if (/(statistics|spss|r language|regression|hypothesis|analytics)/.test(value)) return 'Statistical Analysis';
  if (/(power bi|tableau|visualization|dashboard|dax)/.test(value)) return 'Data Visualization';
  if (/(azure|dbt|spark|pipeline|warehouse|airflow|engineering)/.test(value)) return 'Data Engineering';
  return 'Other';
}

function mapSeverity(value: string): SeverityLevel {
  const normalized = value.toLowerCase();
  if (normalized.includes('critical')) return 'Critical';
  if (normalized.includes('high')) return 'High';
  return 'Moderate';
}

function severityPriority(value: SeverityLevel): number {
  if (value === 'Critical') return 0;
  if (value === 'High') return 1;
  return 2;
}

function severityClass(value: SeverityLevel): string {
  if (value === 'Critical') return 'critical';
  if (value === 'High') return 'high';
  return 'moderate';
}

function categoryStatus(percent: number): ProgressStatus {
  if (percent <= 0) {
    return {
      label: 'Not Started / Missing',
      className: 'cand-sdp-chip cand-sdp-not-started',
      interpretation: 'No learning activity or supporting evidence has been recorded.',
    };
  }

  if (percent <= 25) {
    return {
      label: 'Foundation Progress',
      className: 'cand-sdp-chip cand-sdp-early',
      interpretation: 'The candidate has started addressing the skill gap.',
    };
  }

  if (percent <= 50) {
    return {
      label: 'Intermediate Progress',
      className: 'cand-sdp-chip cand-sdp-developing',
      interpretation: 'Some learning completion or supporting evidence is present.',
    };
  }

  if (percent <= 75) {
    return {
      label: 'Advanced Progress',
      className: 'cand-sdp-chip cand-sdp-advanced',
      interpretation: 'Most related skills show learning progress or evidence.',
    };
  }

  return {
    label: 'Strong Progress Evidence',
    className: 'cand-sdp-chip cand-sdp-strong',
    interpretation: 'Strong evidence exists across most skills in the category.',
  };
}

function categoryBarColor(category: SkillCategory): string {
  if (category === 'Core Office Tools') return 'var(--green)';
  if (category === 'Programming & Scripting') return 'var(--forest)';
  if (category === 'Statistical Analysis') return 'var(--rust)';
  if (category === 'Data Visualization') return 'var(--amber)';
  if (category === 'Data Engineering') return 'var(--cream-d)';
  return 'var(--tan)';
}

function inferJobMetadata(title: string, matchedSkills: string[], missingSkills: string[]) {
  const value = title.toLowerCase();
  const allSkills = [...matchedSkills, ...missingSkills].map((skill) => normalizeSkill(skill));
  const hasDataScience = allSkills.some((skill) => /(python|pandas|numpy|sql|tableau|power bi|analytics|statistics|r language)/.test(skill));

  if (/analyst|business intelligence|bi|research/.test(value) || hasDataScience) {
    return {
      category: 'Data & Analytics',
      subCategory: /business intelligence|bi/.test(value) ? 'Business Intelligence' : /research/.test(value) ? 'Research & Statistics' : 'Data Analysis',
      jobLevel: /senior|lead/.test(value) ? 'Senior' : /junior/.test(value) ? 'Junior' : /trainee|intern/.test(value) ? 'Trainee' : 'Entry Level',
      niceToHaveSkills: ['Data Storytelling', 'Dashboard Design', 'Stakeholder Communication'],
    };
  }

  if (/engineer|database|db|pipeline|etl/.test(value)) {
    return {
      category: 'Engineering',
      subCategory: 'Data Engineering',
      jobLevel: /senior|lead/.test(value) ? 'Senior' : /junior/.test(value) ? 'Junior' : 'Mid-Level',
      niceToHaveSkills: ['Cloud Data Warehouse', 'CI/CD Pipelines', 'Data Governance'],
    };
  }

  if (/support|specialist|coordinator|assistant/.test(value)) {
    return {
      category: 'Operations & Support',
      subCategory: 'Technical Support',
      jobLevel: /senior|lead/.test(value) ? 'Senior' : 'Entry Level',
      niceToHaveSkills: ['Customer Support Tools', 'Incident Management', 'Documentation'],
    };
  }

  return {
    category: 'General Opportunities',
    subCategory: 'Career Path',
    jobLevel: 'Entry to Mid-Level',
    niceToHaveSkills: ['Communication', 'Problem Solving', 'Adaptability'],
  };
}

function mapRunMatch(match: MatchResultItem, category: 'fit-now' | 'aspiration'): DashboardJob {
  const scoreContext = category === 'fit-now' ? 'fit_now' : 'aspiration';
  const normalizedScore = extractMatchPercent(match, scoreContext);
  const score = normalizedScore === null ? 0 : Math.round(normalizedScore);
  const metaText = `${match.company || ''} ${match.job_title || ''} ${match.explanation || ''}`.trim();
  const dynamic = match as unknown as Record<string, unknown>;
  const externalUrl = typeof dynamic.job_url === 'string' ? dynamic.job_url : typeof dynamic.url === 'string' ? dynamic.url : undefined;
  const sourceType = getInternalExternalHint(metaText);
  const location = match.location || 'Location not specified';
  const setup = location.toLowerCase().includes('remote') ? 'Remote' : location.toLowerCase().includes('hybrid') ? 'Hybrid' : 'Onsite';
  const matchedSkills = (match.matched_skills || []).map(titleCase);
  const missingSkills = (match.missing_skills || []).map(titleCase);
  const inferredMeta = inferJobMetadata(match.job_title || '', matchedSkills, missingSkills);
  const categoryLabel = typeof dynamic.category === 'string' && dynamic.category.trim() ? dynamic.category : inferredMeta.category;
  const subCategoryLabel = typeof dynamic.sub_category === 'string' && dynamic.sub_category.trim() ? dynamic.sub_category : inferredMeta.subCategory;
  const jobLevel = typeof dynamic.job_level === 'string' && dynamic.job_level.trim() ? dynamic.job_level : inferredMeta.jobLevel;
  return {
    id: match.job_id || `${match.job_title}-${match.company}-${category}`,
    title: match.job_title || 'Untitled role',
    company: match.company || 'Unknown company',
    location,
    setup,
    salary: 'Salary varies by employer',
    matchScore: score,
    hasMatchScore: normalizedScore !== null,
    matchCategory: category,
    sourceType,
    matchedSkills,
    missingSkills,
    explanation: match.explanation || 'Match explanation is not available yet.',
    category: titleCase(categoryLabel),
    subCategory: titleCase(subCategoryLabel),
    jobLevel: titleCase(jobLevel),
    niceToHaveSkills: inferredMeta.niceToHaveSkills,
    externalUrl,
  };
}

function mapModelMatch(match: JobMatch): DashboardJob {
  const score = Math.max(0, Math.min(100, Math.round(match.matchScore)));
  const category: 'fit-now' | 'aspiration' = score >= 75 ? 'fit-now' : 'aspiration';
  const matchedSkills = (match.requiredSkills || []).filter((skill) => !(match.missingSkills || []).includes(skill)).map(titleCase);
  const missingSkills = (match.missingSkills || []).map(titleCase);
  const inferredMeta = inferJobMetadata(match.title, matchedSkills, missingSkills);
  return {
    id: match.id,
    title: match.title,
    company: match.company || 'Unknown company',
    location: 'Philippines',
    setup: 'Flexible',
    salary: 'Salary varies by employer',
    matchScore: score,
    hasMatchScore: true,
    matchCategory: category,
    sourceType: 'internal',
    matchedSkills,
    missingSkills,
    explanation: score >= 75 ? 'Strong alignment with your current profile and skill set.' : 'Aspiration role with specific skill gaps to close.',
    category: inferredMeta.category,
    subCategory: inferredMeta.subCategory,
    jobLevel: inferredMeta.jobLevel,
    niceToHaveSkills: inferredMeta.niceToHaveSkills,
    externalUrl: undefined,
  };
}

function mapAvailableJob(job: AvailableJobItem): DashboardJob {
  const location = job.location || 'Philippines';
  const workType = (job.work_type || '').toLowerCase();
  const setup = workType.includes('remote') ? 'Remote' : workType.includes('hybrid') ? 'Hybrid' : workType.includes('onsite') || workType.includes('on-site') ? 'Onsite' : 'Flexible';
  const sourceType: 'internal' | 'external' = job.external_job_link_optional ? 'external' : 'internal';
  const requiredSkills = Array.isArray(job.required_skills) ? job.required_skills.map(titleCase).slice(0, 12) : [];

  return {
    id: job.job_id || `${job.job_title}-${job.company_name || 'company'}`,
    title: job.job_title || 'Untitled role',
    company: job.company_name || 'Kareerly Partner Employer',
    location,
    setup,
    salary: job.salary_range_monthly_php || 'Salary varies by employer',
    matchScore: 0,
    hasMatchScore: false,
    matchCategory: 'aspiration',
    sourceType,
    matchedSkills: requiredSkills,
    missingSkills: [],
    explanation: 'This role is available in the current Kareerly job database and can be explored without resume upload.',
    category: titleCase(job.job_category || 'General Opportunities'),
    subCategory: titleCase(job.job_subcategory || 'Career Path'),
    jobLevel: titleCase(job.experience_level_required || 'Entry Level'),
    niceToHaveSkills: [],
    externalUrl: job.external_job_link_optional || undefined,
  };
}

function mapRunGap(gap: PrioritizedSkillGap): DashboardGap {
  const severity = mapSeverity(String(gap.severity || 'Moderate'));
  return {
    skill: titleCase(gap.skill_name || 'Unnamed skill'),
    severity,
    affectedCount: gap.appears_in_top_matches ?? gap.missing_count ?? 0,
    recommendedLevel: severity === 'Critical' ? 'Beginner -> Intermediate' : severity === 'High' ? 'Beginner -> Intermediate' : 'Beginner',
    category: classifySkillCategory(gap.skill_name || ''),
    relatedJobs: (gap.related_jobs || []).slice(0, 4),
  };
}

function mapModelGap(gap: SkillGap, matches: JobMatch[]): DashboardGap {
  const severity = gap.importance === 'critical' ? 'Critical' : gap.importance === 'high' ? 'High' : 'Moderate';
  const related = matches
    .filter((match) => (match.missingSkills || []).some((skill) => normalizeSkill(skill) === normalizeSkill(gap.skill)))
    .map((match) => match.title)
    .slice(0, 4);
  return {
    skill: titleCase(gap.skill),
    severity,
    affectedCount: gap.frequency || related.length,
    recommendedLevel: severity === 'Critical' ? 'Beginner -> Intermediate' : severity === 'High' ? 'Beginner -> Intermediate' : 'Beginner',
    category: classifySkillCategory(gap.skill),
    relatedJobs: related,
  };
}

function mapCourse(rec: CourseRecommendation): DashboardCourse {
  const primaryGap = rec.matchedSkillGaps?.[0] || rec.course?.skillsTargeted?.[0] || rec.course?.title || 'General';
  return {
    id: rec.id || rec.courseId,
    title: rec.course?.title || 'Untitled course',
    provider: rec.course?.provider || 'Course provider',
    duration: rec.course?.duration || 'Self-paced',
    level: rec.course?.difficulty || 'beginner',
    certificateAvailable: Boolean(rec.course?.certificateAvailable),
    isFree: Boolean(rec.course?.isFree),
    gapTag: titleCase(primaryGap),
    url: rec.course?.url,
    source: 'backend',
  };
}

function mapRunLearningRecommendation(rec: RunLearningRecommendation): DashboardCourse {
  const gapTag = rec.skills_youll_gain || rec.title || 'General';
  return {
    id: rec.resource_id || rec.title,
    title: rec.title || 'Untitled course',
    provider: rec.provider || 'Course provider',
    duration: rec.estimated_duration || 'Self-paced',
    level: rec.level || 'beginner',
    certificateAvailable: Boolean(rec.certification_score && rec.certification_score > 0),
    isFree: !String(rec.cost_type || '').toLowerCase().includes('paid'),
    gapTag: titleCase(gapTag),
    url: rec.url || undefined,
    source: 'backend',
  };
}

function compactCompanyBadge(company: string): string {
  const parts = company.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'CO';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
}

function getPreferenceLabel(table: Record<string, string>, key: string): string {
  return table[key] || key;
}

function dateTodayIso(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function dateOffsetIso(daysAgo: number): string {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function statusKey(status: ApplicationStatus): 'pending' | 'shortlisted' | 'interviewing' | 'hired' | 'rejected' | 'withdrawn' {
  return status.toLowerCase() as 'pending' | 'shortlisted' | 'interviewing' | 'hired' | 'rejected' | 'withdrawn';
}

export default function Dashboard({ currentUser, onHome, onLogin, onSignUp, onUpdateResume, onLogout }: DashboardProps) {
  void onLogin;
  void onSignUp;

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-bg px-6 py-16">
        <div className="mx-auto max-w-lg rounded-xl border border-bdr bg-card p-6 text-center">
          <h2 className="font-display text-2xl font-bold text-dark">Candidate Dashboard is for registered users only</h2>
          <p className="mt-2 text-sm text-soft">Please sign in to access your dashboard, matches, applications, and progress records.</p>
        </div>
      </div>
    );
  }

  const {
    state,
    setResumeFile,
    setParsedResume,
    setResumeAnalysis,
    setResults,
    setMatchResults,
    setSurveyAnswers,
    setLoading,
    setError,
  } = useOnboarding();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.innerWidth < 900);
  const [activePage, setActivePage] = useState<DashboardPage>('dashboard');
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [jobSearch, setJobSearch] = useState('');
  const [jobFilter, setJobFilter] = useState<JobFilter>('all');
  const [upskillTab, setUpskillTab] = useState<UpskillTab>('recommended');
  const [selectedKareerId, setSelectedKareerId] = useState<string>('');
  const [savedJobs, setSavedJobs] = useState<Set<string>>(() => new Set());
  const [applications, setApplications] = useState<DashboardApplication[]>([]);
  const [readNotifications, setReadNotifications] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  const [inlineNotice, setInlineNotice] = useState<{ message: string; type: ToastType } | null>(null);
  const [uiLanguage, setUiLanguage] = useState<'en' | 'fil'>('en');
  const [jobDetailOpen, setJobDetailOpen] = useState(false);
  const [selectedJob, setSelectedJob] = useState<DashboardJob | null>(null);
  const [withdrawModalOpen, setWithdrawModalOpen] = useState(false);
  const [withdrawTarget, setWithdrawTarget] = useState<DashboardApplication | null>(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [resumeModalOpen, setResumeModalOpen] = useState(false);
  const [resumeStep, setResumeStep] = useState<'upload' | 'decision' | 'review'>('upload');
  const [resumeDragOver, setResumeDragOver] = useState(false);
  const [resumeUploadFile, setResumeUploadFile] = useState<File | null>(null);
  const [resumeAnalyzeData, setResumeAnalyzeData] = useState<ResumeAnalyzeResponse | null>(null);
  const [reviewSkills, setReviewSkills] = useState<string[]>([]);
  const [newSkillInput, setNewSkillInput] = useState('');
  const [resumePostRefreshTarget, setResumePostRefreshTarget] = useState<'dashboard' | 'preferences'>('dashboard');
  const [skillNames, setSkillNames] = useState<string[]>(() => extractSkillsFromResume(state.resume));
  const [selectedThreadJobId, setSelectedThreadJobId] = useState<string>('');
  const [messageStates, setMessageStates] = useState<Record<string, MessageRequestState>>({});
  const [messageRequests, setMessageRequests] = useState<Record<string, string>>({});
  const [messageDraft, setMessageDraft] = useState('');
  const [messageReplies, setMessageReplies] = useState<Record<string, Array<{ from: 'employer' | 'candidate'; text: string; time: string }>>>({});
  const [startedCourseIds, setStartedCourseIds] = useState<Set<string>>(() => new Set());
  const [completedCourseIds, setCompletedCourseIds] = useState<Set<string>>(() => new Set());
  const [extraPreferences, setExtraPreferences] = useState({ jobLevel: 'Entry Level', preferredLocation: 'Metro Manila / Laguna' });
  const [availableJobs, setAvailableJobs] = useState<AvailableJobItem[]>([]);
  const [evidenceRecords, setEvidenceRecords] = useState<EvidenceUploadRecord[]>([
    { id: 'ev-001', title: 'TESDA NC II - Data Analytics', uploadedAt: dateTodayIso(), status: 'Verified' },
  ]);

  const toastTimeoutRef = useRef<number | null>(null);

  const displayName = currentUser.name || currentUser.email.split('@')[0] || 'Candidate';
  const displayEmail = currentUser.email;
  const initials = getInitials(displayName, displayEmail);
  const surveyAnswers = state.surveyAnswers || defaultSurveyAnswers;

  useEffect(() => {
    const extracted = extractSkillsFromResume(state.resume);
    if (extracted.length > 0) setSkillNames(extracted);
  }, [state.resume?.skills]);

  useEffect(() => {
    let isMounted = true;
    void (async () => {
      try {
        const response = await fetchAvailableJobs(300);
        if (isMounted) {
          setAvailableJobs(response.results || []);
        }
      } catch {
        if (isMounted) {
          setAvailableJobs([]);
        }
      }
    })();
    return () => {
      isMounted = false;
    };
  }, []);

  const jobs = useMemo<DashboardJob[]>(() => {
    if (state.matchResults) {
      const fitNow = (state.matchResults.fit_now_matches || []).map((match) => mapRunMatch(match, 'fit-now'));
      const aspiration = (state.matchResults.aspiration_matches || []).map((match) => mapRunMatch(match, 'aspiration'));
      return [...fitNow, ...aspiration].sort((a, b) => b.matchScore - a.matchScore);
    }
    if (state.results?.jobMatches?.length) {
      return state.results.jobMatches.map(mapModelMatch).sort((a, b) => b.matchScore - a.matchScore);
    }
    return [];
  }, [state.matchResults, state.results?.jobMatches]);

  const gaps = useMemo<DashboardGap[]>(() => {
    if (state.matchResults?.skill_gaps?.length) {
      return state.matchResults.skill_gaps.map(mapRunGap).sort((a, b) => severityPriority(a.severity) - severityPriority(b.severity));
    }
    if (state.matchResults?.prioritized_skill_gaps?.length) {
      return state.matchResults.prioritized_skill_gaps.map(mapRunGap).sort((a, b) => severityPriority(a.severity) - severityPriority(b.severity));
    }
    if (state.results?.skillGaps?.length) {
      return state.results.skillGaps.map((gap) => mapModelGap(gap, state.results?.jobMatches || [])).sort((a, b) => severityPriority(a.severity) - severityPriority(b.severity));
    }
    return [];
  }, [state.matchResults?.skill_gaps, state.matchResults?.prioritized_skill_gaps, state.results?.jobMatches, state.results?.skillGaps]);

  const courses = useMemo<DashboardCourse[]>(() => {
    if (state.matchResults?.learning_recommendations?.length) {
      return state.matchResults.learning_recommendations.map(mapRunLearningRecommendation);
    }
    return (state.results?.courseRecommendations || []).map(mapCourse);
  }, [state.matchResults?.learning_recommendations, state.results?.courseRecommendations]);

  const totalMatchesGenerated = useMemo(() => {
    const apiTotal = state.matchResults?.metadata?.total_jobs_scored;
    if (typeof apiTotal === 'number' && Number.isFinite(apiTotal) && apiTotal >= 0) return apiTotal;

    const legacyTotal = state.results?.summary?.totalMatches;
    if (typeof legacyTotal === 'number' && Number.isFinite(legacyTotal) && legacyTotal >= 0) return legacyTotal;

    return jobs.length;
  }, [jobs.length, state.matchResults?.metadata?.total_jobs_scored, state.results?.summary?.totalMatches]);

  useEffect(() => {
    if (applications.length > 0) return;
    const internalJobs = jobs.filter((job) => job.sourceType === 'internal');
    if (internalJobs.length === 0) return;
    const seededStatuses: ApplicationStatus[] = ['Shortlisted', 'Pending', 'Interviewing', 'Hired', 'Rejected', 'Withdrawn'];
    const seeded = internalJobs.slice(0, 6).map((job, index) => ({
      id: `${job.id}-seeded-${index}`,
      jobId: job.id,
      jobTitle: job.title,
      company: job.company,
      matchScore: job.matchScore,
      status: seededStatuses[index] || 'Pending',
      dateApplied: dateOffsetIso((index + 1) * 4),
      sourceType: 'internal' as const,
    }));
    setApplications(seeded);
  }, [applications.length, jobs]);

  const categoryProgress = useMemo(() => {
    const baseCategories: SkillCategory[] = [
      'Core Office Tools',
      'Programming & Scripting',
      'Statistical Analysis',
      'Data Visualization',
      'Data Engineering',
      'Other',
    ];

    const missingByCategory = new Map<SkillCategory, Set<string>>();
    const matchedByCategory = new Map<SkillCategory, Set<string>>();
    const courseIdsByCategory = new Map<SkillCategory, Set<string>>();

    const addSkill = (map: Map<SkillCategory, Set<string>>, skill: string) => {
      const category = classifySkillCategory(skill);
      if (!map.has(category)) map.set(category, new Set());
      map.get(category)?.add(normalizeSkill(skill));
    };

    const addCourse = (map: Map<SkillCategory, Set<string>>, course: DashboardCourse) => {
      const category = classifySkillCategory(course.gapTag || course.title || '');
      if (!map.has(category)) map.set(category, new Set());
      map.get(category)?.add(course.id);
    };

    gaps.forEach((gap) => addSkill(missingByCategory, gap.skill));
    jobs.forEach((job) => {
      job.matchedSkills.forEach((skill) => addSkill(matchedByCategory, skill));
      job.missingSkills.forEach((skill) => addSkill(missingByCategory, skill));
    });
    courses.forEach((course) => addCourse(courseIdsByCategory, course));

    const dynamicCategories = new Set<SkillCategory>(baseCategories);
    missingByCategory.forEach((_skills, category) => dynamicCategories.add(category));
    matchedByCategory.forEach((_skills, category) => dynamicCategories.add(category));
    courseIdsByCategory.forEach((_ids, category) => dynamicCategories.add(category));

    return Array.from(dynamicCategories).map((category) => {
      const missing = missingByCategory.get(category)?.size || 0;
      const matched = matchedByCategory.get(category)?.size || 0;
      const courseIds = Array.from(courseIdsByCategory.get(category) || []);
      const completed = courseIds.filter((courseId) => completedCourseIds.has(courseId)).length;
      const startedOnly = courseIds.filter((courseId) => startedCourseIds.has(courseId) && !completedCourseIds.has(courseId)).length;
      const hasProgressEvidence = completed > 0 || startedOnly > 0;

      let percent = 0;

      if (hasProgressEvidence) {
        const totalRelevantCourses = Math.max(1, courseIds.length, completed + startedOnly);
        const learningCompletion = (completed / totalRelevantCourses) * 100;
        const skillGapReduction = missing + matched > 0 ? (matched / (missing + matched)) * 100 : 0;
        const uploadedEvidence = (completed / totalRelevantCourses) * 100;
        const recentActivity = ((completed + startedOnly) / totalRelevantCourses) * 100;

        percent = Math.round(
          (0.35 * learningCompletion)
          + (0.30 * skillGapReduction)
          + (0.20 * uploadedEvidence)
          + (0.15 * recentActivity),
        );
      }

      return { category, percent, missing, matched, completed };
    });
  }, [completedCourseIds, courses, gaps, jobs, startedCourseIds]);

  const metricCards = useMemo(() => {
    const fitNowCount = jobs.filter((job) => job.matchCategory === 'fit-now').length;
    const aspirationCount = jobs.filter((job) => job.matchCategory === 'aspiration').length;
    const topFitNowCount = Math.min(fitNowCount, TOP_MATCHES_PER_CATEGORY);
    const topAspirationCount = Math.min(aspirationCount, TOP_MATCHES_PER_CATEGORY);
    const scoredJobs = jobs.filter((job) => job.hasMatchScore);
    const profileReadiness = scoredJobs.length > 0 ? Math.round(scoredJobs.reduce((sum, job) => sum + job.matchScore, 0) / scoredJobs.length) : 0;
    return [
      {
        label: 'Profile Readiness',
        value: `${profileReadiness}%`,
        detail: state.resumeFile ? `Resume uploaded ${formatDateLabel(dateTodayIso())}` : 'Resume not uploaded yet',
        iconClass: 'green',
        valueColor: 'var(--green)',
        icon: 'check-circle' as IconName,
      },
      {
        label: 'Top Job Matches',
        value: String(totalMatchesGenerated),
        detail: `Showing top ${topFitNowCount} Fit-Now · ${topAspirationCount} Aspiration`,
        iconClass: 'amber',
        valueColor: 'var(--amber)',
        icon: 'briefcase' as IconName,
      },
      {
        label: 'Skill Gaps',
        value: String(gaps.length),
        detail: `${gaps.filter((gap) => gap.severity === 'Critical').length} critical · ${gaps.filter((gap) => gap.severity === 'High').length} high`,
        iconClass: 'mauve',
        valueColor: 'var(--mauve)',
        icon: 'puzzle' as IconName,
      },
      {
        label: 'Applications',
        value: String(applications.length),
        detail: `${applications.filter((app) => app.status === 'Interviewing').length} interviewing · ${applications.filter((app) => app.status === 'Shortlisted').length} shortlisted`,
        iconClass: 'forest',
        valueColor: 'var(--forest)',
        icon: 'layers' as IconName,
      },
    ];
  }, [applications, gaps, jobs, state.resumeFile, totalMatchesGenerated]);

  const topJobHighlights = useMemo(() => jobs.slice(0, 3), [jobs]);

  const recentApplications = useMemo(
    () =>
      applications
        .slice()
        .sort((a, b) => b.dateApplied.localeCompare(a.dateApplied))
        .slice(0, 3),
    [applications],
  );

  const topMissingSkills = useMemo(() => gaps.slice(0, 4), [gaps]);

  const recommendedSteps = useMemo(() => {
    const steps: string[] = [];
    const firstCriticalGap = gaps.find((gap) => gap.severity === 'Critical');
    const firstFitNow = jobs.find((job) => job.matchCategory === 'fit-now');
    const interviewingApp = applications.find((app) => app.status === 'Interviewing');

    if (firstCriticalGap) steps.push(`Complete ${firstCriticalGap.skill} learning resources to reduce critical gaps.`);
    if (firstFitNow) steps.push(`Apply to ${firstFitNow.title} at ${firstFitNow.company} (${getMatchScoreBadge(firstFitNow)} match).`);
    if (interviewingApp) steps.push(`Check ${interviewingApp.company} interview-stage updates in Messages.`);
    if (steps.length === 0) steps.push('Upload a resume and confirm skills to generate personalized next steps.');
    return steps.slice(0, 3);
  }, [applications, gaps, jobs]);

  const courseRecommendations = useMemo(() => courses.slice(0, 3), [courses]);
  const notificationRows = useMemo(() => buildNotificationRows(jobs, applications), [applications, jobs]);
  const unreadNotificationCount = useMemo(
    () => notificationRows.filter((row) => row.unread && !readNotifications[row.id]).length,
    [notificationRows, readNotifications],
  );

  useEffect(() => {
    if (notificationRows.length === 0) return;
    setReadNotifications((current) => {
      const next = { ...current };
      notificationRows.forEach((row) => {
        if (typeof next[row.id] === 'undefined') next[row.id] = !row.unread;
      });
      return next;
    });
  }, [notificationRows]);

  const filteredJobs = useMemo(() => {
    const query = jobSearch.trim().toLowerCase();
    return jobs.filter((job) => {
      if (jobFilter === 'fit-now' && job.matchCategory !== 'fit-now') return false;
      if (jobFilter === 'aspiration' && job.matchCategory !== 'aspiration') return false;
      if (jobFilter === 'internal' && job.sourceType !== 'internal') return false;
      if (jobFilter === 'external' && job.sourceType !== 'external') return false;
      if (jobFilter === 'saved' && !savedJobs.has(job.id)) return false;
      if (!query) return true;
      return [job.title, job.company, job.location, job.category || '', job.subCategory || '', job.jobLevel || '', job.matchedSkills.join(' '), job.missingSkills.join(' '), job.explanation]
        .join(' ')
        .toLowerCase()
        .includes(query);
    });
  }, [jobFilter, jobSearch, jobs, savedJobs]);

  const fitNowJobs = useMemo(() => jobs.filter((job) => job.matchCategory === 'fit-now'), [jobs]);
  const aspirationJobs = useMemo(() => jobs.filter((job) => job.matchCategory === 'aspiration'), [jobs]);
  const topFitNowMatchesCount = Math.min(fitNowJobs.length, TOP_MATCHES_PER_CATEGORY);
  const topAspirationMatchesCount = Math.min(aspirationJobs.length, TOP_MATCHES_PER_CATEGORY);
  const topAllMatchesCount = topFitNowMatchesCount + topAspirationMatchesCount;

  const kareersList = useMemo(() => {
    const map = new Map<string, DashboardJob>();
    const catalogJobs = availableJobs.map(mapAvailableJob);
    [...jobs, ...catalogJobs].forEach((job) => {
      const key = job.id || `${job.title}-${job.company}`;
      if (!map.has(key)) map.set(key, job);
    });
    return Array.from(map.values()).sort((a, b) => {
      if (a.hasMatchScore && b.hasMatchScore) return b.matchScore - a.matchScore;
      if (a.hasMatchScore) return -1;
      if (b.hasMatchScore) return 1;
      return a.title.localeCompare(b.title);
    });
  }, [availableJobs, jobs]);

  useEffect(() => {
    if (!selectedKareerId && kareersList.length > 0) setSelectedKareerId(kareersList[0].id);
  }, [kareersList, selectedKareerId]);

  const selectedKareer = kareersList.find((item) => item.id === selectedKareerId) || null;

  const inProgressCourses = useMemo(() => courses.filter((course) => startedCourseIds.has(course.id) && !completedCourseIds.has(course.id)), [completedCourseIds, courses, startedCourseIds]);
  const completedCourses = useMemo(() => courses.filter((course) => completedCourseIds.has(course.id)), [completedCourseIds, courses]);
  const recommendedCourses = useMemo(() => courses.filter((course) => !startedCourseIds.has(course.id) && !completedCourseIds.has(course.id)), [completedCourseIds, courses, startedCourseIds]);

  const groupedCoursesByGap = useMemo(() => {
    const groups = new Map<string, DashboardCourse[]>();
    courses.forEach((course) => {
      const key = course.gapTag || 'General';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)?.push(course);
    });
    return Array.from(groups.entries()).map(([gapTag, grouped]) => ({ gapTag, courses: grouped }));
  }, [courses]);

  const eligibleMessageApps = useMemo(() => applications.filter((app) => app.status === 'Interviewing' || app.status === 'Hired'), [applications]);

  useEffect(() => {
    if (eligibleMessageApps.length === 0) {
      setSelectedThreadJobId('');
      return;
    }
    if (!selectedThreadJobId || !eligibleMessageApps.some((app) => app.jobId === selectedThreadJobId)) {
      setSelectedThreadJobId(eligibleMessageApps[0].jobId);
    }
  }, [eligibleMessageApps, selectedThreadJobId]);

  useEffect(() => {
    if (eligibleMessageApps.length === 0) return;
    setMessageStates((current) => {
      const next = { ...current };
      eligibleMessageApps.forEach((app) => {
        if (!next[app.jobId]) next[app.jobId] = 'Pending';
      });
      return next;
    });
    setMessageRequests((current) => {
      const next = { ...current };
      eligibleMessageApps.forEach((app) => {
        if (!next[app.jobId]) {
          next[app.jobId] = `Hello ${displayName}, we would like to coordinate interview details for your ${app.jobTitle} application.`;
        }
      });
      return next;
    });
    setMessageReplies((current) => {
      const next = { ...current };
      eligibleMessageApps.forEach((app) => {
        if (!next[app.jobId]) {
          next[app.jobId] = [];
        }
      });
      return next;
    });
  }, [displayName, eligibleMessageApps]);

  const selectedMessageApp = eligibleMessageApps.find((app) => app.jobId === selectedThreadJobId) || null;
  const selectedMessageState = selectedMessageApp ? messageStates[selectedMessageApp.jobId] || 'Pending' : 'Pending';

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) window.clearTimeout(toastTimeoutRef.current);
    };
  }, []);

  const showToast = (message: string, type: ToastType = '') => {
    if (!message) return;
    setToast({ message, type });
    if (toastTimeoutRef.current) window.clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = window.setTimeout(() => setToast(null), 3600);
  };

  const showInlineNotice = (message: string, type: ToastType = 'success') => {
    setInlineNotice({ message, type });
  };

  const clearPanels = () => {
    setNotifOpen(false);
    setProfileOpen(false);
  };

  const markAllNotificationsRead = () => {
    if (notificationRows.length === 0) return;
    setReadNotifications((current) => {
      const next = { ...current };
      notificationRows.forEach((row) => {
        next[row.id] = true;
      });
      return next;
    });
    showToast('All notifications marked as read.', 'success');
  };

  const applyAnalysisResult = (data: ResumeAnalyzeResponse) => {
    setResumeAnalysis(data);
    setParsedResume(data.parsedResume);
    setResults({
      jobMatches: data.jobMatches,
      skillGaps: data.skillGaps,
      courseRecommendations: data.courseRecommendations,
      summary: data.summary,
    });
  };

  const runMatchingWithSkills = async (resume: ParsedResume, skills: string[], answers: SurveyAnswers) => {
    const resumeText = extractResumeText(resume);
    if (!resumeText) return null;
    const inputSkillIds = skills
      .map((skill) => skill.trim().toUpperCase())
      .filter((skill) => /^SK\d+$/i.test(skill));
    const selectedSkillIds = (state.selectedSkills || [])
      .map((skill) => skill.skill_id?.trim().toUpperCase() || '')
      .filter((skillId) => Boolean(skillId));
    const extractedSkillIds = (state.resumeAnalysis?.normalized_for_matching?.skill_ids || [])
      .map((skillId) => skillId.trim().toUpperCase())
      .filter((skillId) => Boolean(skillId));
    const fallbackSkills = skills
      .map((skill) => skill.trim().toUpperCase())
      .filter((skill) => Boolean(skill));
    const finalCandidateSkillIds = Array.from(
      new Set(
        inputSkillIds.length > 0
          ? inputSkillIds
          : selectedSkillIds.length > 0
            ? selectedSkillIds
            : extractedSkillIds.length > 0
              ? extractedSkillIds
              : fallbackSkills,
      ),
    );

    if (finalCandidateSkillIds.length === 0) return null;

    const result = await runJobMatches({
      resume_text_for_matching: resumeText,
      candidate_skill_ids: finalCandidateSkillIds,
      preferences: {
        industry: getPreferenceLabel(industryLabels, answers.industry),
        job_level: answers.role,
        work_setup: getPreferenceLabel(setupLabels, answers.setup),
        salary_expectation: getPreferenceLabel(salaryLabels, answers.salary),
        skill_to_develop: answers.skill,
      },
    });
    setMatchResults(result);
    return result;
  };

  const refreshFromResumeFile = async (file: File, answers: SurveyAnswers, overrideSkills?: string[]) => {
    setLoading(true);
    setError(null);
    try {
      const data = await analyzeResume(file, answers);
      setResumeFile(file);
      applyAnalysisResult(data);
      const extracted = extractSkillsFromResume(data.parsedResume);
      const finalSkills = (overrideSkills && overrideSkills.length > 0 ? overrideSkills : extracted.length > 0 ? extracted : skillNames).filter(Boolean);
      setSkillNames(finalSkills);
      await runMatchingWithSkills(data.parsedResume, finalSkills, answers);
      showInlineNotice('Resume and skills updated. Job matches, gaps, and recommendations were refreshed.', 'success');
      showToast('Dashboard data refreshed from updated resume.', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to refresh resume analysis.';
      setError(message);
      showToast(message, 'danger');
    } finally {
      setLoading(false);
    }
  };

  const handlePreferencesSave = async (answers: SurveyAnswers) => {
    setSurveyAnswers(answers);
    if (!state.resumeFile) {
      showInlineNotice('Preferences saved. Upload a resume to refresh recommendations.', 'warn');
      showToast('Preferences saved.', 'success');
      return;
    }
    await refreshFromResumeFile(state.resumeFile, answers);
  };

  const handleSkillRefresh = async (skills: string[]) => {
    if (!state.resume || !state.surveyAnswers) {
      showToast('Resume or preferences are missing. Upload and analyze a resume first.', 'warn');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const cleanSkills = Array.from(new Set(skills.map((skill) => skill.trim()).filter(Boolean)));
      setSkillNames(cleanSkills);
      await runMatchingWithSkills(state.resume, cleanSkills, state.surveyAnswers);
      showInlineNotice('Skills confirmed. Matches and skill-gap recommendations were refreshed.', 'success');
      showToast('Skills confirmed and matching updated.', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to refresh matching.';
      setError(message);
      showToast(message, 'danger');
    } finally {
      setLoading(false);
    }
  };

  const openJobDetails = (job: DashboardJob) => {
    setSelectedJob(job);
    setJobDetailOpen(true);
  };

  const toggleSaved = (jobId: string) => {
    const alreadySaved = savedJobs.has(jobId);
    setSavedJobs((current) => {
      const next = new Set(current);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
    showToast(alreadySaved ? 'Job removed from saved list.' : 'Job saved.', 'success');
  };

  const applyToInternalJob = (job: DashboardJob) => {
    if (job.sourceType === 'external') {
      showToast('External opportunities are link-outs only.', 'warn');
      return;
    }
    setApplications((current) => {
      const exists = current.some((app) => app.jobId === job.id && app.status !== 'Withdrawn');
      if (exists) return current;
      return [
        {
          id: `${job.id}-${Date.now()}`,
          jobId: job.id,
          jobTitle: job.title,
          company: job.company,
          matchScore: job.matchScore,
          status: 'Pending',
          dateApplied: dateTodayIso(),
          sourceType: 'internal',
        },
        ...current,
      ];
    });
    showToast('Application submitted.', 'success');
  };

  const openWithdraw = (application: DashboardApplication) => {
    setWithdrawTarget(application);
    setWithdrawModalOpen(true);
  };

  const confirmWithdraw = () => {
    if (!withdrawTarget) return;
    setApplications((current) =>
      current.map((app) => (app.id === withdrawTarget.id && ['Pending', 'Shortlisted', 'Interviewing'].includes(app.status) ? { ...app, status: 'Withdrawn' } : app)),
    );
    setWithdrawModalOpen(false);
    showToast(`${withdrawTarget.jobTitle} application withdrawn.`, 'warn');
  };

  const acceptedMessageReplyEnabled = selectedMessageState === 'Accepted';

  const acceptMessageRequest = () => {
    if (!selectedMessageApp) return;
    setMessageStates((current) => ({ ...current, [selectedMessageApp.jobId]: 'Accepted' }));
    showToast('Message request accepted. You can now reply.', 'success');
  };

  const declineMessageRequest = () => {
    if (!selectedMessageApp) return;
    setMessageStates((current) => ({ ...current, [selectedMessageApp.jobId]: 'Declined' }));
    showToast('Message request declined.', 'warn');
  };

  const ignoreMessageRequest = () => {
    if (!selectedMessageApp) return;
    setMessageStates((current) => ({ ...current, [selectedMessageApp.jobId]: 'Ignored' }));
    showToast('Message request ignored.', 'warn');
  };

  const sendMessageReply = () => {
    if (!selectedMessageApp || selectedMessageState !== 'Accepted') return;
    const text = messageDraft.trim();
    if (!text) return;
    const reply = { from: 'candidate' as const, text, time: 'Just now' };
    setMessageReplies((current) => ({ ...current, [selectedMessageApp.jobId]: [...(current[selectedMessageApp.jobId] || []), reply] }));
    setMessageDraft('');
    showToast('Message sent.', 'success');
  };

  const openResumeModal = () => {
    clearPanels();
    setResumeModalOpen(true);
    setResumeStep('upload');
    setResumeDragOver(false);
    setResumeUploadFile(null);
    setResumeAnalyzeData(null);
    setReviewSkills([]);
    setNewSkillInput('');
    setResumePostRefreshTarget('dashboard');
  };

  const handleResumeFilePick = (file: File | null) => {
    if (!file) {
      setResumeUploadFile(null);
      return;
    }
    const suffix = file.name.toLowerCase().split('.').pop();
    if (!suffix || !['pdf', 'docx'].includes(suffix)) {
      showToast('Please upload a PDF or DOCX file.', 'warn');
      return;
    }
    setResumeUploadFile(file);
  };

  const handleResumeUploadAndReview = async () => {
    if (!resumeUploadFile) {
      showToast('Please upload a resume file first.', 'warn');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const prefs = state.surveyAnswers || defaultSurveyAnswers;
      const data = await analyzeResume(resumeUploadFile, prefs);
      setResumeAnalyzeData(data);
      const extracted = extractSkillsFromResume(data.parsedResume);
      const baseline = extracted.length > 0 ? extracted : skillNames;
      const unique = Array.from(new Set(baseline.map((item) => item.trim()).filter(Boolean)));
      setReviewSkills(unique);
      setResumeStep('decision');
      showToast('Resume uploaded. Choose to review skills/preferences or apply changes directly.', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to analyze uploaded resume.';
      setError(message);
      showToast(message, 'danger');
    } finally {
      setLoading(false);
    }
  };

  const addSkillToReview = () => {
    const next = newSkillInput.trim();
    if (!next) return;
    if (reviewSkills.some((skill) => normalizeSkill(skill) === normalizeSkill(next))) return;
    setReviewSkills((current) => [...current, next]);
    setNewSkillInput('');
    showToast(`${next} added to skill list.`, 'success');
  };

  const toggleReviewSkill = (skill: string) => {
    const normalized = normalizeSkill(skill);
    if (reviewSkills.some((item) => normalizeSkill(item) === normalized)) {
      setReviewSkills((current) => current.filter((item) => normalizeSkill(item) !== normalized));
    }
  };

  const confirmSkillsAndRefresh = async () => {
    if (!resumeUploadFile || !resumeAnalyzeData) return;
    const confirmed = Array.from(new Set(reviewSkills.map((item) => item.trim()).filter(Boolean)));
    if (confirmed.length === 0) {
      showToast('Please keep at least one confirmed skill.', 'warn');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setResumeFile(resumeUploadFile);
      applyAnalysisResult(resumeAnalyzeData);
      setSkillNames(confirmed);
      const prefs = state.surveyAnswers || defaultSurveyAnswers;
      await runMatchingWithSkills(resumeAnalyzeData.parsedResume, confirmed, prefs);
      setResumeModalOpen(false);
      setResumeStep('upload');
      showInlineNotice('Resume updated. Matches, skill gaps, recommendations, and progress were refreshed.', 'success');
      if (resumePostRefreshTarget === 'preferences') {
        setActivePage('preferences');
        showToast('Skills confirmed. Preferences opened so you can review your settings.', 'success');
      } else {
        showToast('Skills confirmed and dashboard refreshed.', 'success');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to refresh after skill confirmation.';
      setError(message);
      showToast(message, 'danger');
    } finally {
      setLoading(false);
    }
  };

  const skipResumeReviewAndRefresh = async () => {
    if (!resumeUploadFile || !resumeAnalyzeData) return;
    const extracted = extractSkillsFromResume(resumeAnalyzeData.parsedResume);
    const fallback = extracted.length > 0 ? extracted : reviewSkills.length > 0 ? reviewSkills : skillNames;
    const confirmed = Array.from(new Set(fallback.map((item) => item.trim()).filter(Boolean)));
    if (confirmed.length === 0) {
      showToast('No skills were detected. Please review skills manually before refreshing.', 'warn');
      setResumeStep('review');
      setResumePostRefreshTarget('dashboard');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      setResumeFile(resumeUploadFile);
      applyAnalysisResult(resumeAnalyzeData);
      setSkillNames(confirmed);
      const prefs = state.surveyAnswers || defaultSurveyAnswers;
      await runMatchingWithSkills(resumeAnalyzeData.parsedResume, confirmed, prefs);
      setResumeModalOpen(false);
      setResumeStep('upload');
      showInlineNotice('Resume updated. Matches, skill gaps, recommendations, and progress were refreshed.', 'success');
      showToast('Resume changes applied to your dashboard.', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to refresh dashboard after resume update.';
      setError(message);
      showToast(message, 'danger');
    } finally {
      setLoading(false);
    }
  };

  const goToOnboardingSkillsAndPreferences = () => {
    if (!resumeUploadFile || !resumeAnalyzeData) {
      showToast('Please analyze a resume first.', 'warn');
      return;
    }

    const extracted = extractSkillsFromResume(resumeAnalyzeData.parsedResume);
    const preparedSkills = Array.from(new Set((extracted.length > 0 ? extracted : reviewSkills).map((item) => item.trim()).filter(Boolean)));

    setResumeFile(resumeUploadFile);
    applyAnalysisResult(resumeAnalyzeData);
    if (preparedSkills.length > 0) setSkillNames(preparedSkills);
    setResumeModalOpen(false);
    setResumeStep('upload');
    showToast('Opening onboarding so you can review skills and preferences.', 'success');
    onUpdateResume();
  };

  const handleEvidenceUpload = async (file: File | null) => {
    if (!file) return;

    const fileName = file.name.trim();
    const lowerName = fileName.toLowerCase();
    const isPdfExtension = lowerName.endsWith('.pdf');
    const isPdfMime = file.type === 'application/pdf' || file.type === '';

    if (!isPdfExtension || !isPdfMime) {
      showToast('Only PDF certificate files are accepted. Photos and non-certificate documents are blocked.', 'warn');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      showToast('Certificate file must be 5MB or smaller.', 'warn');
      return;
    }

    const suspiciousPhotoName = /(screenshot|screen shot|img[_-]?\d+|photo|selfie|camera|whatsapp image)/i.test(lowerName);
    if (suspiciousPhotoName) {
      showToast('Screenshot/photo-like filenames are blocked. Please upload the original certificate PDF.', 'warn');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const validation = await validateCertificateFile(file);

      setEvidenceRecords((current) => [
        {
          id: `ev-${Date.now()}`,
          title: fileName.replace(/\.pdf$/i, ''),
          uploadedAt: dateTodayIso(),
          status: 'Pending Verification',
        },
        ...current,
      ]);

      showToast(validation.message || 'Certificate uploaded with safeguards. Marked as Pending Verification.', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to validate certificate upload.';
      setError(message);
      showToast(message, 'danger');
    } finally {
      setLoading(false);
    }
  };

  const closeModal = () => {
    setJobDetailOpen(false);
    setWithdrawModalOpen(false);
    setDeleteModalOpen(false);
    setResumeModalOpen(false);
  };

  const hasData = jobs.length > 0 || gaps.length > 0 || courses.length > 0;

  return (
    <div className="cand-dashboard">
      <header className="cand-topbar">
        <div className="cand-topbar-left">
          <button className="cand-menu-toggle" type="button" onClick={() => setSidebarCollapsed((value) => !value)}>
            <UIIcon name="menu" />
          </button>
          <Logo size="module" onClick={onHome} />
        </div>
        <div className="cand-topbar-right">
          <div className="cand-greeting">
            Good day, <span>{displayName}</span>
          </div>
          <button className="cand-btn-update" type="button" onClick={openResumeModal}>
            <UIIcon name="upload" className="cand-btn-icon" />
            Resume Update
          </button>
          <div className="cand-notif-wrap">
            <button
              className="cand-notif-btn"
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setNotifOpen((value) => !value);
                setProfileOpen(false);
              }}
            >
              <UIIcon name="bell" />
              {unreadNotificationCount > 0 && <span className="cand-notif-badge">{unreadNotificationCount}</span>}
            </button>
            {notifOpen && (
              <div className="cand-notif-dropdown" onClick={(event) => event.stopPropagation()}>
                <div className="cand-notif-header">
                  <strong>Notifications</strong>
                  <button className="cand-mark-read-btn" type="button" onClick={markAllNotificationsRead}>
                    Mark all read
                  </button>
                </div>
                {notificationRows.length > 0 ? (
                  notificationRows.map((row) => {
                    const isUnread = row.unread && !readNotifications[row.id];
                    return (
                    <button
                      key={row.id}
                      type="button"
                      className={`cand-notif-item cand-notif-btn-row ${isUnread ? 'unread' : ''}`}
                      onClick={() => setReadNotifications((current) => ({ ...current, [row.id]: true }))}
                    >
                      <div className={`cand-notif-icon ${row.iconClass}`}>
                        <UIIcon name={row.iconName} />
                      </div>
                      <div>
                        <div className="cand-notif-text">
                          <strong>{row.title}</strong>
                          {row.message}
                        </div>
                        <div className="cand-notif-time">{row.time}</div>
                      </div>
                    </button>
                    );
                  })
                ) : (
                  <div className="cand-notif-item">
                    <div className="cand-notif-text">No notifications yet.</div>
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="cand-profile-wrap">
            <button
              className="cand-profile-menu"
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setProfileOpen((value) => !value);
                setNotifOpen(false);
              }}
            >
              <div className="cand-profile-avatar">{initials}</div>
              <UIIcon name="chevron-down" className="cand-chevron-icon text-soft" />
            </button>
            {profileOpen && (
              <div className="cand-profile-dropdown" onClick={(event) => event.stopPropagation()}>
                <div className="border-b border-bdr px-4 py-3">
                  <div className="text-sm font-bold text-dark">{displayName}</div>
                  <div className="text-xs text-soft">{displayEmail}</div>
                </div>
                <button
                  className="cand-profile-dd-item"
                  type="button"
                  onClick={() => {
                    setActivePage('account');
                    setProfileOpen(false);
                  }}
                >
                  <UIIcon name="user" className="cand-dd-icon" />
                  Account Settings
                </button>
                <button
                  className="cand-profile-dd-item"
                  type="button"
                  onClick={() => {
                    setActivePage('preferences');
                    setProfileOpen(false);
                  }}
                >
                  <UIIcon name="sliders" className="cand-dd-icon" />
                  Preferences
                </button>
                <div className="border-t border-bdr px-4 py-2 text-[10px] font-bold uppercase tracking-[0.5px] text-soft">Language</div>
                <div className="cand-lang-row">
                  <button className={`cand-lang-pill ${uiLanguage === 'en' ? 'active' : ''}`} type="button" onClick={() => setUiLanguage('en')}>
                    English
                  </button>
                  <button className={`cand-lang-pill ${uiLanguage === 'fil' ? 'active' : ''}`} type="button" onClick={() => setUiLanguage('fil')}>
                    Filipino
                  </button>
                </div>
                <div className="border-t border-bdr">
                  <button
                    className="cand-profile-dd-item"
                    type="button"
                    onClick={() => {
                      setProfileOpen(false);
                      onLogout();
                    }}
                  >
                    <UIIcon name="logout" className="cand-dd-icon" />
                    Logout
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className={`cand-main ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`} onClick={clearPanels}>
        <aside className={`cand-sidebar ${sidebarCollapsed ? 'collapsed' : ''}`} onClick={(event) => event.stopPropagation()}>
            <div className="cand-sidebar-inner">
              <div className="cand-sidebar-section">
                <div className="cand-sidebar-title">My Career</div>
                <NavItem icon="dashboard" active={activePage === 'dashboard'} onClick={() => setActivePage('dashboard')}>Dashboard</NavItem>
                <NavItem icon="briefcase" active={activePage === 'jobmatches'} onClick={() => setActivePage('jobmatches')}>Job Matches</NavItem>
                <NavItem icon="puzzle" active={activePage === 'skillgaps'} onClick={() => setActivePage('skillgaps')}>Skill Gaps</NavItem>
                <NavItem icon="layers" active={activePage === 'applications'} onClick={() => setActivePage('applications')}>Applications</NavItem>
                <NavItem icon="sliders" active={activePage === 'preferences'} onClick={() => setActivePage('preferences')}>Preferences</NavItem>
                <NavItem icon="user" active={activePage === 'account'} onClick={() => setActivePage('account')}>Account Settings</NavItem>
              </div>
              <div className="cand-sidebar-section border-t border-bdr pt-5">
                <div className="cand-sidebar-title">Explore</div>
                <NavItem icon="compass" active={activePage === 'kareers'} onClick={() => setActivePage('kareers')}>Kareers</NavItem>
                <NavItem icon="graduation" active={activePage === 'upskilling'} onClick={() => setActivePage('upskilling')}>Upskilling Path</NavItem>
                <button className={`cand-nav-item ${activePage === 'messages' ? 'active' : ''}`} type="button" onClick={() => setActivePage('messages')}>
                  <UIIcon name="message" className="cand-nav-icon" />
                  Messages
                  {eligibleMessageApps.length > 0 && <span className="cand-nav-badge">{eligibleMessageApps.length}</span>}
                </button>
              </div>
            </div>
            <div className="cand-sidebar-bottom">
              <button className="cand-profile-card" type="button" onClick={() => setActivePage('account')}>
                <div className="cand-profile-avatar">{initials}</div>
                <div className="text-left">
                  <div className="text-[13px] font-bold text-dark">{displayName}</div>
                  <div className="cand-profile-location"><UIIcon name="location" className="cand-profile-location-icon" />Metro Manila</div>
                </div>
                <UIIcon name="sliders" className="cand-profile-setting-icon" />
              </button>
            </div>
          </aside>

        <main className={`cand-content ${sidebarCollapsed ? 'expanded' : ''}`}>
          {inlineNotice && (
            <div className={`cand-notice ${inlineNotice.type === 'danger' ? 'error' : inlineNotice.type === 'warn' ? 'warn' : 'info'}`}>
              <span>{inlineNotice.message}</span>
            </div>
          )}
          {state.error && (
            <div className="cand-notice error">
              <span>{state.error}</span>
            </div>
          )}

          {activePage === 'dashboard' && (
            <DashboardOverview
              hasData={hasData}
              metrics={metricCards}
              categoryProgress={categoryProgress}
              topJobHighlights={topJobHighlights}
              recentApplications={recentApplications}
              topMissingSkills={topMissingSkills}
              recommendedSteps={recommendedSteps}
              courseRecommendations={courseRecommendations}
              onOpenMatches={() => setActivePage('jobmatches')}
              onOpenApplications={() => setActivePage('applications')}
              onOpenGaps={() => setActivePage('skillgaps')}
              onOpenUpskilling={() => setActivePage('upskilling')}
              onOpenMessages={() => setActivePage('messages')}
            />
          )}

          {activePage === 'jobmatches' && (
            <JobMatchesPage
              jobs={filteredJobs}
              allMatchesCount={topAllMatchesCount}
              jobSearch={jobSearch}
              jobFilter={jobFilter}
              savedJobs={savedJobs}
              fitNowCount={topFitNowMatchesCount}
              aspirationCount={topAspirationMatchesCount}
              onSearch={setJobSearch}
              onFilter={setJobFilter}
              onSave={toggleSaved}
              onApply={applyToInternalJob}
              onView={openJobDetails}
              onVisitSite={(job) => {
                const fallbackQuery = encodeURIComponent(`${job.title} ${job.company} jobs`);
                const targetUrl = job.externalUrl || `https://www.google.com/search?q=${fallbackQuery}`;
                window.open(targetUrl, '_blank', 'noopener,noreferrer');
                showToast('Opening external opportunity in a new tab.', 'success');
              }}
            />
          )}

          {activePage === 'skillgaps' && (
            <SkillGapsPage
              gaps={gaps}
              jobs={jobs}
              categoryProgress={categoryProgress}
              onOpenUpskilling={() => setActivePage('upskilling')}
              onOpenResume={openResumeModal}
            />
          )}

          {activePage === 'applications' && (
            <ApplicationsPage
              applications={applications}
              jobs={jobs}
              onViewJob={(application) => {
                const job = jobs.find((item) => item.id === application.jobId);
                if (job) openJobDetails(job);
              }}
              onWithdraw={openWithdraw}
              onOpenMessages={() => setActivePage('messages')}
            />
          )}

          {activePage === 'preferences' && (
            <PreferencesPage
              surveyAnswers={surveyAnswers}
              extraPreferences={extraPreferences}
              skillNames={skillNames}
              isLoading={state.isLoading}
              onUpdateExtra={setExtraPreferences}
              onUpdateSkills={setSkillNames}
              onSave={handlePreferencesSave}
              onReset={() => {
                setSurveyAnswers(defaultSurveyAnswers);
                setExtraPreferences({ jobLevel: 'Entry Level', preferredLocation: 'Metro Manila / Laguna' });
                showToast('Changes reset.', 'success');
              }}
              onRefreshSkills={() => void handleSkillRefresh(skillNames)}
            />
          )}

          {activePage === 'account' && (
            <AccountSettingsPage
              user={{ name: displayName, email: displayEmail }}
              uiLanguage={uiLanguage}
              evidenceRecords={evidenceRecords}
              onLanguage={setUiLanguage}
              onOpenDelete={() => setDeleteModalOpen(true)}
              onOpenResume={openResumeModal}
              onUploadEvidence={handleEvidenceUpload}
              onSave={() => showToast('Account details saved.', 'success')}
            />
          )}

          {activePage === 'kareers' && (
            <KareersPage
              kareers={kareersList}
              selectedId={selectedKareerId}
              selected={selectedKareer}
              savedJobs={savedJobs}
              onSelect={setSelectedKareerId}
              onOpenMatches={() => setActivePage('jobmatches')}
              onOpenUpskilling={() => setActivePage('upskilling')}
            />
          )}

          {activePage === 'upskilling' && (
            <UpskillingPage
              tab={upskillTab}
              courses={courses}
              categoryProgress={categoryProgress}
              groupedCoursesByGap={groupedCoursesByGap}
              recommended={recommendedCourses}
              inProgress={inProgressCourses}
              completed={completedCourses}
              onTab={setUpskillTab}
              onStart={(course) => {
                setStartedCourseIds((current) => new Set([...Array.from(current), course.id]));
                showToast(`Marked ${course.title} as in progress.`, 'success');
              }}
              onComplete={(course) => {
                setCompletedCourseIds((current) => new Set([...Array.from(current), course.id]));
                showToast(`${course.title} marked completed.`, 'success');
              }}
              onViewCourse={(course) => {
                if (course.url) window.open(course.url, '_blank', 'noopener,noreferrer');
                else showToast(`Opening ${course.provider} learning page...`, 'success');
              }}
            />
          )}

          {activePage === 'messages' && (
            <MessagesPage
              applications={eligibleMessageApps}
              selectedJobId={selectedThreadJobId}
              requestStates={messageStates}
              requestTexts={messageRequests}
              replies={messageReplies}
              draft={messageDraft}
              onSelect={setSelectedThreadJobId}
              onAccept={acceptMessageRequest}
              onDecline={declineMessageRequest}
              onIgnore={ignoreMessageRequest}
              onDraftChange={setMessageDraft}
              onSend={sendMessageReply}
              canReply={acceptedMessageReplyEnabled}
            />
          )}
        </main>
      </div>

      {jobDetailOpen && selectedJob && (
        <JobDetailModal
          job={selectedJob}
          onClose={() => setJobDetailOpen(false)}
          onApply={() => {
            applyToInternalJob(selectedJob);
            setJobDetailOpen(false);
          }}
          onSave={() => toggleSaved(selectedJob.id)}
          isSaved={savedJobs.has(selectedJob.id)}
        />
      )}

      {resumeModalOpen && (
        <ResumeUpdateModal
          step={resumeStep}
          postRefreshTarget={resumePostRefreshTarget}
          dragOver={resumeDragOver}
          file={resumeUploadFile}
          reviewSkills={reviewSkills}
          skillInput={newSkillInput}
          loading={state.isLoading}
          onClose={() => setResumeModalOpen(false)}
          onDragOver={setResumeDragOver}
          onPickFile={handleResumeFilePick}
          onProcess={handleResumeUploadAndReview}
          onBack={() => setResumeStep((current) => (current === 'review' ? 'decision' : 'upload'))}
          onReviewPreferencesPath={goToOnboardingSkillsAndPreferences}
          onSkip={skipResumeReviewAndRefresh}
          onConfirm={confirmSkillsAndRefresh}
          onSkillInput={setNewSkillInput}
          onAddSkill={addSkillToReview}
          onRemoveSkill={toggleReviewSkill}
        />
      )}

      {withdrawModalOpen && withdrawTarget && (
        <ConfirmModal
          title="Withdraw Application?"
          description={`This will remove your application for ${withdrawTarget.jobTitle} from active employer review. This action cannot be undone.`}
          danger
          onCancel={() => setWithdrawModalOpen(false)}
          onConfirm={confirmWithdraw}
          confirmLabel="Confirm Withdrawal"
        />
      )}

      {deleteModalOpen && (
        <ConfirmModal
          title="Delete Profile"
          description="Deleting your profile will remove your candidate account and related candidate records from Kareerly where applicable. This action may affect your saved matches, applications, and progress records."
          footnote="This is a deletion request. A confirmation email will be sent before any account data is removed."
          danger
          onCancel={() => setDeleteModalOpen(false)}
          onConfirm={() => {
            setDeleteModalOpen(false);
            showToast('Profile deletion request submitted. Confirmation email sent.', 'success');
          }}
          confirmLabel="Request Profile Deletion"
        />
      )}

      {toast && <div className={`cand-toast ${toast.type}`}>{toast.message}</div>}

      {(jobDetailOpen || resumeModalOpen || withdrawModalOpen || deleteModalOpen) && (
        <button type="button" className="fixed inset-0 z-[450] h-0 w-0 opacity-0" aria-label="close modal by background" onClick={closeModal} />
      )}
    </div>
  );
}

function buildNotificationRows(jobs: DashboardJob[], applications: DashboardApplication[]) {
  const rows: Array<{
    id: string;
    iconClass: string;
    iconName: IconName;
    title: string;
    message: string;
    time: string;
    unread: boolean;
  }> = [];
  if (jobs.length > 0) {
    rows.push({
      id: 'match',
      iconClass: 'match',
      iconName: 'briefcase',
      title: `${Math.min(3, jobs.length)} new job matches found`,
      message: 'Your profile has updated role opportunities in Data & Analytics.',
      time: '2 hours ago',
      unread: true,
    });
  }
  const interviewing = applications.find((app) => app.status === 'Interviewing');
  if (interviewing) {
    rows.push({
      id: 'msg',
      iconClass: 'msg',
      iconName: 'message',
      title: 'Interview message request',
      message: `${interviewing.company} sent a message request.`,
      time: '4 hours ago',
      unread: true,
    });
  }
  const shortlisted = applications.find((app) => app.status === 'Shortlisted');
  if (shortlisted) {
    rows.push({
      id: 'app',
      iconClass: 'app',
      iconName: 'layers',
      title: 'Application shortlisted',
      message: `${shortlisted.jobTitle} moved to Shortlisted.`,
      time: 'Yesterday',
      unread: true,
    });
  }
  if (jobs.length > 0) {
    rows.push({
      id: 'resume',
      iconClass: 'resume',
      iconName: 'check-circle',
      title: 'Resume processed',
      message: 'Detected skills were refreshed from your latest resume analysis.',
      time: '2 days ago',
      unread: false,
    });
  }
  return rows;
}

function NavItem({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: IconName; children: ReactNode }) {
  return (
    <button className={`cand-nav-item ${active ? 'active' : ''}`} type="button" onClick={onClick}>
      <UIIcon name={icon} className="cand-nav-icon" />
      <span>{children}</span>
    </button>
  );
}

function DashboardOverview({
  hasData,
  metrics,
  categoryProgress,
  topJobHighlights,
  recentApplications,
  topMissingSkills,
  recommendedSteps,
  courseRecommendations,
  onOpenMatches,
  onOpenApplications,
  onOpenGaps,
  onOpenUpskilling,
  onOpenMessages,
}: {
  hasData: boolean;
  metrics: Array<{ label: string; value: string; detail: string; iconClass: string; valueColor: string; icon: IconName }>;
  categoryProgress: Array<{ category: SkillCategory; percent: number; missing: number; matched: number; completed: number }>;
  topJobHighlights: DashboardJob[];
  recentApplications: DashboardApplication[];
  topMissingSkills: DashboardGap[];
  recommendedSteps: string[];
  courseRecommendations: DashboardCourse[];
  onOpenMatches: () => void;
  onOpenApplications: () => void;
  onOpenGaps: () => void;
  onOpenUpskilling: () => void;
  onOpenMessages: () => void;
}) {
  const summaryTabs = [
    { id: 'progress', label: 'Progress', icon: 'chart' },
    { id: 'matches', label: 'Job Highlights', icon: 'briefcase' },
    { id: 'gaps', label: 'Missing Skills', icon: 'lightbulb' },
    { id: 'applications', label: 'Applications', icon: 'clock' },
    { id: 'steps', label: 'Next Steps', icon: 'list' },
    { id: 'upskilling', label: 'Upskilling', icon: 'book' },
  ] as const;
  type SummaryTab = (typeof summaryTabs)[number]['id'];
  const [activeSummaryTab, setActiveSummaryTab] = useState<SummaryTab>('progress');

  return (
    <div>
      <div className="cand-page-header">
        <h1 className="cand-page-title">Career Overview</h1>
        <p className="cand-page-subtitle">Your personalized career guidance workspace powered by Kareerly</p>
      </div>

      <div className="cand-metrics-grid">
        {metrics.map((metric) => (
          <div key={metric.label} className="cand-metric-card">
            <div className={`cand-metric-icon ${metric.iconClass}`}>
              <UIIcon name={metric.icon} />
            </div>
            <div className="cand-metric-num" style={{ color: metric.valueColor }}>
              {metric.value}
            </div>
            <div className="cand-metric-label">{metric.label}</div>
            <div className="mt-1 text-[11px] text-soft">{metric.detail}</div>
          </div>
        ))}
      </div>

      {!hasData && (
        <div className="mb-4 rounded-lg border border-bdr bg-bg p-3 text-sm text-soft">
          Upload and analyze a resume to generate your dashboard overview.
        </div>
      )}

      <div className="cand-tab-row">
        {summaryTabs.map((tab) => (
          <button
            key={tab.id}
            className={`cand-tab-btn ${activeSummaryTab === tab.id ? 'active' : ''}`}
            type="button"
            onClick={() => setActiveSummaryTab(tab.id)}
          >
            <span className="inline-flex items-center gap-1.5">
              <UIIcon name={tab.icon} className="cand-tab-icon" />
              <span>{tab.label}</span>
            </span>
          </button>
        ))}
      </div>

      {activeSummaryTab === 'progress' && (
        <div className="cand-card mb-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="cand-card-title mb-0"><UIIcon name="chart" className="cand-title-icon" />Skill Development Progress</h2>
            <button className="cand-btn-secondary cand-btn-sm" type="button" onClick={onOpenGaps}>
              View Full Progress
            </button>
          </div>
          {categoryProgress.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2">
              {categoryProgress.map((row) => {
                const status = categoryStatus(row.percent);
                return (
                  <div key={row.category}>
                    <div className="cand-sdp-row">
                      <span className="cand-sdp-label">{row.category}</span>
                      <div className="cand-sdp-bar-wrap">
                        <div className="cand-sdp-bar-fill" style={{ width: `${row.percent}%`, background: categoryBarColor(row.category) }} />
                      </div>
                      <span className="cand-sdp-pct">{row.percent}%</span>
                      <span className={status.className}>{status.label}</span>
                    </div>
                    <div className="mt-1 text-[11px] text-soft">{status.interpretation}</div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="cand-empty">No progress data yet. Upload a resume and generate matches first.</div>
          )}
          <div className="cand-sdp-disclaimer">
            Skill Development Progress is a career-guidance indicator only, not formal skill verification, credential authentication, or a job-readiness guarantee.
          </div>
        </div>
      )}

      {activeSummaryTab === 'matches' && (
        <div className="cand-card mb-6">
          <h2 className="cand-card-title"><UIIcon name="briefcase" className="cand-title-icon" />Top Job Match Highlights</h2>
          {topJobHighlights.length > 0 ? (
            <>
              {topJobHighlights.map((job) => (
                <div key={job.id} className="cand-match-preview">
                  <div>
                    <div className="text-sm font-bold text-dark">{job.title}</div>
                    <div className="cand-job-meta-row">
                      <span><UIIcon name="building" className="cand-mini-icon" />{job.company}</span>
                      <span><UIIcon name="location" className="cand-mini-icon" />{job.location}</span>
                      <span><UIIcon name="setup" className="cand-mini-icon" />{job.setup}</span>
                      <span className={`cand-type-tag ${job.sourceType === 'internal' ? 'cand-type-internal' : 'cand-type-external'}`}>{job.sourceType === 'internal' ? 'Internal' : 'External'}</span>
                    </div>
                    <div className="cand-badge-row">
                      {job.category && <span className="cand-job-badge">{job.category}</span>}
                      {job.subCategory && <span className="cand-job-badge tan">{job.subCategory}</span>}
                      {job.jobLevel && <span className="cand-job-badge amber">{job.jobLevel}</span>}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="cand-match-badge" style={{ background: getMatchScoreColor(job) }}>
                      {getMatchScoreBadge(job)}
                    </div>
                    <span className={`cand-match-cat ${job.matchCategory === 'fit-now' ? 'cand-cat-fit' : 'cand-cat-aspiration'}`}>
                      {job.matchCategory === 'fit-now' ? 'Fit Now' : 'Aspiration'}
                    </span>
                  </div>
                </div>
              ))}
              <button className="cand-btn-secondary mt-4 w-full justify-center" type="button" onClick={onOpenMatches}>
                View All Job Matches
              </button>
            </>
          ) : (
            <div className="cand-empty">No match highlights available yet.</div>
          )}
        </div>
      )}

      {activeSummaryTab === 'applications' && (
        <div className="cand-card mb-6">
          <h2 className="cand-card-title"><UIIcon name="clock" className="cand-title-icon" />Recent Application Updates</h2>
          {recentApplications.length > 0 ? (
            <>
              {recentApplications.map((app) => (
                <div key={app.id} className="flex items-center justify-between border-b border-bdr py-3 last:border-b-0">
                  <div>
                    <div className="text-sm font-bold text-dark">{app.jobTitle}</div>
                    <div className="text-xs text-soft">
                      {app.company} · Applied {formatDateLabel(app.dateApplied)}
                    </div>
                  </div>
                  <StatusBadge status={app.status} />
                </div>
              ))}
              <button className="cand-btn-secondary mt-4 w-full justify-center" type="button" onClick={onOpenApplications}>
                Track All Applications
              </button>
            </>
          ) : (
            <div className="cand-empty">No applications yet. Apply to internal matches to start tracking.</div>
          )}
        </div>
      )}

      {activeSummaryTab === 'gaps' && (
        <div className="cand-card mb-6">
          <h2 className="cand-card-title"><UIIcon name="lightbulb" className="cand-title-icon" />Top Missing Skills</h2>
          {topMissingSkills.length > 0 ? (
            <>
              {topMissingSkills.map((gap) => (
                <div key={gap.skill} className="flex items-center justify-between border-b border-bdr py-3 last:border-b-0">
                  <div>
                    <div className="text-sm font-bold text-dark">{gap.skill}</div>
                    <div className="text-xs text-soft">{gap.affectedCount} job matches affected</div>
                  </div>
                  <span className={`cand-gap-priority ${severityClass(gap.severity)}`}>{gap.severity}</span>
                </div>
              ))}
              <button className="cand-btn-secondary mt-4 w-full justify-center" type="button" onClick={onOpenGaps}>
                View All Skill Gaps
              </button>
            </>
          ) : (
            <div className="cand-empty">No skill gaps found yet.</div>
          )}
        </div>
      )}

      {activeSummaryTab === 'steps' && (
        <div className="cand-card mb-6">
          <h2 className="cand-card-title"><UIIcon name="list" className="cand-title-icon" />Recommended Next Steps</h2>
          <div className="space-y-3 text-sm text-mid">
            {recommendedSteps.map((step, idx) => (
              <div key={step} className="flex gap-2">
                <span className="mt-[2px] inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-rust text-[10px] font-extrabold text-white">
                  {idx + 1}
                </span>
                <span>{step}</span>
              </div>
            ))}
          </div>
          {recentApplications.some((app) => app.status === 'Interviewing') && (
            <button className="cand-btn-secondary mt-4 w-full justify-center" type="button" onClick={onOpenMessages}>
              Open Messages
            </button>
          )}
        </div>
      )}

      {activeSummaryTab === 'upskilling' && (
        <div className="cand-card mb-6">
          <h2 className="cand-card-title"><UIIcon name="book" className="cand-title-icon" />Recommended Upskilling Path</h2>
          {courseRecommendations.length > 0 ? (
            <>
              {courseRecommendations.map((course) => (
                <div key={course.id} className="flex items-center justify-between border-b border-bdr py-3 last:border-b-0">
                  <div>
                    <div className="text-sm font-bold text-dark">{course.title}</div>
                    <div className="text-xs text-soft">{course.provider} · {course.duration}</div>
                  </div>
                  <span className={`cand-pill ${course.isFree ? 'free' : 'paid'}`}>{course.isFree ? 'Free' : 'Paid'}</span>
                </div>
              ))}
              <button className="cand-btn-secondary mt-4 w-full justify-center" type="button" onClick={onOpenUpskilling}>
                View Full Path
              </button>
            </>
          ) : (
            <div className="cand-empty">No course recommendations available yet.</div>
          )}
        </div>
      )}
    </div>
  );
}

function JobMatchesPage({
  jobs,
  allMatchesCount,
  jobSearch,
  jobFilter,
  savedJobs,
  fitNowCount,
  aspirationCount,
  onSearch,
  onFilter,
  onSave,
  onApply,
  onView,
  onVisitSite,
}: {
  jobs: DashboardJob[];
  allMatchesCount: number;
  jobSearch: string;
  jobFilter: JobFilter;
  savedJobs: Set<string>;
  fitNowCount: number;
  aspirationCount: number;
  onSearch: (value: string) => void;
  onFilter: (value: JobFilter) => void;
  onSave: (jobId: string) => void;
  onApply: (job: DashboardJob) => void;
  onView: (job: DashboardJob) => void;
  onVisitSite: (job: DashboardJob) => void;
}) {
  const fitNowJobs = jobs.filter((job) => job.matchCategory === 'fit-now');
  const aspirationJobs = jobs.filter((job) => job.matchCategory === 'aspiration');
  const topFitNowJobs = fitNowJobs.slice(0, TOP_MATCHES_PER_CATEGORY);
  const topAspirationJobs = aspirationJobs.slice(0, TOP_MATCHES_PER_CATEGORY);

  const groupedSections =
    jobFilter === 'fit-now'
      ? [{ key: 'fit-now', title: 'Fit-Now Matches', icon: 'check-circle' as IconName, items: topFitNowJobs }]
      : jobFilter === 'aspiration'
        ? [{ key: 'aspiration', title: 'Aspiration Matches', icon: 'rocket' as IconName, items: topAspirationJobs }]
        : [
            { key: 'fit-now', title: 'Fit-Now Matches', icon: 'check-circle' as IconName, items: topFitNowJobs },
            { key: 'aspiration', title: 'Aspiration Matches', icon: 'rocket' as IconName, items: topAspirationJobs },
          ];

  const renderJobCard = (job: DashboardJob) => (
    <div key={job.id} className="cand-job-card">
      <div className="cand-job-top">
        <div className="cand-job-left">
          <div className="cand-job-icon" style={{ background: getMatchScoreColor(job) }}>
            {compactCompanyBadge(job.company)}
          </div>
          <div>
            <div className="cand-job-title">
              {job.title}
              <span className={`cand-type-tag ${job.sourceType === 'internal' ? 'cand-type-internal' : 'cand-type-external'}`}>
                {job.sourceType === 'internal' ? 'Internal' : 'External'}
              </span>
            </div>
            <div className="cand-job-meta-row">
              <span><UIIcon name="building" className="cand-mini-icon" />{job.company}</span>
              <span><UIIcon name="location" className="cand-mini-icon" />{job.location}</span>
              <span><UIIcon name="setup" className="cand-mini-icon" />{job.setup}</span>
            </div>
            <div className="cand-badge-row">
              {job.category && <span className="cand-job-badge">{job.category}</span>}
              {job.subCategory && <span className="cand-job-badge tan">{job.subCategory}</span>}
              {job.jobLevel && <span className="cand-job-badge amber">{job.jobLevel}</span>}
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="cand-match-badge" style={{ background: getMatchScoreColor(job) }}>
            {getMatchScoreBadge(job)}
          </div>
          <div>
            <span className={`cand-match-cat ${job.matchCategory === 'fit-now' ? 'cand-cat-fit' : 'cand-cat-aspiration'}`}>
              {job.matchCategory === 'fit-now' ? 'Fit Now' : 'Aspiration'}
            </span>
          </div>
        </div>
      </div>

      <p className="cand-job-desc-preview">{job.explanation}</p>

      <div className="cand-skill-row">
        {job.matchedSkills.slice(0, 6).map((skill) => (
          <span key={`${job.id}-match-${skill}`} className="cand-skill-match">
            <UIIcon name="check-circle" className="cand-chip-icon" /> {skill}
          </span>
        ))}
        {job.missingSkills.slice(0, 6).map((skill) => (
          <span key={`${job.id}-missing-${skill}`} className="cand-skill-miss">
            {skill}
          </span>
        ))}
      </div>

      <div className="cand-explain"><UIIcon name="lightbulb" className="cand-inline-info-icon" />{job.explanation}</div>

      <div className="cand-actions">
        {job.sourceType === 'internal' ? (
          <>
            <button className="cand-btn-primary" type="button" onClick={() => onApply(job)}>
              <UIIcon name="paper-plane" className="cand-btn-icon" />Apply
            </button>
            <button className="cand-btn-secondary" type="button" onClick={() => onView(job)}>
              <UIIcon name="eye" className="cand-btn-icon" />View Details
            </button>
            <button className="cand-btn-secondary" type="button" onClick={() => onSave(job.id)}>
              <UIIcon name="bookmark" className="cand-btn-icon" />{savedJobs.has(job.id) ? 'Saved' : 'Save'}
            </button>
          </>
        ) : (
          <>
            <button className="cand-btn-secondary" type="button" onClick={() => onVisitSite(job)}>
              <UIIcon name="external" className="cand-btn-icon" />Visit Job Site
            </button>
            <button className="cand-btn-secondary" type="button" onClick={() => onSave(job.id)}>
              <UIIcon name="bookmark" className="cand-btn-icon" />{savedJobs.has(job.id) ? 'Saved' : 'Save'}
            </button>
          </>
        )}
      </div>
    </div>
  );

  return (
    <div>
      <div className="cand-sticky-controls">
        <div className="cand-page-header cand-page-header-inline">
          <h1 className="cand-page-title">Job Matches</h1>
          <p className="cand-page-subtitle">Jobs recommended based on your resume, confirmed skills, and career preferences</p>
        </div>

        <div className="cand-search-row">
          <div className="cand-search-box">
            <UIIcon name="search" className="cand-search-icon" />
            <input value={jobSearch} onChange={(event) => onSearch(event.target.value)} placeholder="Search by job title, company, or skill..." />
          </div>
        </div>

        <div className="cand-tab-row">
          <FilterTab active={jobFilter === 'all'} onClick={() => onFilter('all')}>All Matches ({allMatchesCount})</FilterTab>
          <FilterTab active={jobFilter === 'fit-now'} onClick={() => onFilter('fit-now')}><UIIcon name="check-circle" className="cand-tab-icon green" />Fit-Now ({fitNowCount})</FilterTab>
          <FilterTab active={jobFilter === 'aspiration'} onClick={() => onFilter('aspiration')}><UIIcon name="rocket" className="cand-tab-icon mauve" />Aspiration ({aspirationCount})</FilterTab>
        </div>
      </div>

      {jobs.length > 0 ? (
        <div className={`cand-match-groups ${groupedSections.length === 1 ? 'single' : 'dual'}`}>
          {groupedSections.map((section) => (
            <div key={section.key} className="cand-card cand-match-group-card">
              <div className="cand-match-group-head">
                <h2 className="cand-card-title mb-0">
                  <UIIcon name={section.icon} className="cand-title-icon" />
                  {section.title}
                </h2>
                <span className={`cand-match-group-count ${section.key === 'fit-now' ? 'fit' : 'aspiration'}`}>
                  {section.items.length}
                </span>
              </div>
              <div className="cand-match-group-scroll">
                {section.items.length > 0 ? (
                  section.items.map((job) => renderJobCard(job))
                ) : (
                  <div className="cand-empty">No {section.key === 'fit-now' ? 'fit-now' : 'aspiration'} matches found for your current filters/search.</div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="cand-empty">No matches found for your current filters/search.</div>
      )}
    </div>
  );
}

function FilterTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button className={`cand-tab-btn ${active ? 'active' : ''}`} type="button" onClick={onClick}>
      {children}
    </button>
  );
}

function SkillGapsPage({
  gaps,
  jobs,
  categoryProgress,
  onOpenUpskilling,
  onOpenResume,
}: {
  gaps: DashboardGap[];
  jobs: DashboardJob[];
  categoryProgress: Array<{ category: SkillCategory; percent: number; missing: number; matched: number; completed: number }>;
  onOpenUpskilling: () => void;
  onOpenResume: () => void;
}) {
  const sortedCategories = useMemo(
    () => categoryProgress.slice().sort((a, b) => a.percent - b.percent),
    [categoryProgress],
  );
  const [showCovered, setShowCovered] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<SkillCategory>(sortedCategories[0]?.category || 'Data Engineering');

  useEffect(() => {
    if (sortedCategories.length === 0) return;
    if (!sortedCategories.some((row) => row.category === selectedCategory)) {
      setSelectedCategory(sortedCategories[0].category);
    }
  }, [selectedCategory, sortedCategories]);

  const coveredByCategory = useMemo(() => {
    const map = new Map<SkillCategory, string[]>();
    jobs.forEach((job) => {
      job.matchedSkills.forEach((skill) => {
        const category = classifySkillCategory(skill);
        const list = map.get(category) || [];
        if (!list.some((item) => normalizeSkill(item) === normalizeSkill(skill))) list.push(skill);
        map.set(category, list);
      });
    });
    return map;
  }, [jobs]);

  const missingByCategory = useMemo(() => {
    const map = new Map<SkillCategory, string[]>();
    gaps.forEach((gap) => {
      const list = map.get(gap.category) || [];
      if (!list.some((item) => normalizeSkill(item) === normalizeSkill(gap.skill))) list.push(gap.skill);
      map.set(gap.category, list);
    });
    return map;
  }, [gaps]);

  const critical = gaps.filter((gap) => gap.severity === 'Critical');
  const high = gaps.filter((gap) => gap.severity === 'High');
  const moderate = gaps.filter((gap) => gap.severity === 'Moderate');
  const totalCoveredSkills = Array.from(coveredByCategory.values()).reduce((sum, skills) => sum + skills.length, 0);
  const selectedCategoryRow = categoryProgress.find((row) => row.category === selectedCategory) || null;
  const selectedMissing = missingByCategory.get(selectedCategory) || [];
  const selectedCovered = coveredByCategory.get(selectedCategory) || [];
  const selectedStatus = selectedCategoryRow ? categoryStatus(selectedCategoryRow.percent) : null;

  return (
    <div>
      <div className="cand-page-header">
        <h1 className="cand-page-title">Skill Gaps & Development Progress</h1>
        <p className="cand-page-subtitle">Missing skills identified from your job matches with guided development tracking</p>
      </div>

      <div className="cand-gap-summary-row">
        <SummaryCounter label="Critical Gaps" value={critical.length} color="var(--red)" />
        <SummaryCounter label="High Priority" value={high.length} color="var(--amber)" />
        <SummaryCounter label="Moderate Gaps" value={moderate.length} color="var(--mauve)" />
        <button className="cand-gap-summary-card cand-summary-action" type="button" onClick={() => setShowCovered((value) => !value)}>
          <div className="cand-gap-summary-num" style={{ color: 'var(--green)' }}>{totalCoveredSkills}</div>
          <div className="cand-gap-summary-label">Skills Covered</div>
          <div className="cand-summary-link">{showCovered ? 'Hide' : 'View all'}</div>
        </button>
      </div>

      {showCovered && (
        <div className="cand-covered-panel">
          {sortedCategories.length > 0 ? (
            sortedCategories.map((row) => {
              const covered = coveredByCategory.get(row.category) || [];
              return (
                <div key={`covered-${row.category}`} className="cand-covered-group">
                  <div className="cand-covered-title">{row.category}</div>
                  <div className="cand-covered-chips">
                    {covered.length > 0 ? covered.map((skill) => (
                      <span key={`${row.category}-${skill}`} className="cand-covered-chip">
                        <UIIcon name="check-circle" className="cand-covered-icon" />
                        {skill}
                      </span>
                    )) : <span className="cand-covered-empty">No covered skills yet.</span>}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="cand-empty">No covered skills yet. Confirm skills from your resume to populate this panel.</div>
          )}
        </div>
      )}

      <h2 className="cand-card-title mb-3"><UIIcon name="columns" className="cand-title-icon" />Skill Gap Board</h2>
      <div className="cand-gap-kanban">
        {[
          { key: 'critical', title: 'Critical', icon: 'shield' as IconName, items: critical },
          { key: 'high', title: 'High Priority', icon: 'lightbulb' as IconName, items: high },
          { key: 'moderate', title: 'Moderate', icon: 'list' as IconName, items: moderate },
        ].map((column) => (
          <div key={column.key} className="cand-gap-col">
            <div className={`cand-gap-col-head ${column.key}`}>
              <UIIcon name={column.icon} className="cand-gap-col-icon" />
              {column.title}
              <span className="cand-gap-col-count">{column.items.length}</span>
            </div>
            <div className="cand-gap-col-body">
              {column.items.length > 0 ? column.items.map((gap) => {
                const gapProgress = categoryProgress.find((row) => row.category === gap.category)?.percent || 0;
                const gapStatus = categoryStatus(gapProgress);
                return (
                  <div key={`${column.key}-${gap.skill}`} className="cand-gap-k-card">
                    <div className="cand-gap-top">
                      <span className="cand-gap-name">{gap.skill}</span>
                      <span className={`cand-gap-priority ${severityClass(gap.severity)}`}>{gap.severity}</span>
                    </div>
                    <div className="cand-gap-meta">
                      <span><UIIcon name="briefcase" className="cand-mini-icon" />{gap.affectedCount} job matches affected</span>
                      <span><UIIcon name="target" className="cand-mini-icon" />{gap.category}</span>
                    </div>
                    <div className="cand-gap-progress">
                      <div className="cand-gap-progress-bar">
                        <div className="cand-gap-progress-fill" style={{ width: `${gapProgress}%`, background: categoryBarColor(gap.category) }} />
                      </div>
                      <span className="cand-gap-progress-text">{gapProgress}%</span>
                      <span className={gapStatus.className}>{gapStatus.label}</span>
                    </div>
                    <div className="mt-1 text-[11px] text-soft">{gapStatus.interpretation}</div>
                    <div className="cand-gap-jobs">
                      {(gap.relatedJobs.length > 0 ? gap.relatedJobs : ['Related job roles']).map((jobTitle) => (
                        <span key={`${gap.skill}-${jobTitle}`} className="cand-gap-chip">{jobTitle}</span>
                      ))}
                    </div>
                    <button className="cand-gap-resource" type="button" onClick={onOpenUpskilling}>
                      <UIIcon name="graduation" className="cand-btn-icon" />View {gap.skill} learning resources
                    </button>
                  </div>
                );
              }) : <div className="cand-gap-empty">No items in this column.</div>}
            </div>
          </div>
        ))}
      </div>

      <h2 className="cand-card-title mb-2"><UIIcon name="chart" className="cand-title-icon" />Skill Development Progress by Category</h2>
      <p className="mb-3 text-xs text-soft">
        Progress is a career-guidance indicator only, not formal skill verification, credential authentication, or employment guarantee.
      </p>

      <div className="cand-sdp-dual">
        <div className="cand-sdp-list">
          <div className="cand-sdp-list-head">Categories & Progress</div>
          {sortedCategories.length > 0 ? sortedCategories.map((row) => {
            const rowStatus = categoryStatus(row.percent);
            return (
              <button key={`sdp-row-${row.category}`} type="button" className={`cand-sdp-row-item ${selectedCategory === row.category ? 'active' : ''}`} onClick={() => setSelectedCategory(row.category)}>
                  <div className="cand-sdp-row-left">
                    <div className="cand-sdp-row-name">{row.category}</div>
                    <div className={rowStatus.className}>{rowStatus.label}</div>
                    <div className="mt-1 text-[11px] text-soft">{rowStatus.interpretation}</div>
                    <div className="cand-sdp-mini-bar">
                      <div className="cand-sdp-mini-fill" style={{ width: `${row.percent}%`, background: categoryBarColor(row.category) }} />
                    </div>
                  </div>
                <div className="cand-sdp-row-right">
                  <div className="cand-sdp-row-pct">{row.percent}%</div>
                  <div className="cand-sdp-row-counts">{row.missing} missing · {row.matched} covered</div>
                </div>
              </button>
            );
          }) : <div className="cand-gap-empty">No category progress available.</div>}
        </div>

        <div className="cand-sdp-detail">
          {selectedCategoryRow ? (
            <>
              <div className="cand-sdp-detail-head">
                <h3 className="cand-sdp-detail-title">{selectedCategory}</h3>
                <span className={selectedStatus?.className || ''}>{selectedStatus?.label}</span>
              </div>
              <div className="mb-2 text-xs text-soft">{selectedStatus?.interpretation}</div>
              <div className="cand-sdp-detail-bar-row">
                <div className="cand-sdp-detail-bar">
                  <div className="cand-sdp-detail-fill" style={{ width: `${selectedCategoryRow.percent}%`, background: categoryBarColor(selectedCategory) }} />
                </div>
                <span className="cand-sdp-detail-pct">{selectedCategoryRow.percent}%</span>
              </div>

              <div className="cand-sdp-detail-section">Missing Skills</div>
              <div className="cand-skill-row">
                {selectedMissing.length > 0 ? selectedMissing.map((skill) => <span key={`missing-${selectedCategory}-${skill}`} className="cand-skill-miss">{skill}</span>) : <span className="cand-covered-empty">No missing skills in this category.</span>}
              </div>

              <div className="cand-sdp-detail-section">Covered Skills</div>
              <div className="cand-skill-row">
                {selectedCovered.length > 0 ? selectedCovered.map((skill) => <span key={`covered-${selectedCategory}-${skill}`} className="cand-skill-match"><UIIcon name="check-circle" className="cand-chip-icon" />{skill}</span>) : <span className="cand-covered-empty">No covered skills yet.</span>}
              </div>

              <div className="cand-sdp-detail-section">Recommended Next Action</div>
              <div className="cand-sdp-next-action">
                {selectedMissing.length > 0 ? `Focus on ${selectedMissing[0]} to improve category alignment.` : 'Maintain momentum by continuing related upskilling content.'}
              </div>
              <div className="cand-sdp-action-row">
                <button className="cand-btn-primary cand-btn-sm" type="button" onClick={onOpenUpskilling}>
                  <UIIcon name="graduation" className="cand-btn-icon" />Open Upskilling Path
                </button>
                <button className="cand-btn-secondary cand-btn-sm" type="button" onClick={onOpenResume}>
                  <UIIcon name="upload" className="cand-btn-icon" />Update Resume
                </button>
              </div>
            </>
          ) : (
            <div className="cand-empty">Select a category from the left panel to view details.</div>
          )}
        </div>
      </div>

      <div className="cand-sdp-disclaimer">
        Skill Development Progress remains a career-guidance indicator and does not certify verified competency or guarantee employment.
      </div>
    </div>
  );
}

function SummaryCounter({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="cand-gap-summary-card">
      <div className="cand-gap-summary-num" style={{ color }}>
        {value}
      </div>
      <div className="cand-gap-summary-label">{label}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: ApplicationStatus }) {
  return <span className={`app-status-badge status-${status.toLowerCase()}`}>{status}</span>;
}

function ApplicationsPage({
  applications,
  jobs,
  onViewJob,
  onWithdraw,
  onOpenMessages,
}: {
  applications: DashboardApplication[];
  jobs: DashboardJob[];
  onViewJob: (application: DashboardApplication) => void;
  onWithdraw: (application: DashboardApplication) => void;
  onOpenMessages: () => void;
}) {
  const [searchValue, setSearchValue] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'shortlisted' | 'interviewing' | 'hired' | 'rejected' | 'withdrawn'>('all');
  const hasInterviewing = applications.some((app) => app.status === 'Interviewing');
  const filteredApplications = useMemo(() => {
    const query = searchValue.trim().toLowerCase();
    return applications.filter((application) => {
      if (statusFilter !== 'all' && statusKey(application.status) !== statusFilter) return false;
      if (!query) return true;
      return `${application.jobTitle} ${application.company} ${application.status} ${application.matchScore}%`
        .toLowerCase()
        .includes(query);
    });
  }, [applications, searchValue, statusFilter]);

  return (
    <div>
      <div className="cand-sticky-controls">
        <div className="cand-page-header cand-page-header-inline">
          <h1 className="cand-page-title">My Applications</h1>
          <p className="cand-page-subtitle">Track your internal Kareerly job applications and their current statuses</p>
        </div>
        <div className="cand-app-search">
          <UIIcon name="search" className="cand-search-icon" />
          <input
            value={searchValue}
            onChange={(event) => setSearchValue(event.target.value)}
            placeholder="Search by job title, company, status, or match %..."
          />
        </div>
        <div className="cand-app-tabs">
          {[
            ['all', 'All'],
            ['pending', 'Pending'],
            ['shortlisted', 'Shortlisted'],
            ['interviewing', 'Interviewing'],
            ['hired', 'Hired'],
            ['rejected', 'Rejected'],
            ['withdrawn', 'Withdrawn'],
          ].map(([value, label]) => (
            <button
              key={value}
              className={`cand-app-tab ${statusFilter === value ? 'active' : ''}`}
              type="button"
              onClick={() => setStatusFilter(value as 'all' | 'pending' | 'shortlisted' | 'interviewing' | 'hired' | 'rejected' | 'withdrawn')}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="cand-notice info">
        <span>
          Only internal Kareerly applications are tracked here. External opportunities are link-outs only. Messaging is available only at Interviewing or Hired stage after employer request and candidate acceptance.
        </span>
      </div>

      {filteredApplications.length > 0 ? (
        <div className="cand-table-wrap">
          <table className="cand-table">
            <thead>
              <tr>
                <th>Job & Company</th>
                <th>Match</th>
                <th>Date Applied</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredApplications.map((application) => {
                const canWithdraw = ['Pending', 'Shortlisted', 'Interviewing'].includes(application.status);
                const canMessage = application.status === 'Interviewing' || application.status === 'Hired';
                return (
                  <tr key={application.id} className={application.status === 'Withdrawn' ? 'cand-row-closed' : ''}>
                    <td>
                      <div className="text-sm font-bold text-dark">{application.jobTitle}</div>
                      <div className="text-xs text-soft">{application.company}</div>
                    </td>
                    <td>
                      <span className="font-display text-sm font-extrabold text-rust">{application.matchScore}%</span>
                    </td>
                    <td className="text-xs text-soft">{formatDateLabel(application.dateApplied)}</td>
                    <td><StatusBadge status={application.status} /></td>
                    <td>
                      <div className="flex flex-wrap gap-2">
                        <button className="cand-btn-secondary cand-btn-sm" type="button" onClick={() => onViewJob(application)}>
                          <UIIcon name="eye" className="cand-btn-icon" />View
                        </button>
                        <button className="cand-btn-secondary cand-btn-sm" type="button" onClick={() => onWithdraw(application)} disabled={!canWithdraw}>
                          <UIIcon name="trash" className="cand-btn-icon" />Withdraw
                        </button>
                        {canMessage && (
                          <button className="cand-btn-secondary cand-btn-sm" type="button" onClick={onOpenMessages}>
                            <UIIcon name="message" className="cand-btn-icon" />Message
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="cand-empty">
          {applications.length > 0 ? 'No applications match the selected filter/search.' : 'No internal applications yet. Apply from Job Matches to start tracking.'}
        </div>
      )}

      <div className="cand-card mt-4">
        <div className="text-sm font-bold text-dark">Application Rules</div>
        <p className="mt-2 text-sm text-soft">
          Allowed statuses are Pending, Shortlisted, Interviewing, Hired, Rejected, and Withdrawn. Withdraw is enabled only for Pending, Shortlisted, and Interviewing. Hired, Rejected, and Withdrawn are final and read-only.
        </p>
        {hasInterviewing && (
          <button className="cand-btn-secondary mt-3" type="button" onClick={onOpenMessages}>
            Open Interview Messaging
          </button>
        )}
      </div>

      {jobs.length === 0 && <div className="mt-4 text-sm text-soft">No job data loaded yet.</div>}
    </div>
  );
}

function PreferencesPage({
  surveyAnswers,
  extraPreferences,
  skillNames,
  isLoading,
  onUpdateExtra,
  onUpdateSkills,
  onSave,
  onReset,
  onRefreshSkills,
}: {
  surveyAnswers: SurveyAnswers;
  extraPreferences: { jobLevel: string; preferredLocation: string };
  skillNames: string[];
  isLoading: boolean;
  onUpdateExtra: (next: { jobLevel: string; preferredLocation: string }) => void;
  onUpdateSkills: (skills: string[]) => void;
  onSave: (answers: SurveyAnswers) => void;
  onReset: () => void;
  onRefreshSkills: () => void;
}) {
  const [draft, setDraft] = useState<SurveyAnswers>(surveyAnswers);
  const [skillInput, setSkillInput] = useState('');

  useEffect(() => {
    setDraft(surveyAnswers);
  }, [surveyAnswers]);

  const addSkill = () => {
    const next = skillInput.trim();
    if (!next) return;
    if (skillNames.some((item) => normalizeSkill(item) === normalizeSkill(next))) return;
    onUpdateSkills([...skillNames, next]);
    setSkillInput('');
  };

  const removeSkill = (value: string) => {
    const key = normalizeSkill(value);
    onUpdateSkills(skillNames.filter((item) => normalizeSkill(item) !== key));
  };

  return (
    <div>
      <div className="cand-page-header">
        <h1 className="cand-page-title">Career Preferences</h1>
        <p className="cand-page-subtitle">Refine your Aspiration-Based job matches and upskilling recommendations</p>
      </div>

      <div className="cand-card">
        <div className="cand-form-grid">
          <FormField label="Preferred Industry">
            <select className="cand-form-select" value={draft.industry} onChange={(event) => setDraft((current) => ({ ...current, industry: event.target.value }))}>
              {Object.entries(industryLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </FormField>
          <FormField label="Target Role">
            <input className="cand-form-input" value={draft.role} onChange={(event) => setDraft((current) => ({ ...current, role: event.target.value }))} />
          </FormField>
          <FormField label="Job Level">
            <select
              className="cand-form-select"
              value={extraPreferences.jobLevel}
              onChange={(event) => onUpdateExtra({ ...extraPreferences, jobLevel: event.target.value })}
            >
              <option>Entry Level</option>
              <option>Junior</option>
              <option>Mid-Level</option>
              <option>Senior</option>
              <option>Trainee / Intern</option>
            </select>
          </FormField>
          <FormField label="Work Setup">
            <select className="cand-form-select" value={draft.setup} onChange={(event) => setDraft((current) => ({ ...current, setup: event.target.value }))}>
              {Object.entries(setupLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </FormField>
          <FormField label="Preferred Location">
            <input
              className="cand-form-input"
              value={extraPreferences.preferredLocation}
              onChange={(event) => onUpdateExtra({ ...extraPreferences, preferredLocation: event.target.value })}
            />
          </FormField>
          <FormField label="Salary Expectation">
            <select className="cand-form-select" value={draft.salary} onChange={(event) => setDraft((current) => ({ ...current, salary: event.target.value }))}>
              {Object.entries(salaryLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </FormField>
        </div>

        <FormField label="Skill Development Interest">
          <textarea className="cand-form-textarea" value={draft.skill} onChange={(event) => setDraft((current) => ({ ...current, skill: event.target.value }))} />
        </FormField>

        <div className="cand-card mt-4 border border-amber bg-amber-l px-4 py-3 text-xs text-amber">
          Preferences serve as signals to refine Aspiration-Based recommendations. Core matching still depends on resume content and confirmed skills.
        </div>

        <div className="mt-4">
          <div className="mb-2 text-xs font-bold uppercase text-soft">Confirmed Skills</div>
          <div className="cand-skill-chip-grid">
            {skillNames.map((skill) => (
              <button key={skill} className="cand-skill-chip selected" type="button" onClick={() => removeSkill(skill)}>
                {skill} x
              </button>
            ))}
          </div>
          <div className="cand-skill-add-row">
            <input
              value={skillInput}
              className="cand-form-input"
              placeholder="Add a missing skill..."
              onChange={(event) => setSkillInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  addSkill();
                }
              }}
            />
            <button className="cand-btn-secondary" type="button" onClick={addSkill}>
              Add
            </button>
            <button className="cand-btn-primary" type="button" disabled={isLoading || skillNames.length === 0} onClick={onRefreshSkills}>
              Confirm Skills and Refresh
            </button>
          </div>
        </div>

        <div className="cand-form-actions">
          <button className="cand-btn-primary" type="button" disabled={isLoading} onClick={() => onSave(draft)}>
            Save Preferences
          </button>
          <button className="cand-btn-secondary" type="button" onClick={onReset}>
            Reset Changes
          </button>
        </div>
      </div>
    </div>
  );
}

function FormField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="cand-form-label">{label}</span>
      {children}
    </label>
  );
}

function AccountSettingsPage({
  user,
  uiLanguage,
  evidenceRecords,
  onLanguage,
  onOpenDelete,
  onOpenResume,
  onUploadEvidence,
  onSave,
}: {
  user: { name: string; email: string };
  uiLanguage: 'en' | 'fil';
  evidenceRecords: EvidenceUploadRecord[];
  onLanguage: (lang: 'en' | 'fil') => void;
  onOpenDelete: () => void;
  onOpenResume: () => void;
  onUploadEvidence: (file: File | null) => void;
  onSave: () => void;
}) {
  return (
    <div>
      <div className="cand-page-header">
        <h1 className="cand-page-title">Account Settings</h1>
        <p className="cand-page-subtitle">Manage personal details, resume, education, certifications, and account controls</p>
      </div>

      <div className="cand-acct-section">
        <div className="cand-acct-title">Language Preference</div>
        <p className="mb-3 text-xs text-soft">
          This toggle updates selected UI labels and basic instructions only. It does not imply full Filipino resume parsing or multilingual NLP support.
        </p>
        <div className="flex gap-2">
          <button className={`cand-tab-btn ${uiLanguage === 'en' ? 'active' : ''}`} type="button" onClick={() => onLanguage('en')}>
            English
          </button>
          <button className={`cand-tab-btn ${uiLanguage === 'fil' ? 'active' : ''}`} type="button" onClick={() => onLanguage('fil')}>
            Filipino
          </button>
        </div>
      </div>

      <div className="cand-acct-grid">
        <div className="cand-acct-section">
          <div className="cand-acct-title">Personal Details</div>
          <div className="space-y-3">
            <FormField label="Full Name"><input className="cand-form-input" defaultValue={user.name} /></FormField>
            <FormField label="Email Address"><input className="cand-form-input" defaultValue={user.email} /></FormField>
            <FormField label="Contact Number"><input className="cand-form-input" placeholder="+63 ..." /></FormField>
            <FormField label="Birthday"><input className="cand-form-input" type="date" /></FormField>
            <FormField label="Address"><input className="cand-form-input" placeholder="City, Province, Philippines" /></FormField>
            <FormField label="Location / Region"><input className="cand-form-input" placeholder="Region" /></FormField>
          </div>
          <button className="cand-btn-primary mt-4" type="button" onClick={onSave}>
            Save Details
          </button>
        </div>

        <div>
          <div className="cand-acct-section">
            <div className="cand-acct-title">Password & Security</div>
            <div className="space-y-3">
              <FormField label="Current Password"><input className="cand-form-input" type="password" /></FormField>
              <FormField label="New Password"><input className="cand-form-input" type="password" /></FormField>
              <FormField label="Confirm New Password"><input className="cand-form-input" type="password" /></FormField>
            </div>
            <button className="cand-btn-primary mt-4" type="button" onClick={onSave}>
              Update Password
            </button>
          </div>

          <div className="cand-acct-section">
            <div className="cand-acct-title">Resume</div>
            <div className="cand-notice info mb-3">
              <span>View or upload your latest resume. Updating resume refreshes matches, gaps, and recommendations.</span>
            </div>
            <button className="cand-btn-secondary w-full justify-center" type="button" onClick={onOpenResume}>
              Update Resume
            </button>
          </div>
        </div>
      </div>

      <div className="cand-acct-section">
        <div className="cand-acct-title">Education</div>
        <div className="cand-form-grid">
          <FormField label="Highest Educational Attainment"><input className="cand-form-input" placeholder="Bachelor's Degree" /></FormField>
          <FormField label="Degree / Program"><input className="cand-form-input" placeholder="BS Information Technology" /></FormField>
          <FormField label="School / University"><input className="cand-form-input" placeholder="University Name" /></FormField>
          <FormField label="Year Graduated"><input className="cand-form-input" placeholder="2023" /></FormField>
        </div>
        <button className="cand-btn-primary mt-3" type="button" onClick={onSave}>
          Save Education
        </button>
      </div>

      <div className="cand-acct-section">
        <div className="cand-acct-title">Certifications & Uploaded Evidence</div>
        <p className="mb-3 text-xs text-soft">
          Safeguards enabled: PDF-only uploads, PDF signature and page-structure checks, certificate keyword checks, photo-like filename blocking, and pending-verification status.
        </p>
        <div className="space-y-3">
          {evidenceRecords.length > 0 ? (
            evidenceRecords.map((record) => (
              <div key={record.id} className="flex items-center justify-between border-b border-bdr pb-3">
                <div>
                  <div className="text-sm font-bold text-dark">{record.title}</div>
                  <div className="text-xs text-soft">Uploaded {formatDateLabel(record.uploadedAt)}</div>
                </div>
                <span className={`cand-msg-badge ${record.status === 'Verified' ? 'accepted' : 'pending'}`}>{record.status}</span>
              </div>
            ))
          ) : (
            <div className="text-xs text-soft">No certificate evidence uploaded yet.</div>
          )}
          <label className="cand-evidence-upload">
            <UIIcon name="upload" className="cand-upload-inline-icon" />
            <span>Upload Certificate PDF</span>
            <input
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={(event) => onUploadEvidence(event.target.files?.[0] || null)}
            />
          </label>
        </div>
      </div>

      <div className="cand-acct-section border border-red">
        <div className="cand-acct-title border-b border-red-l text-red">Delete Profile</div>
        <p className="text-sm text-mid">
          Requesting profile deletion may affect your saved matches, applications, and progress records.
        </p>
        <button className="cand-btn-danger mt-4" type="button" onClick={onOpenDelete}>
          Request Profile Deletion
        </button>
      </div>
    </div>
  );
}

function KareersPage({
  kareers,
  selectedId,
  selected,
  savedJobs,
  onSelect,
  onOpenMatches,
  onOpenUpskilling,
}: {
  kareers: DashboardJob[];
  selectedId: string;
  selected: DashboardJob | null;
  savedJobs: Set<string>;
  onSelect: (id: string) => void;
  onOpenMatches: () => void;
  onOpenUpskilling: () => void;
}) {
  const [sourceFilter, setSourceFilter] = useState<'all' | 'internal' | 'external' | 'saved'>('all');
  const [searchValue, setSearchValue] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [levelFilter, setLevelFilter] = useState('');
  const [setupFilter, setSetupFilter] = useState('');
  const [alignFilter, setAlignFilter] = useState('');

  const filteredKareers = useMemo(() => {
    const query = searchValue.trim().toLowerCase();
    return kareers.filter((job) => {
      if (sourceFilter === 'internal' && job.sourceType !== 'internal') return false;
      if (sourceFilter === 'external' && job.sourceType !== 'external') return false;
      if (sourceFilter === 'saved' && !savedJobs.has(job.id)) return false;
      if (categoryFilter && !(job.category || '').toLowerCase().includes(categoryFilter.toLowerCase())) return false;
      if (levelFilter && !(job.jobLevel || '').toLowerCase().includes(levelFilter.toLowerCase())) return false;
      if (setupFilter && !(job.setup || '').toLowerCase().includes(setupFilter.toLowerCase())) return false;
      if (alignFilter && job.matchCategory !== alignFilter) return false;
      if (!query) return true;
      return `${job.title} ${job.company} ${job.category || ''} ${job.subCategory || ''} ${job.location} ${job.setup} ${job.matchedSkills.join(' ')} ${job.missingSkills.join(' ')}`
        .toLowerCase()
        .includes(query);
    });
  }, [alignFilter, categoryFilter, kareers, levelFilter, savedJobs, searchValue, setupFilter, sourceFilter]);

  useEffect(() => {
    if (filteredKareers.length === 0) return;
    if (!filteredKareers.some((job) => job.id === selectedId)) {
      onSelect(filteredKareers[0].id);
    }
  }, [filteredKareers, onSelect, selectedId]);

  const activeSelected = filteredKareers.find((job) => job.id === selectedId) || selected || filteredKareers[0] || null;

  return (
    <div>
      <div className="cand-sticky-controls">
        <div className="cand-page-header cand-page-header-inline">
          <h1 className="cand-page-title">Kareers</h1>
          <p className="cand-page-subtitle">Explore career paths and job opportunities by source, category, and alignment</p>
        </div>
        <div className="cand-kareers-source-row">
          <button className={`cand-source-chip ${sourceFilter === 'all' ? 'active' : ''}`} type="button" onClick={() => setSourceFilter('all')}><UIIcon name="compass" className="cand-chip-icon" />All</button>
          <button className={`cand-source-chip ${sourceFilter === 'internal' ? 'active' : ''}`} type="button" onClick={() => setSourceFilter('internal')}><UIIcon name="building" className="cand-chip-icon" />Internal Kareerly</button>
          <button className={`cand-source-chip ${sourceFilter === 'external' ? 'active' : ''}`} type="button" onClick={() => setSourceFilter('external')}><UIIcon name="external" className="cand-chip-icon" />External Opportunities</button>
          <button className={`cand-source-chip ${sourceFilter === 'saved' ? 'active' : ''}`} type="button" onClick={() => setSourceFilter('saved')}><UIIcon name="bookmark" className="cand-chip-icon" />Saved</button>
        </div>
      </div>

      <div className="cand-kareers-search-row">
        <div className="cand-search-box">
          <UIIcon name="search" className="cand-search-icon" />
          <input value={searchValue} onChange={(event) => setSearchValue(event.target.value)} placeholder="Search by role, skill, category, or location..." />
        </div>
        <select className="cand-form-select" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
          <option value="">All Categories</option>
          <option value="Data & Analytics">Data & Analytics</option>
          <option value="Engineering">Engineering</option>
          <option value="Operations">Operations & Support</option>
        </select>
        <select className="cand-form-select" value={levelFilter} onChange={(event) => setLevelFilter(event.target.value)}>
          <option value="">All Levels</option>
          <option value="Entry">Entry Level</option>
          <option value="Junior">Junior</option>
          <option value="Mid">Mid-Level</option>
          <option value="Senior">Senior</option>
          <option value="Trainee">Trainee</option>
        </select>
        <select className="cand-form-select" value={setupFilter} onChange={(event) => setSetupFilter(event.target.value)}>
          <option value="">All Work Setups</option>
          <option value="Remote">Remote</option>
          <option value="Hybrid">Hybrid</option>
          <option value="Onsite">Onsite</option>
        </select>
        <select className="cand-form-select" value={alignFilter} onChange={(event) => setAlignFilter(event.target.value)}>
          <option value="">All Alignments</option>
          <option value="fit-now">Fit-Now</option>
          <option value="aspiration">Aspiration</option>
        </select>
      </div>

      <div className="cand-two-panel">
        <div className="cand-two-panel-left">
          <div className="cand-two-panel-left-hd">Career Paths and Roles</div>
          <div className="cand-kareer-list-scroll">
            {filteredKareers.length > 0 ? (
              filteredKareers.map((job) => (
                <button key={job.id} className={`cand-kareer-item ${selectedId === job.id ? 'active' : ''}`} type="button" onClick={() => onSelect(job.id)}>
                  <div className="text-sm font-bold text-dark"><UIIcon name="briefcase" className="cand-chip-icon" />{job.title}</div>
                  <div className="text-xs text-soft">{job.company} · {job.category || 'Career Path'}</div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {job.matchedSkills.slice(0, 3).map((skill) => (
                      <span key={`${job.id}-${skill}`} className="rounded-full bg-cream-d px-2 py-0.5 text-[10px] font-semibold text-mid">
                        {skill}
                      </span>
                    ))}
                  </div>
                  <div className="cand-kareer-item-badges">
                    <span className="cand-kareer-mini-badge">{job.setup}</span>
                    <span className="cand-kareer-mini-badge">{job.jobLevel || 'Entry Level'}</span>
                    <span className={`cand-kareer-mini-badge ${job.matchCategory === 'fit-now' ? 'fit' : 'asp'}`}>{job.matchCategory === 'fit-now' ? 'Fit-Now' : 'Aspiration'}</span>
                    <span className={`cand-kareer-mini-badge ${job.sourceType === 'internal' ? 'fit' : 'asp'}`}>{job.sourceType === 'internal' ? 'Internal' : 'External'}</span>
                  </div>
                </button>
              ))
            ) : (
              <div className="p-4 text-sm text-soft">No careers match the current filters.</div>
            )}
          </div>
        </div>
        <div className="cand-two-panel-right">
          {activeSelected ? (
            <>
              <div className="mb-2 font-display text-2xl font-extrabold text-dark">{activeSelected.title}</div>
              <div className="mb-2 text-xs text-soft">
                {activeSelected.company} · {activeSelected.location} · {activeSelected.setup}
              </div>
              <div className={`mb-4 rounded-lg px-4 py-3 text-sm ${activeSelected.matchCategory === 'fit-now' ? 'bg-green-l text-forest' : 'bg-mauve-l text-mauve'}`}>
                {activeSelected.matchCategory === 'fit-now' ? 'Your profile aligns well with this role.' : 'This is an aspiration path with skill gaps to close.'}
              </div>
              <div className="cand-kareer-info-grid">
                <div><span className="cand-kareer-info-label">Category</span><span className="cand-kareer-info-value">{activeSelected.category || 'General Opportunities'}</span></div>
                <div><span className="cand-kareer-info-label">Sub-category</span><span className="cand-kareer-info-value">{activeSelected.subCategory || 'Career Path'}</span></div>
                <div><span className="cand-kareer-info-label">Experience Level</span><span className="cand-kareer-info-value">{activeSelected.jobLevel || 'Entry Level'}</span></div>
                <div><span className="cand-kareer-info-label">Source</span><span className="cand-kareer-info-value">{activeSelected.sourceType === 'internal' ? 'Internal Kareerly' : 'External Opportunity'}</span></div>
                <div><span className="cand-kareer-info-label">Location</span><span className="cand-kareer-info-value">{activeSelected.location}</span></div>
                <div><span className="cand-kareer-info-label">Work Setup</span><span className="cand-kareer-info-value">{activeSelected.setup}</span></div>
              </div>
              <div className="mb-2 text-xs font-bold uppercase tracking-[0.5px] text-soft">Required Skills</div>
              <div className="cand-skill-row">
                {activeSelected.matchedSkills.map((skill) => (
                  <span key={`${activeSelected.id}-m-${skill}`} className="cand-skill-match"><UIIcon name="check-circle" className="cand-chip-icon" />{skill}</span>
                ))}
                {activeSelected.missingSkills.map((skill) => (
                  <span key={`${activeSelected.id}-g-${skill}`} className="cand-skill-miss">{skill}</span>
                ))}
              </div>
              {activeSelected.niceToHaveSkills && activeSelected.niceToHaveSkills.length > 0 && (
                <>
                  <div className="mb-2 mt-4 text-xs font-bold uppercase tracking-[0.5px] text-soft">Nice-to-Have Skills</div>
                  <div className="cand-skill-row">
                    {activeSelected.niceToHaveSkills.map((skill) => (
                      <span key={`${activeSelected.id}-nice-${skill}`} className="cand-skill-nice">{skill}</span>
                    ))}
                  </div>
                </>
              )}
              <div className="mb-2 mt-4 text-xs font-bold uppercase tracking-[0.5px] text-soft">Career Guidance</div>
              <p className="text-sm text-mid">{activeSelected.explanation}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button className="cand-btn-primary" type="button" onClick={onOpenMatches}>
                  <UIIcon name="briefcase" className="cand-btn-icon" />View Job Matches
                </button>
                <button className="cand-btn-secondary" type="button" onClick={onOpenUpskilling}>
                  <UIIcon name="graduation" className="cand-btn-icon" />Start Learning Path
                </button>
              </div>
            </>
          ) : (
            <div className="cand-empty">Select a role from the left panel to view details.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function UpskillingPage({
  tab,
  courses,
  categoryProgress,
  groupedCoursesByGap,
  recommended,
  inProgress,
  completed,
  onTab,
  onStart,
  onComplete,
  onViewCourse,
}: {
  tab: UpskillTab;
  courses: DashboardCourse[];
  categoryProgress: Array<{ category: SkillCategory; percent: number; missing: number; matched: number; completed: number }>;
  groupedCoursesByGap: Array<{ gapTag: string; courses: DashboardCourse[] }>;
  recommended: DashboardCourse[];
  inProgress: DashboardCourse[];
  completed: DashboardCourse[];
  onTab: (tab: UpskillTab) => void;
  onStart: (course: DashboardCourse) => void;
  onComplete: (course: DashboardCourse) => void;
  onViewCourse: (course: DashboardCourse) => void;
}) {
  return (
    <div>
      <div className="cand-page-header">
        <h1 className="cand-page-title">Upskilling Path</h1>
        <p className="cand-page-subtitle">Recommended courses and certifications based on your identified skill gaps with progress tracking</p>
      </div>

      <div className="cand-card mb-6">
        <h2 className="cand-card-title">Category Progress Overview</h2>
        <div className="grid gap-3 md:grid-cols-5">
          {categoryProgress.slice(0, 5).map((row) => (
            <div key={row.category} className="rounded-lg bg-bg p-3 text-center">
              <div className="font-display text-xl font-extrabold" style={{ color: categoryBarColor(row.category) }}>
                {row.percent}%
              </div>
              <div className="mb-1 mt-1 text-[10px] font-bold uppercase tracking-[0.4px] text-soft">{row.category}</div>
              <div className="cand-sdp-bar-wrap">
                <div className="cand-sdp-bar-fill" style={{ width: `${row.percent}%`, background: categoryBarColor(row.category) }} />
              </div>
            </div>
          ))}
        </div>
        <div className="cand-sdp-disclaimer mt-3">
          Career-guidance indicator only. Progress updates based on learning completion, evidence uploads, and refreshed skill data.
        </div>
      </div>

      <div className="cand-upskill-tabs">
        <button className={`cand-upskill-tab ${tab === 'recommended' ? 'active' : ''}`} type="button" onClick={() => onTab('recommended')}>Recommended</button>
        <button className={`cand-upskill-tab ${tab === 'inprogress' ? 'active' : ''}`} type="button" onClick={() => onTab('inprogress')}>In Progress</button>
        <button className={`cand-upskill-tab ${tab === 'completed' ? 'active' : ''}`} type="button" onClick={() => onTab('completed')}>Completed</button>
        <button className={`cand-upskill-tab ${tab === 'by-gap' ? 'active' : ''}`} type="button" onClick={() => onTab('by-gap')}>By Skill Gap</button>
      </div>

      {courses.length === 0 ? (
        <div className="cand-empty">Upskilling recommendations will appear after skill gaps are generated from your latest resume and match results.</div>
      ) : (
        <>
          {tab === 'recommended' && (
            <div>
              {recommended.length > 0 ? recommended.map((course) => <CourseCard key={course.id} course={course} onView={onViewCourse} onStart={onStart} />) : <div className="cand-empty">No recommended courses remaining.</div>}
            </div>
          )}

          {tab === 'inprogress' && (
            <div>
              {inProgress.length > 0 ? inProgress.map((course) => <CourseCard key={course.id} course={course} inProgress onView={onViewCourse} onComplete={onComplete} />) : <div className="cand-empty">No courses in progress.</div>}
            </div>
          )}

          {tab === 'completed' && (
            <div>
              {completed.length > 0 ? (
                <>
                  {completed.map((course) => <CourseCard key={course.id} course={course} completed onView={onViewCourse} />)}
                  <div className="cand-evidence-upload mt-3">
                    <UIIcon name="upload" className="cand-upload-inline-icon" />
                    <span>Upload New Certificate or Evidence</span>
                  </div>
                </>
              ) : (
                <div className="cand-empty">No completed courses yet.</div>
              )}
            </div>
          )}

          {tab === 'by-gap' && (
            <div className="space-y-3">
              {groupedCoursesByGap.length > 0 ? (
                groupedCoursesByGap.map((group) => (
                  <div key={group.gapTag} className="cand-card">
                    <div className="text-sm font-bold text-dark">{group.gapTag}</div>
                    <div className="mt-1 text-xs text-soft">{group.courses.length} course recommendation(s)</div>
                    <button className="cand-btn-secondary mt-3" type="button" onClick={() => onTab('recommended')}>
                      View Courses
                    </button>
                  </div>
                ))
              ) : (
                <div className="cand-empty">No course groups available.</div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function CourseCard({
  course,
  inProgress,
  completed,
  onView,
  onStart,
  onComplete,
}: {
  course: DashboardCourse;
  inProgress?: boolean;
  completed?: boolean;
  onView: (course: DashboardCourse) => void;
  onStart?: (course: DashboardCourse) => void;
  onComplete?: (course: DashboardCourse) => void;
}) {
  return (
    <div className="cand-course-card">
      <div className="cand-course-top">
        <div className="cand-provider-badge">{course.provider.slice(0, 2).toUpperCase()}</div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-dark">{course.title}</div>
          <div className="text-xs text-soft">{course.provider}</div>
        </div>
        <span className={`cand-pill ${course.isFree ? 'free' : 'paid'}`}>{course.isFree ? 'Free' : 'Paid'}</span>
      </div>
      <div className="cand-course-meta">
        <span>{course.duration}</span>
        <span>{course.level}</span>
        <span>{course.certificateAvailable ? 'Certificate available' : 'No certificate'}</span>
        <span className="cand-course-gap-tag">{course.gapTag}</span>
      </div>
      {inProgress && (
        <div>
          <div className="flex justify-between text-xs text-soft">
            <span>Progress</span>
            <span>50%</span>
          </div>
          <div className="cand-progress-bar">
            <div className="cand-progress-fill" style={{ width: '50%' }} />
          </div>
        </div>
      )}
      <div className="cand-course-actions">
        <span className="text-xs text-soft">{completed ? 'Completed' : inProgress ? 'In progress' : 'Recommended learning'}</span>
        <div className="flex gap-2">
          <button className="cand-btn-primary cand-btn-sm" type="button" onClick={() => onView(course)}>
            View Course
          </button>
          {!completed && !inProgress && onStart && (
            <button className="cand-btn-secondary cand-btn-sm" type="button" onClick={() => onStart(course)}>
              Start
            </button>
          )}
          {inProgress && onComplete && (
            <button className="cand-btn-secondary cand-btn-sm" type="button" onClick={() => onComplete(course)}>
              Mark Completed
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function MessagesPage({
  applications,
  selectedJobId,
  requestStates,
  requestTexts,
  replies,
  draft,
  onSelect,
  onAccept,
  onDecline,
  onIgnore,
  onDraftChange,
  onSend,
  canReply,
}: {
  applications: DashboardApplication[];
  selectedJobId: string;
  requestStates: Record<string, MessageRequestState>;
  requestTexts: Record<string, string>;
  replies: Record<string, Array<{ from: 'employer' | 'candidate'; text: string; time: string }>>;
  draft: string;
  onSelect: (jobId: string) => void;
  onAccept: () => void;
  onDecline: () => void;
  onIgnore: () => void;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  canReply: boolean;
}) {
  const selected = applications.find((app) => app.jobId === selectedJobId) || null;
  const state = selected ? requestStates[selected.jobId] || 'Pending' : 'Pending';
  const threadReplies = selected ? replies[selected.jobId] || [] : [];

  return (
    <div>
      <div className="cand-page-header">
        <h1 className="cand-page-title">Messages</h1>
        <p className="cand-page-subtitle">Interview-stage message requests from employers</p>
      </div>

      <div className="cand-notice info">
        <span>
          In-app messaging becomes available only when an employer moves an applicant to Interviewing or Hired stage. Employer initiates the first request. Candidate may accept, decline, or ignore, and can reply only after accepting.
        </span>
      </div>

      <div className="cand-msg-layout">
        <div className="cand-msg-list">
          <div className="cand-two-panel-left-hd">Conversations</div>
          {applications.length > 0 ? (
            applications.map((app) => (
              <button key={app.id} className={`cand-msg-item ${selectedJobId === app.jobId ? 'active' : ''}`} type="button" onClick={() => onSelect(app.jobId)}>
                <div className="text-sm font-bold text-dark">{app.company}</div>
                <div className="text-xs text-soft">{app.jobTitle} · {app.status}</div>
                <span className={`cand-msg-badge ${stateToClass(requestStates[app.jobId] || 'Pending')}`}>{requestStates[app.jobId] || 'Pending'}</span>
              </button>
            ))
          ) : (
            <div className="p-4 text-sm text-soft">No eligible Interviewing/Hired applications yet.</div>
          )}
        </div>

        <div className="cand-msg-panel">
          {selected ? (
            <>
              <div className="flex items-center justify-between border-b border-bdr px-5 py-4">
                <div>
                  <h4 className="text-sm font-bold text-dark">{selected.company}</h4>
                  <p className="text-xs text-soft">{selected.jobTitle} · {selected.status} stage</p>
                </div>
              </div>

              <div className="cand-msg-body">
                <div className="cand-msg-request">
                  <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.5px] text-rust">Employer Message Request</div>
                  <div className="text-sm text-mid">{requestTexts[selected.jobId] || 'Message request content will appear here.'}</div>
                </div>

                {state === 'Pending' && (
                  <>
                    <div className="cand-msg-lock">You can only reply after accepting this message request.</div>
                    <div className="flex flex-wrap gap-2">
                      <button className="cand-btn-primary" type="button" onClick={onAccept}>
                        Accept
                      </button>
                      <button className="cand-btn-secondary" type="button" onClick={onDecline}>
                        Decline
                      </button>
                      <button className="cand-btn-secondary" type="button" onClick={onIgnore}>
                        Ignore
                      </button>
                    </div>
                  </>
                )}

                {state === 'Declined' && <div className="cand-msg-lock">Request declined. Reply is disabled.</div>}
                {state === 'Ignored' && <div className="cand-msg-lock">Request ignored. Reply is disabled.</div>}
                {state === 'Accepted' && (
                  <>
                    <div className="text-sm font-semibold text-green">Request accepted. You can now reply.</div>
                    {threadReplies.map((reply, index) => (
                      <div key={`${selected.jobId}-${index}`} className={reply.from === 'employer' ? 'msg-bubble-employer' : 'msg-bubble-candidate'}>
                        <div className="msg-bubble-sender">{reply.from === 'employer' ? 'Employer' : 'You'}</div>
                        <div>{reply.text}</div>
                        <div className="msg-bubble-time">{reply.time}</div>
                      </div>
                    ))}
                  </>
                )}
              </div>

              <div className="cand-msg-composer">
                <textarea
                  className="cand-msg-input"
                  placeholder={canReply ? 'Type your reply...' : 'Reply is disabled until request is accepted.'}
                  value={draft}
                  disabled={!canReply}
                  onChange={(event) => onDraftChange(event.target.value)}
                />
                <button className="cand-msg-send" type="button" disabled={!canReply} onClick={onSend}>
                  Send
                </button>
              </div>
            </>
          ) : (
            <div className="cand-empty m-4">No message threads available.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function stateToClass(state: MessageRequestState): string {
  if (state === 'Accepted') return 'accepted';
  if (state === 'Declined') return 'declined';
  if (state === 'Ignored') return 'ignored';
  return 'pending';
}

function JobDetailModal({
  job,
  isSaved,
  onClose,
  onApply,
  onSave,
}: {
  job: DashboardJob;
  isSaved: boolean;
  onClose: () => void;
  onApply: () => void;
  onSave: () => void;
}) {
  return (
    <div className="cand-modal-overlay" onClick={onClose}>
      <div className="cand-modal-box lg" onClick={(event) => event.stopPropagation()}>
        <div className="cand-modal-header">
          <div>
            <div className="cand-modal-title">{job.title}</div>
            <div className="cand-modal-subtitle">{job.company}</div>
          </div>
          <button className="cand-modal-close" type="button" onClick={onClose}>
            x
          </button>
        </div>

        <div className="mb-4 flex items-center justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`cand-match-cat ${job.matchCategory === 'fit-now' ? 'cand-cat-fit' : 'cand-cat-aspiration'}`}>
              {job.matchCategory === 'fit-now' ? 'Fit Now Match' : 'Aspiration Match'}
            </span>
            <span className={`cand-type-tag ${job.sourceType === 'internal' ? 'cand-type-internal' : 'cand-type-external'}`}>
              {job.sourceType === 'internal' ? 'Internal' : 'External'}
            </span>
            {job.category && <span className="cand-job-badge">{job.category}</span>}
            {job.subCategory && <span className="cand-job-badge tan">{job.subCategory}</span>}
          </div>
          <div className={`font-display text-3xl font-extrabold ${job.hasMatchScore ? 'text-rust' : 'text-soft'}`}>{getMatchScoreBadge(job)}</div>
        </div>

        <div className="cand-modal-meta-grid">
          <div><span className="cand-kareer-info-label">Location</span><span className="cand-kareer-info-value">{job.location || '—'}</span></div>
          <div><span className="cand-kareer-info-label">Work Setup</span><span className="cand-kareer-info-value">{job.setup || '—'}</span></div>
          <div><span className="cand-kareer-info-label">Experience Level</span><span className="cand-kareer-info-value">{job.jobLevel || 'Entry Level'}</span></div>
          <div><span className="cand-kareer-info-label">Salary Range</span><span className="cand-kareer-info-value">{job.salary || 'Salary varies by employer'}</span></div>
        </div>

        <div className="mb-3 text-xs font-bold uppercase tracking-[0.5px] text-soft">Job Description</div>
        <div className="cand-job-description-box">
          {job.explanation || 'Detailed role description is not available yet.'}
        </div>

        <div className="mb-3 text-xs font-bold uppercase tracking-[0.5px] text-soft">Matched Skills</div>
        <div className="cand-skill-row mb-4">
          {(job.matchedSkills.length > 0 ? job.matchedSkills : ['No matched skills provided']).map((skill) => (
            <span key={`${job.id}-jd-m-${skill}`} className="cand-skill-match">
              <UIIcon name="check-circle" className="cand-chip-icon" />
              {skill}
            </span>
          ))}
        </div>

        <div className="mb-3 text-xs font-bold uppercase tracking-[0.5px] text-soft">Missing Skills</div>
        <div className="cand-skill-row mb-4">
          {(job.missingSkills.length > 0 ? job.missingSkills : ['No missing skills listed']).map((skill) => (
            <span key={`${job.id}-jd-g-${skill}`} className="cand-skill-miss">
              {skill}
            </span>
          ))}
        </div>

        {job.niceToHaveSkills && job.niceToHaveSkills.length > 0 && (
          <>
            <div className="mb-3 text-xs font-bold uppercase tracking-[0.5px] text-soft">Nice-to-Have Skills</div>
            <div className="cand-skill-row mb-4">
              {job.niceToHaveSkills.map((skill) => (
                <span key={`${job.id}-jd-n-${skill}`} className="cand-skill-nice">
                  {skill}
                </span>
              ))}
            </div>
          </>
        )}

        <div className="mb-3 text-xs font-bold uppercase tracking-[0.5px] text-soft">Match Explanation</div>
        <div className="cand-explain"><UIIcon name="lightbulb" className="cand-inline-info-icon" />{job.explanation}</div>

        {job.sourceType === 'internal' ? (
          <div className="cand-modal-actions">
            <button className="cand-btn-primary" type="button" onClick={onApply}>
              <UIIcon name="paper-plane" className="cand-btn-icon" />Apply Now
            </button>
            <button className="cand-btn-secondary" type="button" onClick={onSave}>
              <UIIcon name="bookmark" className="cand-btn-icon" />{isSaved ? 'Saved' : 'Save Job'}
            </button>
          </div>
        ) : (
          <>
            <div className="cand-notice warn">
              <span>This is an external opportunity. In-platform application tracking, withdrawal, and messaging are not available.</span>
            </div>
            <div className="cand-modal-actions">
              <button
                className="cand-btn-primary"
                type="button"
                onClick={() => {
                  const fallbackQuery = encodeURIComponent(`${job.title} ${job.company} jobs`);
                  const targetUrl = job.externalUrl || `https://www.google.com/search?q=${fallbackQuery}`;
                  window.open(targetUrl, '_blank', 'noopener,noreferrer');
                }}
              >
                <UIIcon name="external" className="cand-btn-icon" />Visit Job Site
              </button>
              <button className="cand-btn-secondary" type="button" onClick={onSave}>
                <UIIcon name="bookmark" className="cand-btn-icon" />{isSaved ? 'Saved' : 'Save Job'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ResumeUpdateModal({
  step,
  postRefreshTarget,
  dragOver,
  file,
  reviewSkills,
  skillInput,
  loading,
  onClose,
  onDragOver,
  onPickFile,
  onProcess,
  onBack,
  onReviewPreferencesPath,
  onSkip,
  onConfirm,
  onSkillInput,
  onAddSkill,
  onRemoveSkill,
}: {
  step: 'upload' | 'decision' | 'review';
  postRefreshTarget: 'dashboard' | 'preferences';
  dragOver: boolean;
  file: File | null;
  reviewSkills: string[];
  skillInput: string;
  loading: boolean;
  onClose: () => void;
  onDragOver: (value: boolean) => void;
  onPickFile: (file: File | null) => void;
  onProcess: () => void;
  onBack: () => void;
  onReviewPreferencesPath: () => void;
  onSkip: () => void;
  onConfirm: () => void;
  onSkillInput: (value: string) => void;
  onAddSkill: () => void;
  onRemoveSkill: (skill: string) => void;
}) {
  return (
    <div className="cand-modal-overlay" onClick={onClose}>
      <div className="cand-modal-box" onClick={(event) => event.stopPropagation()}>
        <div className="cand-modal-header">
          <div>
            <div className="cand-modal-title">Update Resume</div>
            <div className="cand-modal-subtitle">Updating resume refreshes skills, matches, gaps, recommendations, and progress.</div>
          </div>
          <button className="cand-modal-close" type="button" onClick={onClose}>
            x
          </button>
        </div>

        {step === 'upload' && (
          <div>
            <label
              className={`cand-upload-zone ${dragOver ? 'drag-over' : ''}`}
              onDragOver={(event) => {
                event.preventDefault();
                onDragOver(true);
              }}
              onDragLeave={() => onDragOver(false)}
              onDrop={(event) => {
                event.preventDefault();
                onDragOver(false);
                onPickFile(event.dataTransfer.files?.[0] ?? null);
              }}
            >
              <input
                type="file"
                accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="hidden"
                onChange={(event) => onPickFile(event.target.files?.[0] ?? null)}
              />
              <UIIcon name="upload" className="cand-upload-icon" />
              <div className="mt-2 text-sm font-bold text-dark">Drag and drop your resume here</div>
              <div className="text-xs text-soft">PDF or DOCX · max 10MB</div>
            </label>

            {file && (
              <div className="cand-upload-file">
                <span className="flex-1 text-sm font-semibold">{file.name}</span>
                <button className="text-sm font-bold" type="button" onClick={() => onPickFile(null)}>
                  Remove
                </button>
              </div>
            )}

            <div className="cand-notice warn mt-4">
              <span>Skill extraction works best on readable PDF/DOCX text. Scanned image resumes may reduce extraction quality.</span>
            </div>

            <div className="cand-modal-actions">
              <button className="cand-btn-primary" type="button" disabled={loading} onClick={onProcess}>
                {loading ? 'Processing...' : 'Analyze Resume'}
              </button>
              <button className="cand-btn-secondary" type="button" onClick={onClose}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {step === 'decision' && (
          <div>
            <div className="cand-notice info mb-3">
              <span>Would you like to review your skills and preferences first, or skip and apply the resume updates now?</span>
            </div>
            <div className="cand-notice warn mb-3">
              <span>Check Skills & Preferences returns you to the onboarding flow (Steps 2 and 3) to review everything.</span>
            </div>
            <div className="cand-modal-actions">
              <button className="cand-btn-primary" type="button" onClick={onReviewPreferencesPath}>
                Check Skills & Preferences
              </button>
              <button className="cand-btn-secondary" type="button" disabled={loading} onClick={onSkip}>
                {loading ? 'Applying...' : 'Skip and Apply to Dashboard'}
              </button>
              <button className="cand-btn-secondary" type="button" onClick={onBack}>
                Back to Upload
              </button>
            </div>
          </div>
        )}

        {step === 'review' && (
          <div>
            <div className="cand-notice info mb-3">
              <span>Resume uploaded. Review and confirm detected skills before refreshing dashboard recommendations.</span>
            </div>
            <div className="text-sm font-bold text-dark">Detected Skills</div>
            <div className="text-xs text-soft">Click a skill to remove it from confirmation.</div>
            <div className="cand-skill-chip-grid">
              {reviewSkills.map((skill) => (
                <button key={skill} className="cand-skill-chip selected" type="button" onClick={() => onRemoveSkill(skill)}>
                  {skill} x
                </button>
              ))}
            </div>
            <div className="cand-skill-add-row">
              <input
                value={skillInput}
                onChange={(event) => onSkillInput(event.target.value)}
                placeholder="Add a missing skill..."
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    onAddSkill();
                  }
                }}
              />
              <button className="cand-btn-secondary" type="button" onClick={onAddSkill}>
                Add Skill
              </button>
            </div>
            <div className="cand-notice info mt-3">
              <span>Confirming these skills refreshes job matches, skill gaps, upskilling recommendations, and Skill Development Progress.</span>
            </div>
            {postRefreshTarget === 'preferences' && (
              <div className="cand-notice info mt-3">
                <span>After confirmation, we will open Preferences so you can review and adjust your settings.</span>
              </div>
            )}
            <div className="cand-modal-actions">
              <button className="cand-btn-primary" type="button" disabled={loading} onClick={onConfirm}>
                {loading ? 'Refreshing...' : postRefreshTarget === 'preferences' ? 'Confirm and Open Preferences' : 'Confirm Skills and Refresh'}
              </button>
              <button className="cand-btn-secondary" type="button" onClick={() => onBack()}>
                Back
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ConfirmModal({
  title,
  description,
  footnote,
  danger,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  title: string;
  description: string;
  footnote?: string;
  danger?: boolean;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="cand-modal-overlay" onClick={onCancel}>
      <div className="cand-modal-box" onClick={(event) => event.stopPropagation()}>
        <div className="cand-modal-header">
          <div className={`cand-modal-title ${danger ? 'text-red' : ''}`}>{title}</div>
          <button className="cand-modal-close" type="button" onClick={onCancel}>
            x
          </button>
        </div>
        <div className={`cand-notice ${danger ? 'error' : 'info'}`}>
          <span>{description}</span>
        </div>
        {footnote && <p className="text-sm text-soft">{footnote}</p>}
        <div className="cand-modal-actions">
          <button className={danger ? 'cand-btn-danger' : 'cand-btn-primary'} type="button" onClick={onConfirm}>
            {confirmLabel}
          </button>
          <button className="cand-btn-secondary" type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

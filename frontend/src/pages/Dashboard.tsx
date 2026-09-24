import { savedMatchScore, scoreLabel } from '../lib/uiData';
import { prepareEvidenceUpload, type EvidenceUploadRecord, type EvidenceType } from '../lib/evidence';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import {
  faArrowLeft,
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
  faForward,
  faGraduationCap,
  faLaptop,
  faLayerGroup,
  faFileLines,
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
  faXmark,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import DOMPurify from 'dompurify';
import { formatFileSize, validateResumeFile } from '../lib/fileUtils';
import * as mammoth from 'mammoth';
import Logo from '../components/Logo';
import { useOnboarding } from '../hooks/useOnboarding';
import { analyzeResume, fetchAvailableJobs, fetchJobDetails, listCandidateNotifications, loadApplicationMessages, loadCandidateAccountSettings, markAllCandidateNotificationsRead, markCandidateNotificationRead, runJobMatches, saveCandidateAccountSettings, sendApplicationMessage, validateCertificateFile } from '../lib/api';
import type { AvailableJobItem, CandidateNotification } from '../lib/api';
import { cleanSkillLabel } from '../lib/skillLabels';
import { careerAreaOptions, getCareerAreaLabel, normalizeCareerAreaValue } from '../lib/careerAreas';
import { supabase } from '../lib/supabase';
import { updateCandidateProfile } from '../lib/auth';
import { loadLatestMatchHistory, loadLatestResume, saveMatchHistory, saveResumeAnalysis } from '../lib/userData';
import type { DevelopmentProgressRecord, LearningRecommendation as RunLearningRecommendation } from '../types';
import { extractMatchPercent, extractSkillGapMatchCount, extractSkillGapMatchPercent, parseNumericValue } from '../lib/matchScoring';
import { formatJobDescription } from '../lib/jobDescription';
import type { CredentialType, CourseRecommendation, JobMatch, MatchResultItem, ParsedResume, PrioritizedSkillGap, SelectedSkill, SkillGap, SurveyAnswers } from '../types';
import './candidate-dashboard-v5.css';
import ExternalJobAnalysisPage from './ExternalJobAnalysisPage';

type DashboardProps = {
  currentUser: { id?: string; name: string; email: string } | null;
  onHome: () => void;
  onLogin: () => void;
  onSignUp: () => void;
  onUpdateResume: () => void;
  onLogout: () => void;
};

type DashboardPage =
  | 'dashboard'
  | 'jobmatches'
  | 'external-job'
  | 'skillgaps'
  | 'applications'
  | 'preferences'
  | 'account'
  | 'kareers'
  | 'upskilling'
  | 'messages';

type JobFilter = 'top' | 'fit-now' | 'aspiration' | 'all' | 'internal' | 'external' | 'saved';
type UpskillTab = 'recommended' | 'by-gap';
type ToastType = '' | 'success' | 'warn' | 'danger';
type ApplicationStatus = 'Pending' | 'Shortlisted' | 'Interviewing' | 'Hired' | 'Rejected' | 'Withdrawn';
type MessageRequestState = 'Pending' | 'Accepted' | 'Declined' | 'Ignored';
type SeverityLevel = 'Critical' | 'High' | 'Moderate';
type UiLanguage = 'en' | 'fil';

const FILIPINO_UI: Record<string, string> = {
  'My Career': 'Aking Karera', Dashboard: 'Dashboard', 'Job Matches': 'Mga Tugmang Trabaho',
  'Skill Gaps': 'Mga Kasanayang Kailangang Linangin', Applications: 'Mga Aplikasyon',
  Preferences: 'Mga Kagustuhan', 'Account Settings': 'Mga Setting ng Account', Explore: 'Tuklasin',
  Kareers: 'Mga Karera', 'Learning Recommendations': 'Mga Rekomendasyon sa Pagkatuto', Messages: 'Mga Mensahe',
  Language: 'Wika', English: 'Ingles', Filipino: 'Filipino', Logout: 'Mag-logout',
  'Location not set': 'Hindi pa nakatakda ang lokasyon', 'No notifications yet.': 'Wala pang abiso.',
  'Language Preference': 'Piniling Wika',
  'Manage personal details, resume, education, and account controls': 'Pamahalaan ang personal na detalye, resume, edukasyon, at mga kontrol ng account',
  'Personal Details': 'Personal na Detalye', 'Full Name': 'Buong Pangalan', 'Email Address': 'Email Address',
  'Candidate ID': 'ID ng Kandidato', 'Not available': 'Hindi available', 'Contact Number': 'Numero ng Telepono',
  Birthday: 'Kaarawan', Address: 'Address', 'Location / Region': 'Lokasyon / Rehiyon',
  'Enter contact number': 'Ilagay ang numero ng telepono', 'Enter your address': 'Ilagay ang iyong address',
  'Enter your region': 'Ilagay ang iyong rehiyon', 'Save Details': 'I-save ang mga Detalye', Saving: 'Sine-save',
  'Password & Security': 'Password at Seguridad', 'Current Password': 'Kasalukuyang Password',
  'New Password': 'Bagong Password', 'Confirm New Password': 'Kumpirmahin ang Bagong Password',
  'Update Password': 'I-update ang Password', Resume: 'Resume', 'Saved resume:': 'Naka-save na resume:',
  'No resume saved yet': 'Wala pang naka-save na resume', 'View Resume': 'Tingnan ang Resume',
  'Update Resume': 'I-update ang Resume', Education: 'Edukasyon',
  'Highest Educational Attainment': 'Pinakamataas na Natapos na Edukasyon', 'Degree / Program': 'Degree / Programa',
  'School / University': 'Paaralan / Unibersidad', 'Year Graduated': 'Taon ng Pagtatapos',
  'Enter highest educational attainment': 'Ilagay ang pinakamataas na natapos na edukasyon',
  'Enter degree or program': 'Ilagay ang degree o programa', 'Enter school or university': 'Ilagay ang paaralan o unibersidad',
  'Enter graduation year': 'Ilagay ang taon ng pagtatapos', 'Save Education': 'I-save ang Edukasyon',
  'User-Uploaded Evidence': 'Mga Sertipikasyon at Na-upload na Katibayan',
  'Upload Evidence': 'Mag-upload ng Katibayan', View: 'Tingnan', Replace: 'Palitan', Delete: 'Tanggalin',
  'Delete Profile': 'Tanggalin ang Profile', 'Request Profile Deletion': 'Humiling na Tanggalin ang Profile',
};

function tr(language: UiLanguage, english: string): string {
  return language === 'fil' ? FILIPINO_UI[english] || english : english;
}
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
  | 'rocket'
  | 'close';

type DashboardJob = {
  id: string;
  jobSource: 'internal' | 'employer';
  title: string;
  company: string;
  location: string;
  setup: string;
  employmentType?: string;
  salary: string;
  matchScore: number;
  hasMatchScore: boolean;
  confidence?: string;
  matchCategory: 'fit-now' | 'aspiration';
  sourceType: 'internal' | 'external';
  requiredSkills: string[];
  preferredSkills: string[];
  responsibilities: string[];
  description?: string;
  matchedSkills: string[];
  missingSkills: string[];
  missingSkillIds?: string[];
  explanation: string;
  category?: string;
  subCategory?: string;
  jobLevel?: string;
  niceToHaveSkills?: string[];
  externalUrl?: string;
  createdAt?: string;
  updatedAt?: string;
  salaryMin?: number;
  salaryMax?: number;
};

const TOP_MATCHES_PER_CATEGORY = 10;

type DashboardGap = {
  skill: string;
  severity: SeverityLevel;
  affectedCount: number | null;
  affectedPercent?: number;
  priorityScore?: number;
  categoryName?: string;
  requirementImportance?: string;
  learningResourceAvailable?: boolean;
  category: SkillCategory;
  relatedJobs: string[];
  topResources?: DashboardCourse[];
  skillId?: string;
};

type DashboardCourse = {
  id: string;
  title: string;
  provider: string;
  duration: string;
  level: string;
  credentialType: CredentialType;
  credentialLabel: string;
  isFree: boolean;
  gapTag: string;
  mappedSkills: string[];
  mappedSkillIds: string[];
  reviewed: boolean;
  fees: string;
  certificateCost: string;
  prerequisites: string;
  credentialConditions: string;
  verifiedAt?: string;
  url?: string;
  urlLabel: string;
  deliveryMode?: string;
  source: 'backend';
};

type CategoryProgressRow = {
  category: SkillCategory;
  percent: number;
  missing: number;
  matched: number;
  completed: number;
  inProgress: number;
  evidenceUploaded: number;
  relatedSkillRecords: string[];
  recentActivity?: string;
};

type SkillProgressStatus = 'missing' | 'started' | 'in_progress' | 'completed' | 'evidenced' | 'covered';

type SkillProgressRecord = {
  skillId?: string;
  skillName: string;
  category: SkillCategory;
  categoryName?: string;
  status: SkillProgressStatus;
  progressPercent: number;
  selectedResourceId?: string;
  evidenceFilename?: string;
  evidenceUploadedAt?: string;
};



type DashboardApplication = {
  id: string;
  jobId: string;
  jobSource: 'internal' | 'employer';
  jobTitle: string;
  company: string;
  matchScore: number | null;
  updatedAt?: string;
  status: ApplicationStatus;
  dateApplied: string;
  sourceType: 'internal' | 'external';
  messageRequestState?: 'none' | 'pending' | 'accepted' | 'declined' | 'ignored';
};

type JobApplicationRow = {
  id: string;
  user_id: string;
  job_source: 'internal' | 'employer';
  job_id: string;
  job_title?: string | null;
  company_name?: string | null;
  candidate_name?: string | null;
  candidate_email?: string | null;
  candidate_location?: string | null;
  match_score?: number | null;
  matched_skills?: string[] | null;
  missing_skills?: string[] | null;
  message_request_state?: 'none' | 'pending' | 'accepted' | 'declined' | 'ignored' | null;
  status?: string | null;
  created_at?: string | null;
  applied_at?: string | null;
  updated_at?: string | null;
};


const SKILL_PROGRESS_PERCENT: Record<SkillProgressStatus, number> = {
  missing: 0,
  started: 10,
  in_progress: 35,
  completed: 70,
  evidenced: 90,
  covered: 100,
};

type ResumeAnalyzeResponse = Awaited<ReturnType<typeof analyzeResume>>;

const defaultSurveyAnswers: SurveyAnswers = {
  industry: '',
  role: '',
  setup: '',
  salary: '',
  skill: '',
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
  close: faXmark,
};

function UIIcon({ name, className = '' }: { name: IconName; className?: string }) {
  const baseClass = `cand-inline-icon ${className}`.trim();
  return <FontAwesomeIcon className={baseClass} icon={iconMap[name] || faBars} aria-hidden="true" />;
}

function normalizeSkill(value: string): string {
  return cleanSkillDisplayName(value).toLowerCase().replace(/\s*\([^)]*\)/g, '').trim();
}

const PRESERVED_ACRONYMS = new Set(['SQL', 'HTML', 'CSS', 'CRM', 'API', 'UI', 'UX', 'HR', 'QA', 'SEO', 'AWS', 'PHP', 'BI', 'ETL', 'PDF']);

function titleCase(value: string): string {
  return value
    .split(/(\s+|\/|-|\(|\))/)
    .map((part) => {
      if (!part.trim()) return part;
      const upper = part.toUpperCase();
      if (PRESERVED_ACRONYMS.has(upper)) return upper;
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join('');
}

function cleanSkillDisplayName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';

  const withoutPrefix = trimmed.replace(/^SK[_-]?/i, '');
  const normalized = withoutPrefix.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return titleCase(normalized);
}

function cleanSkillList(skills: string[]): string[] {
  return skills.map(cleanSkillDisplayName).filter(Boolean);
}

function extractStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => extractStringList(item)).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(/\r?\n|;|,/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function getMatchReadinessLabel(score: number): string {
  if (score >= 90) return 'Excellent Match';
  if (score >= 80) return 'Strong Match';
  if (score >= 60) return 'Good Match';
  if (score >= 40) return 'Growth Match';
  if (score >= 1) return 'Partial Match';
  return 'Match pending';
}

function getMatchReadinessClass(score: number): string {
  if (score >= 80) return 'top';
  if (score >= 60) return 'good';
  if (score >= 1) return 'partial';
  return 'develop';
}

function getMatchBadgeLabel(job: DashboardJob): string {
  if (!job.hasMatchScore) return 'Match not available';
  const score = job.hasMatchScore ? Math.max(0, Math.min(100, Math.round(job.matchScore))) : 0;
  return `${score}% · ${getMatchReadinessLabel(score)}`;
}

function getConfidenceLabel(job: DashboardJob): string {
  return job.confidence || 'Not available';
}

function buildJobExplanation(job: DashboardJob): string {
  if (!job.hasMatchScore) return 'Run matching with your current profile to see your alignment with this role.';
  const score = job.hasMatchScore ? Math.max(0, Math.min(100, Math.round(job.matchScore))) : 0;
  const matchedCount = job.matchedSkills.length;
  const missingCount = job.missingSkills.length;
  const firstMissing = cleanSkillDisplayName(job.missingSkills[0] || '');

  if (score >= 80) {
    return `Your profile aligns well with this role because ${matchedCount > 0 ? 'many important skills are already present' : 'your background is closely related'}. ${firstMissing ? `Strengthening ${firstMissing} can improve your readiness even further.` : 'You appear close to role-ready based on your current profile.'}`;
  }

  if (score >= 60) {
    return `You already have several important skills for this role. ${firstMissing ? `Improving ${firstMissing}${missingCount > 1 ? ' and the other missing skills' : ''} can make you a stronger candidate.` : 'A little more targeted preparation can strengthen your readiness.'}`;
  }

  if (job.matchCategory === 'aspiration') {
    return `This role aligns with your career interests, although additional skills are still needed. ${firstMissing ? `Start by building ${firstMissing} to prepare for similar opportunities.` : 'The recommended learning resources can help you prepare for similar opportunities.'}`;
  }

  return `This role has some connection to your current profile, but several key skills are still missing. ${firstMissing ? `Exploring resources for ${firstMissing} can improve your compatibility with similar roles.` : 'Exploring the recommended learning resources can improve your compatibility with similar roles.'}`;
}

function buildKareerGuidanceHeading(job: DashboardJob): 'Why this job matches you' | 'Current Alignment' {
  if (job.hasMatchScore && (job.matchScore > 0 || job.matchedSkills.length > 0)) return 'Why this job matches you';
  return 'Current Alignment';
}

function buildKareerGuidanceText(job: DashboardJob): string {
  if (job.hasMatchScore && (job.matchScore > 0 || job.matchedSkills.length > 0)) {
    return buildJobExplanation(job);
  }
  return 'Match information is not available for this role. Run matching with your current profile to see your alignment.';
}

function buildKareerScoreSupport(job: DashboardJob): string {
  if (!job.hasMatchScore) return 'Kareerly provides guidance only. You are still welcome to explore and apply for this opportunity.';
  if (job.matchScore >= 80) return "You appear to meet many of the employer's requirements.";
  if (job.matchScore >= 60) return 'You meet several requirements but may benefit from strengthening some skills.';
  return 'This role may require additional skills, but you are still welcome to apply.';
}

function getRecommendedNextStep(job: DashboardJob): string {
  const firstMissing = cleanSkillDisplayName(job.missingSkills[0] || '');
  if (firstMissing) return `Start with ${firstMissing} because it is one of the clearest skills to improve for this role.`;
  if (job.matchedSkills.length > 0) return `Build on your current strengths and keep your resume updated as you gain more related experience.`;
  return 'Review the recommended learning resources to build stronger alignment with similar roles.';
}

function getCareerGuidance(job: DashboardJob): string {
  if (!job.hasMatchScore) return 'Run matching with your current profile to generate career guidance for this role.';
  if (job.matchScore >= 80 && job.missingSkills.length <= 2) return 'You are already a strong candidate for this role.';
  if (job.missingSkills.length > 0 && job.missingSkills.length <= 3) return `This role is achievable after improving ${job.missingSkills.length === 1 ? 'one key skill' : `${job.missingSkills.length} key skills`}.`;
  if (job.missingSkills.length > 0) return `Consider exploring resources for ${cleanSkillDisplayName(job.missingSkills[0])} before applying.`;
  return 'You can apply now while continuing to strengthen your profile over time.';
}

type MatchReason = { tone: 'strength' | 'growth'; text: string };

function formatSkillList(skills: string[]): string {
  const names = skills.map(cleanSkillDisplayName).filter(Boolean);
  if (names.length <= 1) return names[0] || '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

function buildMatchReasons(job: DashboardJob, requiredSkills: string[]): MatchReason[] {
  if (!job.hasMatchScore) return [];
  const reasons: MatchReason[] = [];
  const score = Math.max(0, Math.min(100, Math.round(job.matchScore)));
  const matched = job.matchedSkills.slice(0, 4);
  const requiredKeys = new Set(requiredSkills.map(normalizeSkill));
  const directHits = job.matchedSkills.filter((skill) => requiredKeys.has(normalizeSkill(skill)));

  if (matched.length > 0) {
    reasons.push({
      tone: 'strength',
      text: `Your profile already shows ${formatSkillList(matched)}${job.matchedSkills.length > matched.length ? ` and ${job.matchedSkills.length - matched.length} more related skill${job.matchedSkills.length - matched.length === 1 ? '' : 's'}` : ''} — the kind of experience this role relies on day to day.`,
    });
  }
  if (directHits.length > 0 && requiredSkills.length > 0) {
    reasons.push({
      tone: 'strength',
      text: `You meet ${directHits.length} of the ${requiredSkills.length} skills the employer lists as required.`,
    });
  }
  if (job.category && matched.length > 0) {
    reasons.push({ tone: 'strength', text: `Your background lines up with the ${job.category} field, so the core of this work will feel familiar.` });
  }
  if (job.jobLevel && /entry|junior|intern/i.test(job.jobLevel)) {
    const level = job.jobLevel.toLowerCase();
    reasons.push({ tone: 'strength', text: `It's ${/^[aeiou]/.test(level) ? 'an' : 'a'} ${level}-level role, built for people who are still growing their experience.` });
  }
  if (job.missingSkills.length > 0) {
    const gaps = job.missingSkills.slice(0, 3);
    reasons.push({
      tone: 'growth',
      text: `Building ${formatSkillList(gaps)}${job.missingSkills.length > gaps.length ? ' and a few other skills' : ''} would close the main gap${job.missingSkills.length === 1 ? '' : 's'} and raise your ${score}% match.`,
    });
  } else {
    reasons.push({ tone: 'strength', text: 'No major skill gaps were detected for this role.' });
  }
  return reasons;
}

function getLearningForJob(job: DashboardJob, courses: DashboardCourse[]): DashboardCourse[] {
  return courses.filter((course) => course.reviewed && (
    job.missingSkillIds?.length
      ? course.mappedSkillIds.some((id) => job.missingSkillIds!.includes(id))
      : course.mappedSkills.some((skill) => job.missingSkills.some((gap) => cleanSkillDisplayName(gap).toLowerCase() === cleanSkillDisplayName(skill).toLowerCase()))
  ));
}

function getCourseSkillLabels(course: DashboardCourse): string[] {
  const rawSkills = course.mappedSkills.length > 0
    ? course.mappedSkills
    : course.gapTag.split(',').map((skill) => skill.trim()).filter(Boolean);
  return Array.from(new Set(rawSkills.map(cleanSkillDisplayName).filter(Boolean)));
}

function getProgressStatusLabel(status: SkillProgressStatus): string {
  if (status === 'started' || status === 'in_progress') return 'In Progress';
  if (status === 'completed' || status === 'covered') return 'Completed / Covered';
  if (status === 'evidenced') return 'Evidence Uploaded';
  return 'Not Started';
}

function formatGapMissingCount(gap: DashboardGap): string {
  if (gap.affectedCount === null) return 'Affected match count unavailable';
  return `Missing in ${gap.affectedCount} match${gap.affectedCount === 1 ? '' : 'es'}`;
}

function scoreColorClass(score: number): string {
  if (score >= 85) return 'var(--rust)';
  if (score >= 75) return 'var(--forest)';
  if (score >= 65) return 'var(--mauve)';
  return 'var(--tan)';
}

function getMatchScoreBadge(job: DashboardJob): string {
  return getMatchBadgeLabel(job);
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
  if (!value || Number.isNaN(parsed.getTime())) return 'Date unavailable';
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function getSkillLabel(skill: unknown): string {
  if (typeof skill === 'string') return cleanSkillLabel(skill);
  if (skill && typeof skill === 'object') {
    const record = skill as Record<string, unknown>;
    const label = record.name || record.skill_name || record.title || record.message;
    if (typeof label === 'string') return cleanSkillLabel(label);
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

function mapRunMatch(match: MatchResultItem, category: 'fit-now' | 'aspiration'): DashboardJob {
  const scoreContext = category === 'fit-now' ? 'fit_now' : 'aspiration';
  const normalizedScore = extractMatchPercent(match, scoreContext);
  const score = normalizedScore === null ? 0 : Math.round(normalizedScore);
  const dynamic = match as unknown as Record<string, unknown>;
  const externalUrl = typeof dynamic.job_url === 'string' ? dynamic.job_url : typeof dynamic.url === 'string' ? dynamic.url : undefined;
  const jobSource = dynamic.job_source === 'employer' ? 'employer' : 'internal';
  const sourceType: 'internal' | 'external' = externalUrl ? 'external' : 'internal';
  const location = match.location || 'Location not specified';
  const setup = typeof dynamic.work_setup === 'string' && dynamic.work_setup.trim() ? dynamic.work_setup : typeof dynamic.work_type === 'string' && dynamic.work_type.trim() ? dynamic.work_type : 'Work setup not specified';
  const matchedSkills = cleanSkillList(match.matched_skills || []);
  const missingSkills = cleanSkillList(match.missing_skills || []);
  const requiredSkills = Array.from(new Set([...cleanSkillList(extractStringList(match.required_skills)), ...matchedSkills, ...missingSkills]));
  const preferredSkills = cleanSkillList(extractStringList(match.preferred_skills));
  const responsibilities = extractStringList((match as unknown as Record<string, unknown>).responsibilities);
  const categoryLabel = typeof dynamic.category === 'string' && dynamic.category.trim() ? dynamic.category : 'Not specified';
  const subCategoryLabel = typeof dynamic.sub_category === 'string' && dynamic.sub_category.trim() ? dynamic.sub_category : 'Not specified';
  const jobLevel = typeof dynamic.job_level === 'string' && dynamic.job_level.trim() ? dynamic.job_level : 'Not specified';
  return {
    id: match.job_id || `${match.job_title}-${match.company}-${category}`,
    jobSource,
    title: match.job_title || 'Untitled role',
    company: match.company || 'Unknown company',
    location,
    setup,
    employmentType: titleCase(match.employment_type || 'Not specified'),
    salary: typeof dynamic.salary_range_monthly_php === 'string' && dynamic.salary_range_monthly_php.trim() ? dynamic.salary_range_monthly_php : 'Salary not specified',
    matchScore: score,
    hasMatchScore: normalizedScore !== null,
    confidence: typeof dynamic.confidence === 'string' && dynamic.confidence.trim() ? dynamic.confidence.trim() : undefined,
    matchCategory: category,
    sourceType,
    requiredSkills,
    preferredSkills,
    responsibilities,
    description: typeof (match as unknown as Record<string, unknown>).job_description === 'string'
      ? String((match as unknown as Record<string, unknown>).job_description)
      : typeof (match as unknown as Record<string, unknown>).description === 'string'
        ? String((match as unknown as Record<string, unknown>).description)
        : undefined,
    matchedSkills,
    missingSkills,
    missingSkillIds: match.missing_skill_ids,
    explanation: match.explanation || '',
    category: titleCase(categoryLabel),
    subCategory: titleCase(subCategoryLabel),
    jobLevel: titleCase(jobLevel),
    niceToHaveSkills: [],
    externalUrl,
  };
}

function mapModelMatch(match: JobMatch): DashboardJob {
  const score = Math.max(0, Math.min(100, Math.round(match.matchScore)));
  const category: 'fit-now' | 'aspiration' = score >= 75 ? 'fit-now' : 'aspiration';
  const matchedSkills = cleanSkillList((match.requiredSkills || []).filter((skill) => !(match.missingSkills || []).includes(skill)));
  const missingSkills = cleanSkillList(match.missingSkills || []);
  const requiredSkills = Array.from(new Set([...matchedSkills, ...missingSkills]));
  return {
    id: match.id,
    jobSource: 'internal',
    title: match.title,
    company: match.company || 'Unknown company',
    location: 'Location not specified',
    setup: 'Work setup not specified',
    employmentType: 'Not specified',
    salary: 'Salary not specified',
    matchScore: score,
    hasMatchScore: true,
    matchCategory: category,
    sourceType: 'internal',
    requiredSkills,
    preferredSkills: [],
    responsibilities: [],
    description: undefined,
    matchedSkills,
    missingSkills,
    explanation: '',
    category: 'Not specified',
    subCategory: 'Not specified',
    jobLevel: 'Not specified',
    niceToHaveSkills: [],
    externalUrl: undefined,
  };
}

function mapAvailableJob(job: AvailableJobItem): DashboardJob {
  const location = job.location || 'Location not specified';
  const workType = (job.work_type || job.work_setup || '').toLowerCase();
  const setup = workType.includes('remote') ? 'Remote' : workType.includes('hybrid') ? 'Hybrid' : workType.includes('onsite') || workType.includes('on-site') ? 'Onsite' : (job.work_type || job.work_setup || 'Work setup not specified');
  const sourceType: 'internal' | 'external' = job.external_job_link_optional ? 'external' : 'internal';
  const jobSource: 'internal' | 'employer' = job.job_source === 'employer' ? 'employer' : 'internal';
  const requiredSkills = Array.isArray(job.required_skills) ? cleanSkillList(job.required_skills).slice(0, 12) : [];
  const preferredSkills = cleanSkillList(extractStringList(job.preferred_skills));
  const responsibilities = extractStringList(job.responsibilities);

  return {
    id: job.job_id || `${job.job_title}-${job.company_name || 'company'}`,
    jobSource,
    title: job.job_title || 'Untitled role',
    company: job.company_name || 'Unknown company',
    location,
    setup,
    employmentType: titleCase(job.employment_type || 'Not specified'),
    salary: job.salary_range_monthly_php || 'Salary not specified',
    matchScore: 0,
    hasMatchScore: false,
    matchCategory: 'aspiration',
    sourceType,
    requiredSkills,
    preferredSkills,
    responsibilities,
    description: job.job_description || job.description || undefined,
    matchedSkills: [],
    missingSkills: [],
    explanation: 'This role is available in the jobs catalog and can be explored without resume upload.',
    category: titleCase(job.job_category || 'Not specified'),
    subCategory: titleCase(job.job_subcategory || 'Not specified'),
    jobLevel: titleCase(job.experience_level_required || 'Not specified'),
    niceToHaveSkills: [],
    externalUrl: job.external_job_link_optional || undefined,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
    salaryMin: Number(job.salary_min_php || 0) || undefined,
    salaryMax: Number(job.salary_max_php || 0) || undefined,
  };
}

function mergeSupabaseJobDetails(job: DashboardJob, detail?: AvailableJobItem): DashboardJob {
  if (!detail) return job;
  const requiredSkills = Array.isArray(detail.required_skills) ? cleanSkillList(detail.required_skills) : cleanSkillList(extractStringList(detail.required_skills));
  const preferredSkills = cleanSkillList(extractStringList(detail.preferred_skills));
  const responsibilities = extractStringList(detail.responsibilities);
  const workType = detail.work_type || detail.work_setup || '';
  const setup = workType || job.setup;

  return {
    ...job,
    title: detail.job_title || job.title,
    company: detail.company_name || job.company,
    location: detail.location || job.location,
    setup,
    employmentType: titleCase(detail.employment_type || job.employmentType || 'Not specified'),
    salary: detail.salary_range_monthly_php || job.salary,
    requiredSkills: requiredSkills.length > 0 ? requiredSkills : job.requiredSkills,
    preferredSkills: preferredSkills.length > 0 ? preferredSkills : job.preferredSkills,
    responsibilities: responsibilities.length > 0 ? responsibilities : job.responsibilities,
    description: detail.job_description || detail.description || job.description,
    category: titleCase(detail.job_category || job.category || ''),
    subCategory: titleCase(detail.job_subcategory || job.subCategory || ''),
    jobLevel: titleCase(detail.experience_level_required || detail.job_level || job.jobLevel || ''),
    externalUrl: detail.external_job_link_optional || job.externalUrl,
  };
}

function mapApplicationStatus(status: string | null | undefined): ApplicationStatus {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'shortlisted') return 'Shortlisted';
  if (normalized === 'interviewing') return 'Interviewing';
  if (normalized === 'hired') return 'Hired';
  if (normalized === 'rejected') return 'Rejected';
  if (normalized === 'withdrawn') return 'Withdrawn';
  return 'Pending';
}

function mapApplicationRow(row: JobApplicationRow, jobs: DashboardJob[]): DashboardApplication {
  const relatedJob = jobs.find((job) => job.id === row.job_id && job.jobSource === row.job_source);
  return {
    id: row.id,
    jobId: row.job_id,
    jobSource: row.job_source || relatedJob?.jobSource || 'internal',
    jobTitle: row.job_title || relatedJob?.title || 'Untitled role',
    company: row.company_name || relatedJob?.company || 'Unknown company',
    matchScore: savedMatchScore(row.match_score),
    updatedAt: row.updated_at || undefined,
    status: mapApplicationStatus(row.status),
    dateApplied: (row.applied_at || row.created_at || '').slice(0, 10),
    sourceType: 'internal',
    messageRequestState: row.message_request_state || 'none',
  };
}

type ExtractedEducation = NonNullable<ResumeAnalyzeResponse['candidate_profile']['education']>[number];

function extractEducationFromSavedText(resumeText: string): ExtractedEducation[] {
  if (!resumeText.trim()) return [];
  const compact = resumeText.replace(/\s+/g, ' ').trim();
  const degreePatterns: Array<{ pattern: RegExp; attainment: string }> = [
    {
      pattern: /\b(bachelor\s+of\s+science\s+in\s+computer\s+science)\b/i,
      attainment: "Bachelor's Degree",
    },
    {
      pattern: /\b(?:bachelor(?:'s)?|baccalaureate)\s+(?:of|in)\s+([a-z][a-z &,/()\-]{2,80}?)(?=\s+(?:contact|experiences?|skills?|certifications?|projects?|education)\b|$)/i,
      attainment: "Bachelor's Degree",
    },
    {
      pattern: /\bmaster(?:'s)?\s+(?:of|in)\s+([a-z][a-z &,/()\-]{2,80}?)(?=\s+(?:contact|experiences?|skills?|certifications?|projects?|education)\b|$)/i,
      attainment: "Master's Degree",
    },
    {
      pattern: /\b(?:doctorate|doctor|phd)\s+(?:of|in)?\s*([a-z][a-z &,/()\-]{2,80}?)(?=\s+(?:contact|experiences?|skills?|certifications?|projects?|education)\b|$)/i,
      attainment: 'Doctorate Degree',
    },
    {
      pattern: /\bassociate(?:'s)?\s+(?:of|in)\s+([a-z][a-z &,/()\-]{2,80}?)(?=\s+(?:contact|experiences?|skills?|certifications?|projects?|education)\b|$)/i,
      attainment: 'Associate Degree',
    },
  ];

  let degreeProgram = '';
  let attainment = '';
  for (const entry of degreePatterns) {
    const match = compact.match(entry.pattern);
    if (!match) continue;
    const degreePrefix = match[0].slice(0, Math.max(0, match[0].length - (match[1]?.length || 0))).trim();
    degreeProgram = titleCase(`${degreePrefix} ${match[1] || match[0]}`)
      .replace(/\bOf\b/g, 'of')
      .replace(/\bIn\b/g, 'in');
    attainment = entry.attainment;
    break;
  }

  if (!degreeProgram) return [];
  return [{
    highest_educational_attainment: attainment,
    degree_program: degreeProgram,
    school_university: '',
    year_graduated: '',
  }];
}

function withExtractedEducation(analysis: ResumeAnalyzeResponse): ResumeAnalyzeResponse {
  const existingEducation = analysis.candidate_profile?.education || [];
  if (existingEducation.length > 0) return analysis;
  const resumeText = analysis.normalized_for_matching?.resume_text_for_matching
    || analysis.parsedResume?.cleanedText
    || analysis.parsedResume?.rawText
    || '';
  const education = extractEducationFromSavedText(resumeText);
  if (education.length === 0) return analysis;
  return {
    ...analysis,
    candidate_profile: {
      ...analysis.candidate_profile,
      education,
    },
    parsedResume: {
      ...analysis.parsedResume,
      education: education.map((item) => ({
        institution: item.school_university,
        degree: item.degree_program,
        field: item.degree_program,
        graduationYear: Number(item.year_graduated) || 0,
      })),
    },
  };
}

function normalizeSavedResumeAnalysis(record: Awaited<ReturnType<typeof loadLatestResume>>): ResumeAnalyzeResponse | null {
  const analysis = record?.extracted_profile_json;
  if (!analysis) return null;
  const resumeText = analysis.normalized_for_matching?.resume_text_for_matching || record.parsed_text || '';
  const savedEducation = analysis.candidate_profile?.education || [];
  const education = savedEducation.length > 0 ? savedEducation : extractEducationFromSavedText(resumeText);
  return withExtractedEducation({
    ...analysis,
    candidate_profile: {
      ...analysis.candidate_profile,
      education,
    },
    normalized_for_matching: {
      ...(analysis.normalized_for_matching || {}),
      resume_text_for_matching: resumeText,
    },
    parsedResume: analysis.parsedResume || {
      skills: (analysis.candidate_profile?.skills || []).map((skill) => ({ name: skill.skill_name })),
      education: education.map((item) => ({
        institution: item.school_university,
        degree: item.degree_program,
        field: item.degree_program,
        graduationYear: Number(item.year_graduated) || 0,
      })),
      experience: [],
      rawText: resumeText,
      cleanedText: resumeText,
      normalized_for_matching: {
        resume_text_for_matching: resumeText,
      },
    },
    jobMatches: analysis.jobMatches || [],
    skillGaps: analysis.skillGaps || [],
    courseRecommendations: analysis.courseRecommendations || [],
  } as ResumeAnalyzeResponse);
}

function mapRunGap(gap: PrioritizedSkillGap): DashboardGap {
  const severity = mapSeverity(String(gap.severity || 'Moderate'));
  const affectedCount = extractSkillGapMatchCount(gap);
  const affectedPercent = extractSkillGapMatchPercent(gap);
  return {
    skill: cleanSkillDisplayName(gap.skill_name || 'Unnamed skill'),
    severity,
    affectedCount,
    affectedPercent: affectedPercent === null ? undefined : Math.round(affectedPercent),
    priorityScore: parseNumericValue(gap.priority_score) ?? undefined,
    categoryName: gap.category_name || gap.skill_category || '',
    requirementImportance: gap.requirement_importance || '',
    learningResourceAvailable: Boolean(gap.learning_resource_available),
    category: classifySkillCategory(gap.skill_name || ''),
    relatedJobs: (gap.related_jobs || []).map(titleCase).slice(0, 4),
    topResources: (gap.recommended_learning_resources || []).map(mapRunLearningRecommendation).filter((course) => course.reviewed),
    skillId: gap.skill_id,
  };
}

function parseProgressPercent(record: DevelopmentProgressRecord): number {
  const rawValue = record.progress_score ?? record.progress_percentage ?? record.progress_percent ?? record.percentage;
  const numeric = parseNumericValue(rawValue);
  if (numeric === null) return 0;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function normalizeProgressLabel(percent: number, backendLabel?: string): ProgressStatus {
  const derived = categoryStatus(percent);
  if (!backendLabel?.trim()) return derived;
  return {
    ...derived,
    label: backendLabel.trim(),
  };
}

function mapModelGap(gap: SkillGap, matches: JobMatch[]): DashboardGap {
  const severity = gap.importance === 'critical' ? 'Critical' : gap.importance === 'high' ? 'High' : 'Moderate';
  const related = matches
    .filter((match) => (match.missingSkills || []).some((skill) => normalizeSkill(skill) === normalizeSkill(gap.skill)))
    .map((match) => match.title)
    .slice(0, 4);
  return {
    skill: cleanSkillDisplayName(gap.skill),
    severity,
    affectedCount: gap.frequency || related.length,
    category: classifySkillCategory(gap.skill),
    relatedJobs: related,
  };
}

const CREDENTIAL_LABELS: Record<CredentialType, string> = {
  exam_review: 'Licensure exam review',
  professional_certificate: 'Professional certificate',
  industry_certification: 'Industry certification',
  certificate_course: 'Certificate on completion',
  course: 'Course, no certificate',
};

/** Only these award something a candidate can show an employer. */
function grantsCredential(credentialType: CredentialType): boolean {
  return credentialType !== 'course' && credentialType !== 'exam_review';
}

function resolveCredentialType(value: unknown, fallbackHasCertificate?: boolean): CredentialType {
  const raw = String(value || '').trim().toLowerCase();
  if (raw in CREDENTIAL_LABELS) return raw as CredentialType;
  // Legacy records with only a boolean: keep the weaker of the two claims.
  return fallbackHasCertificate ? 'certificate_course' : 'course';
}

function mapCourse(rec: CourseRecommendation): DashboardCourse {
  const primaryGap = cleanSkillDisplayName(rec.matchedSkillGaps?.[0] || rec.course?.skillsTargeted?.[0] || rec.course?.title || 'General');
  return {
    id: rec.id || rec.courseId,
    title: rec.course?.title || 'Untitled course',
    provider: rec.course?.provider || 'Course provider',
    duration: rec.course?.duration || 'Duration unknown',
    level: rec.course?.difficulty || 'Level unknown',
    credentialType: resolveCredentialType(rec.course?.credentialType, rec.course?.certificateAvailable),
    credentialLabel: rec.course?.credentialType || rec.course?.certificateAvailable !== undefined ? CREDENTIAL_LABELS[resolveCredentialType(rec.course?.credentialType, rec.course?.certificateAvailable)] : 'Credential not specified',
    isFree: Boolean(rec.course?.isFree),
    gapTag: primaryGap,
    mappedSkills: [], mappedSkillIds: [], reviewed: false, fees: 'Unknown', certificateCost: 'Unknown', prerequisites: 'Unknown', credentialConditions: 'Unknown',
    url: rec.course?.url,
    urlLabel: 'Open Resource',
    deliveryMode: undefined,
    source: 'backend',
  };
}

function mapRunLearningRecommendation(rec: RunLearningRecommendation): DashboardCourse {
  const mappedSkills = (rec.matched_gap_skill_names || []).filter(Boolean);
  const gapTag = mappedSkills.map(cleanSkillDisplayName).join(', ');
  return {
    id: rec.resource_id || rec.title,
    title: rec.title || 'Untitled course',
    provider: rec.provider || 'Course provider',
    duration: rec.estimated_duration || 'Duration unknown',
    level: rec.level || 'Level unknown',
    credentialType: resolveCredentialType(rec.credential_type),
    credentialLabel: rec.credential_label || (rec.credential_type ? CREDENTIAL_LABELS[resolveCredentialType(rec.credential_type)] : 'Credential not specified'),
    isFree: String(rec.cost_type || '').trim().toLowerCase() === 'free',
    gapTag,
    mappedSkills, mappedSkillIds: rec.matched_gap_skill_ids || [], reviewed: rec.review_status === 'verified' && mappedSkills.length > 0 && rec.matched_gap_skill_ids?.length > 0,
    fees: rec.cost_type || 'Unknown', certificateCost: rec.certificate_cost || 'Unknown',
    prerequisites: rec.prerequisites || 'Unknown', credentialConditions: rec.credential_conditions || 'Unknown',
    verifiedAt: rec.last_verified_at,
    url: rec.url || undefined,
    urlLabel: ['Start learning', 'View preparation course', 'View certification'].includes(rec.url_label || '') ? rec.url_label! : 'Start learning',
    deliveryMode: rec.delivery_mode || undefined,
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

function statusKey(status: ApplicationStatus): 'pending' | 'shortlisted' | 'interviewing' | 'hired' | 'rejected' | 'withdrawn' {
  return status.toLowerCase() as 'pending' | 'shortlisted' | 'interviewing' | 'hired' | 'rejected' | 'withdrawn';
}

const APPLICATION_STATUS_FILTERS = [
  ['pending', 'Pending'],
  ['shortlisted', 'Shortlisted'],
  ['interviewing', 'Interviewing'],
  ['hired', 'Hired'],
  ['rejected', 'Rejected'],
  ['withdrawn', 'Withdrawn'],
] as const;

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

  return <CandidateWorkspace currentUser={currentUser} onHome={onHome} onUpdateResume={onUpdateResume} onLogout={onLogout} />;
}

function CandidateWorkspace({ currentUser, onHome, onUpdateResume, onLogout }: Pick<DashboardProps, 'onHome' | 'onUpdateResume' | 'onLogout'> & { currentUser: NonNullable<DashboardProps['currentUser']> }) {
  const {
    state,
    setResumeFile,
    setParsedResume,
    setResumeAnalysis,
    setSavedResumeId,
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
  const [jobFilter, setJobFilter] = useState<JobFilter>('top');
  const [upskillTab, setUpskillTab] = useState<UpskillTab>('recommended');
  const [selectedKareerId, setSelectedKareerId] = useState<string>('');
  const [savedJobs, setSavedJobs] = useState<Set<string>>(() => new Set());
  const [applications, setApplications] = useState<DashboardApplication[]>([]);
  const [applicationLoadStatus, setApplicationLoadStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [notifications, setNotifications] = useState<CandidateNotification[]>([]);
  const [notificationLoadStatus, setNotificationLoadStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  const [inlineNotice, setInlineNotice] = useState<{ message: string; type: ToastType } | null>(null);
  const [uiLanguage, setUiLanguageState] = useState<UiLanguage>(() => {
    const saved = window.localStorage.getItem('kareerly.uiLanguage');
    return saved === 'fil' ? 'fil' : 'en';
  });
  const setUiLanguage = useCallback((language: UiLanguage) => {
    setUiLanguageState(language);
    window.localStorage.setItem('kareerly.uiLanguage', language);
    document.documentElement.lang = language === 'fil' ? 'fil' : 'en';
  }, []);

  useEffect(() => {
    document.documentElement.lang = uiLanguage === 'fil' ? 'fil' : 'en';
  }, [uiLanguage]);
  const [jobDetailOpen, setJobDetailOpen] = useState(false);
  const [selectedJob, setSelectedJob] = useState<DashboardJob | null>(null);
  const [withdrawModalOpen, setWithdrawModalOpen] = useState(false);
  const [withdrawTarget, setWithdrawTarget] = useState<DashboardApplication | null>(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [resumeModalOpen, setResumeModalOpen] = useState(false);
  const [evidenceModalOpen, setEvidenceModalOpen] = useState(false);
  const [editingEvidence, setEditingEvidence] = useState<EvidenceUploadRecord | null>(null);
  const [deleteEvidenceTarget, setDeleteEvidenceTarget] = useState<EvidenceUploadRecord | null>(null);
  const [resumeStep, setResumeStep] = useState<'upload' | 'decision' | 'review'>('upload');
  const [resumeDragOver, setResumeDragOver] = useState(false);
  const [resumeUploadFile, setResumeUploadFile] = useState<File | null>(null);
  const [resumeAnalyzeData, setResumeAnalyzeData] = useState<ResumeAnalyzeResponse | null>(null);
  const [resumeActionError, setResumeActionError] = useState('');
  const savedResumeUploadId = useRef<string | null>(null);
  const [reviewSkills, setReviewSkills] = useState<string[]>([]);
  const [newSkillInput, setNewSkillInput] = useState('');
  const [resumePostRefreshTarget, setResumePostRefreshTarget] = useState<'dashboard' | 'preferences'>('dashboard');
  const [savedResumeFileName, setSavedResumeFileName] = useState('');
  const [resumePreview, setResumePreview] = useState<{ url: string; name: string; mimeType: string; local: boolean } | null>(null);
  const [docxPreviewResult, setDocxPreviewResult] = useState<{ url: string; html: string; error: string } | null>(null);
  const [candidatePublicId, setCandidatePublicId] = useState('');
  const [skillNames, setSkillNames] = useState<string[]>(() => extractSkillsFromResume(state.resume));
  const [selectedThreadJobId, setSelectedThreadJobId] = useState<string>('');
  const [messageRequests, setMessageRequests] = useState<Record<string, string>>({});
  const [messageDraft, setMessageDraft] = useState('');
  const [messageReplies, setMessageReplies] = useState<Record<string, Array<{ from: 'employer' | 'candidate'; text: string; time: string }>>>({});
  const [extraPreferences, setExtraPreferences] = useState({ jobLevel: '', preferredLocation: '' });
  const [availableJobs, setAvailableJobs] = useState<AvailableJobItem[]>([]);
  const [isLoadingKareers, setIsLoadingKareers] = useState(true);
  const [kareersError, setKareersError] = useState<string | null>(null);
  // Only explicit evidence uploads belong here; resume mentions are not uploaded or verified evidence.
  const [evidenceRecords, setEvidenceRecords] = useState<EvidenceUploadRecord[]>([]);
  const [skillProgressRecords, setSkillProgressRecords] = useState<Record<string, SkillProgressRecord>>({});
  const [profileForm, setProfileForm] = useState({
    contactNumber: '',
    birthday: '',
    address: '',
    location: '',
    highestEducationalAttainment: '',
    degreeProgram: '',
    schoolUniversity: '',
    yearGraduated: '',
  });
  const [accountIdentity, setAccountIdentity] = useState({ name: currentUser.name, email: currentUser.email });
  const [accountPassword, setAccountPassword] = useState({ current: '', next: '', confirm: '' });
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
  const [profileSaveNotice, setProfileSaveNotice] = useState<string | null>(null);

  const toastTimeoutRef = useRef<number | null>(null);

  const displayName = accountIdentity.name || currentUser.email.split('@')[0] || 'Candidate';
  const displayEmail = accountIdentity.email;
  const initials = getInitials(displayName, displayEmail);
  const surveyAnswers = state.surveyAnswers || defaultSurveyAnswers;
  const candidateProfile = state.resumeAnalysis?.candidate_profile;
  const educationIndicators = candidateProfile?.education_indicators || [];
  const experienceIndicators = candidateProfile?.experience_indicators || [];
  const matchedLocation = profileForm.location || extraPreferences.preferredLocation || '';

  useEffect(() => {
    const extracted = extractSkillsFromResume(state.resume);
    if (extracted.length > 0) setSkillNames(extracted);
  }, [state.resume?.skills]);

  useEffect(() => {
    const isDocx = resumePreview
      && (resumePreview.mimeType.includes('wordprocessingml') || resumePreview.name.toLowerCase().endsWith('.docx'));

    if (!isDocx || !resumePreview) return;

    let cancelled = false;

    const renderDocx = async () => {
      try {
        const response = await fetch(resumePreview.url);
        if (!response.ok) throw new Error(`Unable to load resume (${response.status}).`);
        const result = await mammoth.convertToHtml({ arrayBuffer: await response.arrayBuffer() });
        if (!cancelled) setDocxPreviewResult({ url: resumePreview.url, html: DOMPurify.sanitize(result.value), error: '' });
      } catch (error) {
        console.warn('Unable to render DOCX resume preview:', error);
        if (!cancelled) setDocxPreviewResult({
          url: resumePreview.url,
          html: '',
          error: 'Unable to preview this DOCX file. Please try again or upload a new copy.',
        });
      }
    };

    void renderDocx();
    return () => { cancelled = true; };
  }, [resumePreview]);

  const updateSkillProgressStatus = (skillKey: string, status: SkillProgressStatus, selectedResourceId?: string) => {
    setSkillProgressRecords((current) => {
      const existing = current[skillKey];
      if (!existing) return current;
      return {
        ...current,
        [skillKey]: {
          ...existing,
          status,
          progressPercent: SKILL_PROGRESS_PERCENT[status],
          selectedResourceId: selectedResourceId || existing.selectedResourceId,
        },
      };
    });
  };
  useEffect(() => {
    let isMounted = true;
    void (async () => {
      const data = await loadCandidateAccountSettings();
      if (!isMounted || !data) return;
      setAccountIdentity({ name: data.full_name || currentUser.name, email: data.email || currentUser.email });
      setCandidatePublicId(String(data.public_id || ''));
      setProfileForm((current) => ({
        ...current,
        contactNumber: data.contact_number || current.contactNumber,
        address: data.address || current.address,
        birthday: data.birthday || current.birthday,
        location: data.location || current.location,
        highestEducationalAttainment: data.highest_educational_attainment || current.highestEducationalAttainment,
        degreeProgram: data.degree_program || current.degreeProgram,
        schoolUniversity: data.school_university || current.schoolUniversity,
        yearGraduated: data.year_graduated || current.yearGraduated,
      }));
    })().catch((error) => { if (isMounted) console.warn('Unable to load account settings:', error); });
    return () => {
      isMounted = false;
    };
  }, [currentUser.id]);

  useEffect(() => {
    let isMounted = true;
    void supabase
      .from('saved_jobs')
      .select('job_id, job_source')
      .eq('user_id', currentUser.id)
      .then(({ data, error }) => {
        if (!isMounted) return;
        if (error) {
          console.warn('Unable to load saved jobs:', error);
          return;
        }
        setSavedJobs(new Set((data || []).map((row) => String(row.job_id)).filter(Boolean)));
      });
    return () => { isMounted = false; };
  }, [currentUser.id]);

  useEffect(() => {
    let isMounted = true;
    void (async () => {
      if (!currentUser.id) return;
      if ((state.resumeAnalysis || state.savedResumeId) && savedResumeFileName) return;
      const latestResume = await loadLatestResume({ userId: currentUser.id });
      if (!isMounted || !latestResume) return;

      setSavedResumeFileName(latestResume.original_filename || 'Saved resume');
      if (state.resumeAnalysis || state.resumeFile || state.savedResumeId) {
        if (!state.savedResumeId) setSavedResumeId(latestResume.id);
        return;
      }

      const analysis = normalizeSavedResumeAnalysis(latestResume);
      if (!analysis) return;

      applyAnalysisResult(analysis);
      setSavedResumeId(latestResume.id);
      const restoredSkills = extractSkillsFromResume(analysis.parsedResume);
      if (restoredSkills.length > 0) setSkillNames(restoredSkills);

      const savedMatches = await loadLatestMatchHistory({ userId: currentUser.id, resumeId: latestResume.id });
      if (isMounted && savedMatches) setMatchResults(savedMatches);
    })();

    return () => {
      isMounted = false;
    };
  }, [currentUser.id, savedResumeFileName, state.resumeAnalysis, state.resumeFile, state.savedResumeId]);

  const saveCandidateProfile = async () => {
    if (!currentUser.id) return;
    setIsSavingProfile(true);
    setProfileSaveNotice(null);
    try {
      const saved = await saveCandidateAccountSettings({
        full_name: accountIdentity.name,
        email: accountIdentity.email,
        birthday: profileForm.birthday,
        location: profileForm.location,
        contact_number: profileForm.contactNumber,
        address: profileForm.address,
        highest_educational_attainment: profileForm.highestEducationalAttainment,
        degree_program: profileForm.degreeProgram,
        school_university: profileForm.schoolUniversity,
        year_graduated: profileForm.yearGraduated,
      });
      setAccountIdentity({ name: saved.full_name, email: saved.email });

      setProfileSaveNotice('Personal details saved successfully.');
      showToast('Personal details saved.', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save personal details.';
      showToast(message, 'danger');
      setProfileSaveNotice(null);
    } finally {
      setIsSavingProfile(false);
    }
  };

  const updateCandidatePassword = async () => {
    if (!accountPassword.current || !accountPassword.next || accountPassword.next !== accountPassword.confirm) {
      showToast(accountPassword.next !== accountPassword.confirm ? 'New passwords do not match.' : 'Complete all password fields.', 'warn');
      return;
    }
    if (accountPassword.next.length < 8) { showToast('New password must be at least 8 characters.', 'warn'); return; }
    setIsUpdatingPassword(true);
    try {
      const { error: verifyError } = await supabase.auth.signInWithPassword({ email: displayEmail, password: accountPassword.current });
      if (verifyError) throw new Error('Current password is incorrect.');
      const { error } = await supabase.auth.updateUser({ password: accountPassword.next });
      if (error) throw error;
      setAccountPassword({ current: '', next: '', confirm: '' });
      showToast('Password updated successfully.', 'success');
    } catch (error) { showToast(error instanceof Error ? error.message : 'Unable to update password.', 'danger'); }
    finally { setIsUpdatingPassword(false); }
  };

  const loadKareers = useCallback(async (silent = false) => {
    if (!silent) setIsLoadingKareers(true);
    setKareersError(null);
    try {
      const response = await fetchAvailableJobs();
      setAvailableJobs(response.results || []);
    } catch (error) {
      if (!silent) setAvailableJobs([]);
      setKareersError(error instanceof Error ? error.message : 'Unable to load jobs.');
    } finally {
      if (!silent) setIsLoadingKareers(false);
    }
  }, []);

  useEffect(() => { void loadKareers(); }, [loadKareers]);

  useEffect(() => {
    if (activePage !== 'kareers') return;
    void loadKareers(true);
    const refresh = () => { if (document.visibilityState === 'visible') void loadKareers(true); };
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [activePage, loadKareers]);

  const jobs = useMemo<DashboardJob[]>(() => {
    const catalogById = new Map(availableJobs.map((job) => [job.job_id, job]));
    const restoreCatalogIdentity = (job: DashboardJob): DashboardJob => {
      const catalog = catalogById.get(job.id);
      if (!catalog) return job;
      return {
        ...mergeSupabaseJobDetails(job, catalog),
        company: job.company && job.company !== 'Unknown company' ? job.company : catalog.company_name || 'Unknown company',
        jobSource: catalog.job_source === 'employer' ? 'employer' : job.jobSource,
      };
    };
    if (state.matchResults) {
      const fitNow = (state.matchResults.all_fit_now_matches || state.matchResults.fit_now_matches || []).map((match) => restoreCatalogIdentity(mapRunMatch(match, 'fit-now')));
      const fitNowIds = new Set(fitNow.map((job) => job.id));
      const aspiration = (state.matchResults.all_aspiration_matches || state.matchResults.aspiration_matches || [])
        .map((match) => restoreCatalogIdentity(mapRunMatch(match, 'aspiration')))
        .filter((job) => !fitNowIds.has(job.id));
      return [...fitNow, ...aspiration].sort((a, b) => b.matchScore - a.matchScore);
    }
    if (state.results?.jobMatches?.length) {
      return state.results.jobMatches.map((match) => restoreCatalogIdentity(mapModelMatch(match))).sort((a, b) => b.matchScore - a.matchScore);
    }
    return [];
  }, [availableJobs, state.matchResults, state.results?.jobMatches]);

  useEffect(() => {
    let isMounted = true;
    void (async () => {
      if (!currentUser.id) return;
      const { data, error } = await supabase
        .from('job_applications')
        .select('*')
        .eq('user_id', currentUser.id)
        .order('applied_at', { ascending: false });

      if (error) {
        console.warn('Unable to load applications:', error);
        if (isMounted) setApplicationLoadStatus('error');
        return;
      }

      if (!isMounted) return;
      const rows = Array.isArray(data) ? (data as JobApplicationRow[]) : [];
      setApplications(rows.map((row) => mapApplicationRow(row, jobs)));
      setApplicationLoadStatus('ready');
    })();

    return () => {
      isMounted = false;
    };
  }, [currentUser.id, jobs]);

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
      return state.matchResults.learning_recommendations.map(mapRunLearningRecommendation).filter((course) => course.reviewed);
    }
    return (state.results?.courseRecommendations || []).map(mapCourse).filter((course) => course.reviewed);
  }, [state.matchResults?.learning_recommendations, state.results?.courseRecommendations]);

  useEffect(() => {
    if (gaps.length === 0) return;
    setSkillProgressRecords((current) => {
      const next = { ...current };
      const activeKeys = new Set<string>();

      gaps.forEach((gap) => {
        const key = (gap.skillId || normalizeSkill(gap.skill)).toUpperCase();
        activeKeys.add(key);
        if (!next[key]) {
          next[key] = {
            skillId: gap.skillId,
            skillName: gap.skill,
            category: gap.category,
            categoryName: gap.categoryName || gap.category,
            status: 'missing',
            progressPercent: SKILL_PROGRESS_PERCENT.missing,
            selectedResourceId: gap.topResources?.[0]?.id,
          };
        } else {
          next[key] = {
            ...next[key],
            skillId: gap.skillId || next[key].skillId,
            skillName: gap.skill,
            category: gap.category,
            categoryName: gap.categoryName || gap.category,
            selectedResourceId: next[key].selectedResourceId || gap.topResources?.[0]?.id,
          };
        }
      });

      Object.entries(next).forEach(([key, record]) => {
        if (!activeKeys.has(key) && record.status !== 'covered') {
          next[key] = {
            ...record,
            status: 'covered',
            progressPercent: SKILL_PROGRESS_PERCENT.covered,
          };
        }
      });

      return next;
    });
  }, [gaps]);

  const categoryProgress = useMemo<CategoryProgressRow[]>(() => {
    const progressEntries = Object.values(skillProgressRecords);
    if (progressEntries.length > 0) {
      const grouped = new Map<SkillCategory, SkillProgressRecord[]>();
      progressEntries.forEach((record) => {
        const list = grouped.get(record.category) || [];
        list.push(record);
        grouped.set(record.category, list);
      });

      return Array.from(grouped.entries()).map(([category, records]) => {
        const relatedSkillRecords = records.map((record) => record.skillName);
        const percent = Math.round(records.reduce((sum, record) => sum + record.progressPercent, 0) / Math.max(records.length, 1));
        const completed = records.filter((record) => ['completed', 'evidenced', 'covered'].includes(record.status)).length;
        const inProgress = records.filter((record) => ['started', 'in_progress'].includes(record.status)).length;
        const evidenceUploaded = records.filter((record) => Boolean(record.evidenceFilename)).length;
        const missing = records.filter((record) => !['covered'].includes(record.status)).length;
        const matched = records.filter((record) => record.status === 'covered').length;

        return {
          category,
          percent,
          missing,
          matched,
          completed,
          inProgress,
          evidenceUploaded,
          relatedSkillRecords,
          recentActivity: records.find((record) => record.evidenceUploadedAt)?.evidenceUploadedAt
            ? `Recent evidence uploaded ${formatDateLabel(records.find((record) => record.evidenceUploadedAt)?.evidenceUploadedAt || '')}`
            : undefined,
        };
      }).sort((a, b) => b.percent - a.percent);
    }

    const backendProgress = state.matchResults?.development_progress || [];
    if (backendProgress.length > 0) {
      return backendProgress
        .map((row) => {
          const categoryName = String(row.category_name || row.category || 'Other').trim();
          const relatedSkillRecords = Array.isArray(row.related_skill_records)
            ? row.related_skill_records
            : Array.isArray(row.related_skills)
              ? row.related_skills
              : Array.isArray(row.skill_records)
                ? row.skill_records
              : [];
          const missingSkills = Array.isArray(row.missing_skills) ? row.missing_skills : [];
          const coveredSkills = Array.isArray(row.covered_skills) ? row.covered_skills : [];

          return {
            category: classifySkillCategory(categoryName) === 'Other' ? (titleCase(categoryName) as SkillCategory) : classifySkillCategory(categoryName),
            percent: parseProgressPercent(row),
            missing: missingSkills.length,
            matched: coveredSkills.length,
            completed: Math.max(0, parseNumericValue(row.completed_count ?? row.completed_learning) ?? 0),
            inProgress: Math.max(0, parseNumericValue(row.in_progress_count) ?? 0),
            evidenceUploaded: Math.max(0, parseNumericValue(row.evidence_uploaded_count ?? row.supporting_evidence) ?? 0),
            relatedSkillRecords: relatedSkillRecords.filter(Boolean).map(titleCase),
            recentActivity: typeof (row as Record<string, unknown>).recent_activity === 'string'
              ? String((row as Record<string, unknown>).recent_activity)
              : undefined,
          };
        })
        .filter((row) => row.relatedSkillRecords.length > 0 || row.missing > 0 || row.matched > 0 || row.completed > 0 || row.inProgress > 0 || row.evidenceUploaded > 0)
        .sort((a, b) => b.percent - a.percent);
    }

    const missingByCategory = new Map<SkillCategory, Set<string>>();
    const matchedByCategory = new Map<SkillCategory, Set<string>>();
    const courseIdsByCategory = new Map<SkillCategory, Set<string>>();
    const evidenceByCategory = new Map<SkillCategory, number>();

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
    evidenceRecords.forEach((record) => {
      const category = classifySkillCategory(record.category || record.relatedSkill || record.title);
      evidenceByCategory.set(category, (evidenceByCategory.get(category) || 0) + 1);
    });

    const dynamicCategories = new Set<SkillCategory>();
    missingByCategory.forEach((_skills, category) => dynamicCategories.add(category));
    matchedByCategory.forEach((_skills, category) => dynamicCategories.add(category));
    courseIdsByCategory.forEach((_ids, category) => dynamicCategories.add(category));
    evidenceByCategory.forEach((_count, category) => dynamicCategories.add(category));

    if (dynamicCategories.size === 0) return [];

    return Array.from(dynamicCategories).map((category) => {
      const missing = missingByCategory.get(category)?.size || 0;
      const matched = matchedByCategory.get(category)?.size || 0;
      const courseIds = Array.from(courseIdsByCategory.get(category) || []);
      const completed = 0;
      const startedOnly = 0;
      const evidenceUploaded = evidenceByCategory.get(category) || 0;
      const hasProgressEvidence = completed > 0 || startedOnly > 0 || evidenceUploaded > 0 || missing > 0 || matched > 0;
      const relatedSkillRecords = [
        ...Array.from(missingByCategory.get(category) || []).map(titleCase),
        ...Array.from(matchedByCategory.get(category) || []).map(titleCase),
      ];

      let percent = 0;

      if (hasProgressEvidence) {
        const totalRelevantCourses = Math.max(1, courseIds.length, completed + startedOnly);
        const learningCompletion = (completed / totalRelevantCourses) * 100;
        const skillGapReduction = missing + matched > 0 ? (matched / (missing + matched)) * 100 : 0;
        const uploadedEvidence = evidenceUploaded > 0 ? Math.min(100, (evidenceUploaded / Math.max(1, relatedSkillRecords.length || evidenceUploaded)) * 100) : 0;
        const recentActivity = ((completed + startedOnly) / totalRelevantCourses) * 100;

        percent = Math.round(
          (0.35 * learningCompletion)
          + (0.30 * skillGapReduction)
          + (0.20 * uploadedEvidence)
          + (0.15 * recentActivity),
        );
      }

      return {
        category,
        percent,
        missing,
        matched,
        completed,
        inProgress: startedOnly,
        evidenceUploaded,
        relatedSkillRecords: Array.from(new Set(relatedSkillRecords)),
        recentActivity: evidenceUploaded > 0 ? `${evidenceUploaded} evidence upload${evidenceUploaded === 1 ? '' : 's'}` : undefined,
      };
    })
      .filter((row) => row.relatedSkillRecords.length > 0 || row.missing > 0 || row.matched > 0 || row.completed > 0 || row.inProgress > 0 || row.evidenceUploaded > 0)
      .sort((a, b) => b.percent - a.percent);
  }, [courses, evidenceRecords, gaps, jobs, skillProgressRecords, state.matchResults?.development_progress]);

  const metricCards = useMemo(() => {
    const hasMatchingResults = Boolean(state.matchResults || state.results);
    const fitNowCount = jobs.filter((job) => job.matchCategory === 'fit-now').length;
    const aspirationCount = jobs.filter((job) => job.matchCategory === 'aspiration').length;
    const topFitNowCount = Math.min(fitNowCount, TOP_MATCHES_PER_CATEGORY);
    const topAspirationCount = Math.min(aspirationCount, TOP_MATCHES_PER_CATEGORY);
    const hasResumeUploaded = Boolean(state.resumeFile || state.resume || state.resumeAnalysis);
    const confirmedSkillsCount = skillNames.length || state.resumeAnalysis?.normalized_for_matching?.skill_ids?.length || 0;
    const hasPreferencesCompleted = Boolean(surveyAnswers.industry && surveyAnswers.role && surveyAnswers.setup && surveyAnswers.salary);
    const hasProfileDetails = Boolean(profileForm.location || profileForm.highestEducationalAttainment || profileForm.degreeProgram || profileForm.schoolUniversity || profileForm.yearGraduated);
    const profileCompletion =
      (hasResumeUploaded ? 30 : 0) +
      (confirmedSkillsCount > 0 ? 30 : 0) +
      (hasPreferencesCompleted ? 25 : 0) +
      (hasProfileDetails || educationIndicators.length > 0 || experienceIndicators.length > 0 ? 15 : 0);
    return [
      {
        label: 'Profile Completion',
        value: `${profileCompletion}%`,
        detail: hasResumeUploaded ? `${confirmedSkillsCount} skills confirmed · ${hasPreferencesCompleted ? 'preferences saved' : 'preferences incomplete'}` : 'Resume not uploaded yet',
        iconClass: 'green',
        valueColor: 'var(--green)',
        icon: 'check-circle' as IconName,
      },
      {
        label: 'Job Matches',
        value: hasMatchingResults ? String(fitNowCount + aspirationCount) : '—',
        detail: hasMatchingResults ? `Showing top ${topFitNowCount} Fit-Now · ${topAspirationCount} Aspiration` : state.isLoading ? 'Matching in progress' : 'Run matching to see your results',
        iconClass: 'amber',
        valueColor: 'var(--amber)',
        icon: 'briefcase' as IconName,
      },
      {
        label: 'Skill Gaps',
        value: hasMatchingResults ? String(gaps.length) : '—',
        detail: hasMatchingResults ? `${gaps.filter((gap) => gap.severity === 'Critical').length} critical · ${gaps.filter((gap) => gap.severity === 'High').length} high` : 'Run matching to identify skill gaps',
        iconClass: 'mauve',
        valueColor: 'var(--mauve)',
        icon: 'puzzle' as IconName,
      },
      {
        label: 'Applications',
        value: applicationLoadStatus === 'ready' ? String(applications.length) : '—',
        detail: applicationLoadStatus === 'ready' ? `${applications.filter((app) => app.status === 'Interviewing').length} interviewing · ${applications.filter((app) => app.status === 'Shortlisted').length} shortlisted` : applicationLoadStatus === 'error' ? 'Applications unavailable' : 'Loading applications',
        iconClass: 'forest',
        valueColor: 'var(--forest)',
        icon: 'layers' as IconName,
      },
    ];
  }, [applicationLoadStatus, state.matchResults, state.results, state.isLoading, applications, educationIndicators.length, experienceIndicators.length, gaps, jobs, profileForm.degreeProgram, profileForm.highestEducationalAttainment, profileForm.location, profileForm.schoolUniversity, profileForm.yearGraduated, skillNames.length, state.resume, state.resumeAnalysis, state.resumeFile, surveyAnswers.industry, surveyAnswers.role, surveyAnswers.salary, surveyAnswers.setup]);

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
    if (interviewingApp) steps.push(interviewingApp.messageRequestState === 'pending' || interviewingApp.messageRequestState === 'accepted' ? `Check ${interviewingApp.company} interview-stage updates in Messages.` : `Review your ${interviewingApp.jobTitle} application at ${interviewingApp.company}.`);
    if (steps.length === 0) steps.push('Upload a resume and confirm skills to generate personalized next steps.');
    return steps.slice(0, 3);
  }, [applications, gaps, jobs]);

  const courseRecommendations = useMemo(() => courses.slice(0, 3), [courses]);
  const unreadNotificationCount = useMemo(() => notifications.filter((row) => !row.read_at).length, [notifications]);
  const loadNotifications = useCallback(async () => {
    if (!currentUser.id) return;
    try {
      const rows = await listCandidateNotifications();
      setNotifications(rows);
      setNotificationLoadStatus('ready');
    } catch (notificationError) {
      console.warn('Unable to load notifications:', notificationError);
      setNotificationLoadStatus('error');
    }
  }, [currentUser.id]);

  useEffect(() => {
    if (!currentUser.id) return undefined;
    let active = true;
    listCandidateNotifications()
      .then((rows) => {
        if (!active) return;
        setNotifications(rows);
        setNotificationLoadStatus('ready');
      })
      .catch((notificationError) => {
        console.warn('Unable to load notifications:', notificationError);
        if (active) setNotificationLoadStatus('error');
      });
    return () => { active = false; };
  }, [currentUser.id]);

  const fitNowJobs = useMemo(() => jobs.filter((job) => job.matchCategory === 'fit-now'), [jobs]);
  const aspirationJobs = useMemo(() => jobs.filter((job) => job.matchCategory === 'aspiration'), [jobs]);
  const topFitNowJobs = useMemo(() => fitNowJobs.slice(0, TOP_MATCHES_PER_CATEGORY), [fitNowJobs]);
  const topAspirationJobs = useMemo(() => aspirationJobs.slice(0, TOP_MATCHES_PER_CATEGORY), [aspirationJobs]);
  const topMatches = useMemo(() => [...topFitNowJobs, ...topAspirationJobs], [topAspirationJobs, topFitNowJobs]);
  const topFitNowMatchesCount = topFitNowJobs.length;
  const topAspirationMatchesCount = topAspirationJobs.length;
  const topAllMatchesCount = topMatches.length;
  const totalQualifyingMatchesCount = jobs.length;

  const filteredJobs = useMemo(() => {
    const query = jobSearch.trim().toLowerCase();
    const visiblePool =
      jobFilter === 'top'
        ? topMatches
        : jobFilter === 'fit-now'
          ? topFitNowJobs
          : jobFilter === 'aspiration'
            ? topAspirationJobs
            : jobs;

    return visiblePool.filter((job) => {
      if (jobFilter === 'internal' && job.sourceType !== 'internal') return false;
      if (jobFilter === 'external' && job.sourceType !== 'external') return false;
      if (jobFilter === 'saved' && !savedJobs.has(job.id)) return false;
      if (!query) return true;
      return [job.title, job.company, job.location, job.category || '', job.subCategory || '', job.jobLevel || '', job.matchedSkills.join(' '), job.missingSkills.join(' '), job.explanation]
        .join(' ')
        .toLowerCase()
        .includes(query);
    });
  }, [jobFilter, jobSearch, jobs, savedJobs, topAspirationJobs, topFitNowJobs, topMatches]);

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
  const savedJobRows = useMemo(() => kareersList.filter((job) => savedJobs.has(job.id)), [kareersList, savedJobs]);

  useEffect(() => {
    if (!selectedKareerId && kareersList.length > 0) setSelectedKareerId(kareersList[0].id);
  }, [kareersList, selectedKareerId]);

  const selectedKareer = kareersList.find((item) => item.id === selectedKareerId) || null;

  const eligibleMessageApps = useMemo(
    () => applications.filter((app) =>
      (app.status === 'Interviewing' || app.status === 'Hired')
      && app.messageRequestState !== 'none'
      && Boolean(app.messageRequestState),
    ),
    [applications],
  );

  useEffect(() => {
    if (eligibleMessageApps.length === 0) {
      setSelectedThreadJobId('');
      return;
    }
    if (!selectedThreadJobId || !eligibleMessageApps.some((app) => app.jobId === selectedThreadJobId)) {
      setSelectedThreadJobId(eligibleMessageApps[0].jobId);
    }
  }, [eligibleMessageApps, selectedThreadJobId]);

  const persistedMessageStates = useMemo<Record<string, MessageRequestState>>(() => {
    const states: Record<string, MessageRequestState> = {};
    eligibleMessageApps.forEach((app) => {
      states[app.jobId] = app.messageRequestState === 'accepted' ? 'Accepted'
        : app.messageRequestState === 'declined' ? 'Declined'
          : app.messageRequestState === 'ignored' ? 'Ignored' : 'Pending';
    });
    return states;
  }, [eligibleMessageApps]);

  useEffect(() => {
    let isMounted = true;
    const loadCandidateMessages = async () => {
      const applicationIds = eligibleMessageApps.map((app) => app.id).filter(Boolean);
      if (applicationIds.length === 0) return;
      const results = await Promise.all(eligibleMessageApps.map(async (app) => ({ app, rows: await loadApplicationMessages(app.id).catch(() => []) })));
      if (!isMounted) return;
      const requestUpdates: Record<string, string> = {};
      const replyUpdates: Record<string, Array<{ from: 'employer' | 'candidate'; text: string; time: string }>> = {};
      results.forEach(({ app, rows }) => {
        const explicitRequest = rows.find((row) => row.message_kind === 'request');
        const legacyRequest = explicitRequest || rows.find((row) => row.sender_role === 'employer');
        if (legacyRequest) requestUpdates[app.jobId] = String(legacyRequest.message_text || '');
        rows.forEach((row) => {
          if (row === legacyRequest) return;
          const entries = replyUpdates[app.jobId] || [];
          entries.push({
            from: row.sender_role === 'candidate' ? 'candidate' : 'employer',
            text: String(row.message_text || ''),
            time: row.created_at ? new Date(row.created_at).toLocaleString() : 'Time unavailable',
          });
          replyUpdates[app.jobId] = entries;
        });
      });
      setMessageRequests(requestUpdates);
      setMessageReplies(replyUpdates);
    };
    void loadCandidateMessages();
    const refreshTimer = window.setInterval(() => void loadCandidateMessages(), 5000);
    return () => {
      isMounted = false;
      window.clearInterval(refreshTimer);
    };
  }, [eligibleMessageApps]);

  const selectedMessageApp = eligibleMessageApps.find((app) => app.jobId === selectedThreadJobId) || null;
  const selectedMessageState = selectedMessageApp ? persistedMessageStates[selectedMessageApp.jobId] || 'Pending' : 'Pending';

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

  const markNotificationRead = async (notification: CandidateNotification) => {
    if (notification.read_at) return;
    const readAt = new Date().toISOString();
    setNotifications((current) => current.map((row) => row.id === notification.id ? { ...row, read_at: readAt } : row));
    try {
      await markCandidateNotificationRead(notification.id);
    } catch (notificationError) {
      console.warn('Unable to persist notification read state:', notificationError);
      setNotifications((current) => current.map((row) => row.id === notification.id ? { ...row, read_at: null } : row));
      showToast('Unable to mark this notification as read.', 'danger');
    }
  };

  const markAllNotificationsRead = async () => {
    if (notifications.length === 0 || unreadNotificationCount === 0) return;
    const previous = notifications;
    const readAt = new Date().toISOString();
    setNotifications((current) => current.map((row) => row.read_at ? row : { ...row, read_at: readAt }));
    try {
      await markAllCandidateNotificationsRead();
      showToast('All notifications marked as read.', 'success');
    } catch (notificationError) {
      console.warn('Unable to persist all notification read states:', notificationError);
      setNotifications(previous);
      showToast('Unable to mark all notifications as read.', 'danger');
    }
  };

  const applyAnalysisResult = (data: ResumeAnalyzeResponse) => {
    const enrichedData = withExtractedEducation(data);
    setResumeAnalysis(enrichedData);
    setParsedResume(enrichedData.parsedResume);
    setResults({
      jobMatches: enrichedData.jobMatches,
      skillGaps: enrichedData.skillGaps,
      courseRecommendations: enrichedData.courseRecommendations,
      summary: enrichedData.summary,
    });
    const extractedEducation = enrichedData.candidate_profile?.education?.[0];
    if (extractedEducation) {
      setProfileForm((current) => ({
        ...current,
        highestEducationalAttainment: extractedEducation.highest_educational_attainment || current.highestEducationalAttainment,
        degreeProgram: extractedEducation.degree_program || current.degreeProgram,
        schoolUniversity: extractedEducation.school_university || current.schoolUniversity,
        yearGraduated: extractedEducation.year_graduated || current.yearGraduated,
      }));
    }
  };

  const runMatchingWithSkills = async (
    resume: ParsedResume,
    skills: string[],
    answers: SurveyAnswers,
    options?: { analysis?: ResumeAnalyzeResponse | null; resumeId?: string | null },
  ) => {
    const resumeText = extractResumeText(resume);
    if (!resumeText) return null;
    const activeAnalysis = options?.analysis || state.resumeAnalysis;
    const extractedSkillRecords: SelectedSkill[] = (activeAnalysis?.candidate_profile?.skills || []).map((skill) => ({
      skill_id: skill.skill_id || null,
      skill_name: skill.skill_name,
      skill_category: skill.skill_category,
      skill_subcategory: skill.skill_subcategory,
      source: skill.source || 'resume_extracted',
      is_standardized: Boolean(skill.skill_id),
      source_metadata: skill.source_metadata,
      skill_priority_score: skill.skill_priority_score,
    }));
    const knownSkills = [...(state.selectedSkills || []), ...extractedSkillRecords];
    const knownSkillsByName = new Map(knownSkills.map((skill) => [normalizeSkill(skill.skill_name), skill]));
    const confirmedSkillRecords = Array.from(new Map(skills
      .map((skillName): SelectedSkill | null => {
        const name = skillName.trim();
        if (!name) return null;
        const existing = knownSkillsByName.get(normalizeSkill(name));
        if (existing) {
          return {
            ...existing,
            skill_id: existing.skill_id?.trim().toUpperCase() || null,
            skill_name: name,
            source: 'confirmed_skill',
            is_standardized: Boolean(existing.skill_id),
          };
        }
        const explicitSkillId = /^SK\d+$/i.test(name) ? name.toUpperCase() : null;
        return {
          skill_id: explicitSkillId,
          skill_name: name,
          custom_skill_name: explicitSkillId ? undefined : name,
          source: explicitSkillId ? 'confirmed_skill' : 'custom',
          is_standardized: Boolean(explicitSkillId),
        };
      })
      .filter((item): item is SelectedSkill => Boolean(item))
      .map((item) => [`${item.skill_id || 'custom'}:${normalizeSkill(item.skill_name)}`, item])).values()).slice(0, 20);
    const finalCandidateSkillIds = confirmedSkillRecords
      .map((skill) => skill.skill_id?.trim().toUpperCase() || '')
      .filter(Boolean);

    if (confirmedSkillRecords.length === 0) return null;

    const preferencePayload = {
      // Send the stable career-area value to the backend; display labels are
      // resolved separately so taxonomy identifiers never reach the UI.
      industry: normalizeCareerAreaValue(answers.industry),
      target_role: answers.role,
      role_level: answers.role,
      work_setup: getPreferenceLabel(setupLabels, answers.setup),
      salary_expectation: getPreferenceLabel(salaryLabels, answers.salary),
      skill_to_develop: answers.skill,
    };

    const result = await runJobMatches({
      user_mode: 'logged_in',
      view_mode: 'full',
      resume_text_for_matching: resumeText,
      candidate_skill_ids: finalCandidateSkillIds,
      confirmed_skills: confirmedSkillRecords,
      preferences: {
        industry: preferencePayload.industry,
        target_role: preferencePayload.target_role,
        role_level: preferencePayload.role_level,
        role: preferencePayload.target_role,
        work_setup: preferencePayload.work_setup,
        salary_expectation: preferencePayload.salary_expectation,
        skill_to_develop: preferencePayload.skill_to_develop,
      },
    });

    setMatchResults(result);
    if (currentUser?.id) {
      await supabase.from('user_skills').delete().eq('user_id', currentUser.id);
      if (confirmedSkillRecords.length > 0) {
        await supabase.from('user_skills').insert(confirmedSkillRecords.map((skill) => ({
          user_id: currentUser.id,
          skill_id: skill.skill_id,
          skill_name: skill.skill_name,
          confidence: 1,
          source: 'confirmed_skill',
        })));
      }
      const saved = await saveMatchHistory({
        userId: currentUser.id,
        resumeId: options?.resumeId ?? state.savedResumeId,
        preferences: answers,
        results: result,
      });
      if (!saved) showToast('Matches refreshed, but they could not be saved to your profile. They may not appear after you reload.', 'warn');
    }
    return result;
  };

  const handlePreferencesSave = async (answers: SurveyAnswers) => {
    setSurveyAnswers(answers);
    if (currentUser?.id) {
      await updateCandidateProfile({
        userId: currentUser.id,
        preferredIndustry: getCareerAreaLabel(answers.industry),
        targetRole: answers.role,
        preferredWorkSetup: getPreferenceLabel(setupLabels, answers.setup),
        expectedSalary: getPreferenceLabel(salaryLabels, answers.salary),
        skillToDevelop: answers.skill,
      }).catch((error) => {
        console.warn('Unable to save preferences to Supabase:', error);
      });
    }
    const savedResume = state.resume || state.resumeAnalysis?.parsedResume;
    const resumeText = savedResume ? extractResumeText(savedResume) : '';
    if (!savedResume || !resumeText) {
      showInlineNotice('Preferences saved. Existing progress was kept; upload a resume if you want to generate Aspiration Opportunities.', 'warn');
      showToast('Preferences saved.', 'success');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const cleanSkills = Array.from(new Set(skillNames.map((skill) => skill.trim()).filter(Boolean)));
      setSkillNames(cleanSkills);
      await runMatchingWithSkills(savedResume, cleanSkills, answers);
      showInlineNotice('Preferences and confirmed skills saved. Your matches, skill gaps, recommendations, and progress were refreshed.', 'success');
      showToast('Profile recommendations refreshed.', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to refresh your profile recommendations.';
      setError(message);
      showToast(message, 'danger');
    } finally {
      setLoading(false);
    }
  };

  const openJobDetails = async (job: DashboardJob) => {
    let hydratedJob = job;
    try {
      const detail = await fetchJobDetails(job.id, job.jobSource);
      hydratedJob = mergeSupabaseJobDetails(job, detail.job);
    } catch (error) {
      console.warn('Unable to refresh job details from Supabase:', error);
    }
    setSelectedJob(hydratedJob);
    setJobDetailOpen(true);
  };

  const toggleSaved = async (jobId: string) => {
    const alreadySaved = savedJobs.has(jobId);
    const job = kareersList.find((item) => item.id === jobId) || jobs.find((item) => item.id === jobId);
    const jobSource = job?.jobSource || 'internal';
    setSavedJobs((current) => {
      const next = new Set(current);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
    const result = alreadySaved
      ? await supabase.from('saved_jobs').delete().eq('user_id', currentUser.id).eq('job_source', jobSource).eq('job_id', jobId)
      : await supabase.from('saved_jobs').upsert({ user_id: currentUser.id, job_source: jobSource, job_id: jobId }, { onConflict: 'user_id,job_source,job_id' });
    if (result.error) {
      setSavedJobs((current) => {
        const next = new Set(current);
        if (alreadySaved) next.add(jobId); else next.delete(jobId);
        return next;
      });
      showToast('Unable to update saved jobs in Supabase.', 'danger');
      return;
    }
    showToast(alreadySaved ? 'Job removed from saved list.' : 'Job saved to your account.', 'success');
  };

  const applyToInternalJob = async (job: DashboardJob): Promise<boolean> => {
    if (job.sourceType === 'external') {
      showToast('External opportunities are link-outs only.', 'warn');
      return false;
    }
    const existing = applications.find((app) => app.jobId === job.id && app.jobSource === job.jobSource && app.status !== 'Withdrawn');
    if (existing) {
      showToast('You have already applied for this job.', 'warn');
      return false;
    }

    const payload = {
      user_id: currentUser.id,
      job_source: job.jobSource,
      job_id: job.id,
      job_title: job.title,
      company_name: job.company,
      candidate_name: currentUser.name,
      candidate_email: currentUser.email,
      candidate_location: profileForm.location,
      match_score: job.hasMatchScore ? Math.round(job.matchScore) : null,
      matched_skills: job.matchedSkills,
      missing_skills: job.missingSkills,
      status: 'pending',
      applied_at: new Date().toISOString(),
      withdrawn_at: null,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('job_applications')
      .upsert(payload, { onConflict: 'user_id,job_source,job_id' })
      .select('*')
      .single();

    if (error) {
      console.warn('Unable to submit application:', error);
      showToast('Unable to submit application. Please try again.', 'danger');
      return false;
    }

    const savedApplication = mapApplicationRow(data as JobApplicationRow, jobs);
    setApplications((current) => [savedApplication, ...current.filter((app) => app.id !== savedApplication.id)]);
    showToast('Application submitted.', 'success');
    return true;
  };

  const applyToJob = async (jobId: string): Promise<boolean> => {
    const job = kareersList.find((item) => item.id === jobId) || jobs.find((item) => item.id === jobId) || null;
    if (!job) {
      showToast('Job details could not be found for application.', 'warn');
      return false;
    }
    return applyToInternalJob(job);
  };

  const getApplicationStatus = (jobId: string, jobSource: 'internal' | 'employer'): ApplicationStatus | null => {
    const activeApplication = applications.find((app) => app.jobId === jobId && app.jobSource === jobSource && app.status !== 'Withdrawn');
    return activeApplication?.status || null;
  };

  const openWithdraw = (application: DashboardApplication) => {
    setWithdrawTarget(application);
    setWithdrawModalOpen(true);
  };

  const confirmWithdraw = async () => {
    if (!withdrawTarget) return;
    if (!['Pending', 'Shortlisted', 'Interviewing'].includes(withdrawTarget.status)) return;
    const { error } = await supabase
      .from('job_applications')
      .update({
        status: 'withdrawn',
        withdrawn_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', withdrawTarget.id)
      .eq('user_id', currentUser.id);

    if (error) {
      console.warn('Unable to withdraw application:', error);
      showToast('Unable to withdraw application. Please try again.', 'danger');
      return;
    }

    setApplications((current) => current.map((app) => (app.id === withdrawTarget.id ? { ...app, status: 'Withdrawn' } : app)));
    setWithdrawModalOpen(false);
    showToast(`${withdrawTarget.jobTitle} application withdrawn.`, 'warn');
  };

  const acceptedMessageReplyEnabled = selectedMessageState === 'Accepted';

  const updateMessageRequestState = async (nextState: 'accepted' | 'declined' | 'ignored') => {
    if (!selectedMessageApp) return;
    const { error } = await supabase
      .from('job_applications')
      .update({ message_request_state: nextState, updated_at: new Date().toISOString() })
      .eq('id', selectedMessageApp.id)
      .eq('user_id', currentUser.id);
    if (error) {
      console.warn('Unable to update message request:', error);
      showToast('Unable to update the message request. Please try again.', 'danger');
      return;
    }
    setApplications((current) => current.map((app) => app.id === selectedMessageApp.id ? { ...app, messageRequestState: nextState } : app));
    showToast(nextState === 'accepted' ? 'Message request accepted. You can now reply.' : `Message request ${nextState}.`, nextState === 'accepted' ? 'success' : 'warn');
  };

  const acceptMessageRequest = () => void updateMessageRequestState('accepted');

  const declineMessageRequest = () => void updateMessageRequestState('declined');

  const ignoreMessageRequest = () => void updateMessageRequestState('ignored');

  const sendMessageReply = async () => {
    if (!selectedMessageApp || selectedMessageState !== 'Accepted') return;
    const text = messageDraft.trim();
    if (!text) return;
    try {
      await sendApplicationMessage({ applicationId: selectedMessageApp.id, text });
    } catch (error) {
      console.warn('Unable to send candidate reply:', error);
      showToast(error instanceof Error ? error.message : 'Unable to send your message. Please try again.', 'danger');
      return;
    }
    const reply = { from: 'candidate' as const, text, time: 'Just now' };
    setMessageReplies((current) => ({ ...current, [selectedMessageApp.jobId]: [...(current[selectedMessageApp.jobId] || []), reply] }));
    setMessageDraft('');
  };

  const openResumeModal = () => {
    clearPanels();
    setResumeModalOpen(true);
    setResumeStep('upload');
    setResumeDragOver(false);
    setResumeUploadFile(null);
    setResumeAnalyzeData(null);
    setResumeActionError('');
    savedResumeUploadId.current = null;
    setReviewSkills([]);
    setNewSkillInput('');
    setResumePostRefreshTarget('dashboard');
  };

  const viewSavedResume = async () => {
    if (!currentUser.id) return;
    if (state.resumeFile) {
      const localUrl = URL.createObjectURL(state.resumeFile);
      setResumePreview({ url: localUrl, name: state.resumeFile.name, mimeType: state.resumeFile.type, local: true });
      return;
    }
    const latestResume = await loadLatestResume({ userId: currentUser.id });
    let storageBucket = latestResume?.storage_bucket || 'resumes';
    let storagePath = latestResume?.storage_path || '';

    // Older resume rows may not contain storage metadata even though the file was
    // successfully uploaded. Recover the newest file from this user's private folder.
    if (!storagePath) {
      const { data: storedFiles, error: listError } = await supabase.storage
        .from(storageBucket)
        .list(currentUser.id, { limit: 100, sortBy: { column: 'created_at', order: 'desc' } });
      const newestFile = storedFiles?.find((file) => file.name && file.name !== '.emptyFolderPlaceholder');
      if (listError || !newestFile) {
        console.warn('Unable to locate saved resume file:', listError);
        showToast('The saved resume file could not be found. Please upload the resume again.', 'warn');
        return;
      }
      storageBucket = 'resumes';
      storagePath = `${currentUser.id}/${newestFile.name}`;
    }
    const { data, error } = await supabase.storage
      .from(storageBucket)
      .createSignedUrl(storagePath, 300);
    if (error || !data?.signedUrl) {
      console.warn('Unable to create resume preview link:', error);
      showToast('Unable to open the saved resume. Please try again.', 'danger');
      return;
    }
    const previewName = latestResume?.original_filename || savedResumeFileName || storagePath.split('/').pop() || 'Saved resume';
    const previewMimeType = latestResume?.file_mime_type || (previewName.toLowerCase().endsWith('.pdf') ? 'application/pdf' : '');
    setResumePreview({ url: data.signedUrl, name: previewName, mimeType: previewMimeType, local: false });
  };

  const closeResumePreview = () => {
    if (resumePreview?.local) URL.revokeObjectURL(resumePreview.url);
    setResumePreview(null);
  };

  const handleResumeFilePick = (file: File | null) => {
    setResumeAnalyzeData(null);
    setResumeActionError('');
    savedResumeUploadId.current = null;
    if (!file) {
      setResumeUploadFile(null);
      return;
    }
    const validation = validateResumeFile(file);
    if (!validation.valid) {
      showToast(validation.error || 'Please upload a PDF or DOCX file.', 'warn');
      return;
    }
    setResumeUploadFile(file);
  };

  const handleResumeUploadAndReview = async () => {
    if (!resumeUploadFile) {
      showToast('Please upload a resume file first.', 'warn');
      return;
    }
    savedResumeUploadId.current = null;
    setResumeActionError('');
    setLoading(true);
    setError(null);
    try {
      const prefs = state.surveyAnswers || defaultSurveyAnswers;
      const data = withExtractedEducation(await analyzeResume(resumeUploadFile, prefs));
      setResumeAnalyzeData(data);
      const extractedEducation = data.candidate_profile?.education?.[0];
      if (extractedEducation) {
        setProfileForm((current) => ({
          ...current,
          highestEducationalAttainment: extractedEducation.highest_educational_attainment || current.highestEducationalAttainment,
          degreeProgram: extractedEducation.degree_program || current.degreeProgram,
          schoolUniversity: extractedEducation.school_university || current.schoolUniversity,
          yearGraduated: extractedEducation.year_graduated || current.yearGraduated,
        }));
        await saveCandidateAccountSettings({
          full_name: accountIdentity.name,
          email: accountIdentity.email,
          birthday: profileForm.birthday,
          location: profileForm.location,
          contact_number: profileForm.contactNumber,
          address: profileForm.address,
          highest_educational_attainment: extractedEducation.highest_educational_attainment || profileForm.highestEducationalAttainment,
          degree_program: extractedEducation.degree_program || profileForm.degreeProgram,
          school_university: extractedEducation.school_university || profileForm.schoolUniversity,
          year_graduated: extractedEducation.year_graduated || profileForm.yearGraduated,
        });
      }
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

  const savePendingResume = async (): Promise<string | null> => {
    if (!resumeUploadFile || !resumeAnalyzeData) return null;
    if (savedResumeUploadId.current) return savedResumeUploadId.current;
    let resumeId = state.savedResumeId ?? null;
    if (currentUser.id) {
      resumeId = await saveResumeAnalysis({
        userId: currentUser.id,
        fileName: resumeUploadFile.name,
        file: resumeUploadFile,
        analysis: resumeAnalyzeData,
      });
      savedResumeUploadId.current = resumeId;
      setSavedResumeFileName(resumeUploadFile.name);
    }
    setResumeFile(resumeUploadFile);
    applyAnalysisResult(resumeAnalyzeData);
    setSavedResumeId(resumeId);
    return resumeId;
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
    setResumeActionError('');
    try {
      const resumeId = await savePendingResume();
      setSkillNames(confirmed);
      const prefs = state.surveyAnswers || defaultSurveyAnswers;
      await runMatchingWithSkills(resumeAnalyzeData.parsedResume, confirmed, prefs, { analysis: resumeAnalyzeData, resumeId });
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
      const detail = error instanceof Error ? error.message : 'Please try again.';
      setResumeActionError(savedResumeUploadId.current
        ? 'Resume saved, but matches could not be refreshed. You can retry without uploading it again.'
        : `Unable to save resume. ${detail}`);
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
    setResumeActionError('');
    try {
      const resumeId = await savePendingResume();
      setSkillNames(confirmed);
      const prefs = state.surveyAnswers || defaultSurveyAnswers;
      await runMatchingWithSkills(resumeAnalyzeData.parsedResume, confirmed, prefs, { analysis: resumeAnalyzeData, resumeId });
      setResumeModalOpen(false);
      setResumeStep('upload');
      showInlineNotice('Resume updated. Matches, skill gaps, recommendations, and progress were refreshed.', 'success');
      showToast('Resume changes applied to your dashboard.', 'success');
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Please try again.';
      setResumeActionError(savedResumeUploadId.current
        ? 'Resume saved, but matches could not be refreshed. You can retry without uploading it again.'
        : `Unable to save resume. ${detail}`);
    } finally {
      setLoading(false);
    }
  };

  const goToOnboardingSkillsAndPreferences = async () => {
    if (!resumeUploadFile || !resumeAnalyzeData) {
      showToast('Please analyze a resume first.', 'warn');
      return;
    }

    const extracted = extractSkillsFromResume(resumeAnalyzeData.parsedResume);
    const preparedSkills = Array.from(new Set((extracted.length > 0 ? extracted : reviewSkills).map((item) => item.trim()).filter(Boolean)));

    setLoading(true);
    setError(null);
    setResumeActionError('');
    try {
      await savePendingResume();
      if (preparedSkills.length > 0) setSkillNames(preparedSkills);
      setResumeModalOpen(false);
      setResumeStep('upload');
      showToast('Resume saved. Opening skills and preferences for review.', 'success');
      onUpdateResume();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save the resume to your profile.';
      setResumeActionError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleEvidenceSave = async (draft: {
    id?: string;
    title: string;
    evidenceType: EvidenceType;
    relatedSkill: string;
    category: string;
    notes?: string;
    file: File | null;
  }) => {
    const existingRecord = draft.id ? evidenceRecords.find((record) => record.id === draft.id) : undefined;
    setLoading(true);
    setError(null);
    try {
      const nextRecord = await prepareEvidenceUpload(draft, existingRecord, validateCertificateFile);

      setEvidenceRecords((current) => {
        if (draft.id) {
          return current.map((record) => (record.id === draft.id ? nextRecord : record));
        }
        return [nextRecord, ...current];
      });

      setEvidenceModalOpen(false);
      setEditingEvidence(null);
      showToast('Evidence saved. Pending Verification; file checks do not verify the credential.', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to validate certificate upload.';
      setError(message);
      showToast(message, 'danger');
    } finally {
      setLoading(false);
    }
  };

  const openEvidenceUploadModal = () => {
    setEditingEvidence(null);
    setEvidenceModalOpen(true);
  };

  const handleViewEvidence = (record: EvidenceUploadRecord) => {
    if (!record.fileUrl) {
      showToast('No viewable PDF is attached to this evidence record yet.', 'warn');
      return;
    }
    window.open(record.fileUrl, '_blank', 'noopener,noreferrer');
  };

  const handleReplaceEvidence = (record: EvidenceUploadRecord) => {
    setEditingEvidence(record);
    setEvidenceModalOpen(true);
  };

  const handleDeleteEvidence = (record: EvidenceUploadRecord) => {
    setDeleteEvidenceTarget(record);
  };

  const confirmDeleteEvidence = () => {
    if (!deleteEvidenceTarget) return;
    setEvidenceRecords((current) => current.filter((record) => record.id !== deleteEvidenceTarget.id));
    setDeleteEvidenceTarget(null);
    showToast('Evidence record deleted.', 'success');
  };

  const closeModal = () => {
    setJobDetailOpen(false);
    setWithdrawModalOpen(false);
    setDeleteModalOpen(false);
    setResumeModalOpen(false);
    setEvidenceModalOpen(false);
    setEditingEvidence(null);
    setDeleteEvidenceTarget(null);
    closeResumePreview();
  };

  const hasData = Boolean(state.matchResults || state.results || state.resumeAnalysis || applications.length);

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
          <button className="cand-btn-update" type="button" onClick={openResumeModal} aria-label="Update resume" title="Update resume">
            <UIIcon name="upload" className="cand-btn-icon" />
          </button>
          <div className="cand-notif-wrap">
            <button
              className="cand-notif-btn"
              type="button"
              aria-label="Notifications"
              title="Notifications"
              aria-expanded={notifOpen}
              onClick={(event) => {
                event.stopPropagation();
                setNotifOpen((value) => {
                  if (!value) void loadNotifications();
                  return !value;
                });
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
                  <button className="cand-mark-read-btn" type="button" onClick={() => void markAllNotificationsRead()} disabled={unreadNotificationCount === 0}>
                    Mark all read
                  </button>
                </div>
                {notificationLoadStatus === 'loading' ? (
                  <div className="cand-notif-item"><div className="cand-notif-text">Loading notifications…</div></div>
                ) : notificationLoadStatus === 'error' ? (
                  <div className="cand-notif-item"><div className="cand-notif-text">Notifications could not be loaded. Try again shortly.</div></div>
                ) : notifications.length > 0 ? (
                  notifications.map((row) => {
                    const isUnread = !row.read_at;
                    const isMessage = row.event_type === 'message_request';
                    return (
                    <div key={row.id} className={`cand-notif-item ${isUnread ? 'unread' : ''}`}>
                      <div className={`cand-notif-icon ${isMessage ? 'msg' : 'app'}`}>
                        <UIIcon name={isMessage ? 'message' : 'layers'} />
                      </div>
                      <div className="cand-notif-copy">
                        <div className="cand-notif-text">
                          <strong>{row.title}</strong>
                          {row.message}
                        </div>
                        <div className="cand-notif-time">{new Date(row.created_at).toLocaleString()}</div>
                      </div>
                      {isUnread && (
                        <button
                          className="cand-notif-read-one"
                          type="button"
                          aria-label="Mark notification as read"
                          title="Mark as read"
                          onClick={() => void markNotificationRead(row)}
                        >
                          <UIIcon name="check-circle" />
                        </button>
                      )}
                    </div>
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
                    {tr(uiLanguage, 'Account Settings')}
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
                  {tr(uiLanguage, 'Preferences')}
                </button>
                <div className="border-t border-bdr px-4 py-2 text-[10px] font-bold uppercase tracking-[0.5px] text-soft">{tr(uiLanguage, 'Language')}</div>
                <div className="cand-lang-row">
                  <button className={`cand-lang-pill ${uiLanguage === 'en' ? 'active' : ''}`} type="button" onClick={() => setUiLanguage('en')}>
                    {tr(uiLanguage, 'English')}
                  </button>
                  <button className={`cand-lang-pill ${uiLanguage === 'fil' ? 'active' : ''}`} type="button" onClick={() => setUiLanguage('fil')}>
                    {tr(uiLanguage, 'Filipino')}
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
                    {tr(uiLanguage, 'Logout')}
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
                <div className="cand-sidebar-title">{tr(uiLanguage, 'My Career')}</div>
                <NavItem icon="dashboard" active={activePage === 'dashboard'} onClick={() => setActivePage('dashboard')}>{tr(uiLanguage, 'Dashboard')}</NavItem>
                <NavItem icon="briefcase" active={activePage === 'jobmatches'} onClick={() => setActivePage('jobmatches')}>{tr(uiLanguage, 'Job Matches')}</NavItem>
                <NavItem icon="clipboard" active={activePage === 'external-job'} onClick={() => setActivePage('external-job')}>Analyze External Job</NavItem>
                <NavItem icon="puzzle" active={activePage === 'skillgaps'} onClick={() => setActivePage('skillgaps')}>{tr(uiLanguage, 'Skill Gaps')}</NavItem>
                <NavItem icon="layers" active={activePage === 'applications'} onClick={() => setActivePage('applications')}>{tr(uiLanguage, 'Applications')}</NavItem>
              </div>
              <div className="cand-sidebar-section border-t border-bdr pt-5">
                <div className="cand-sidebar-title">{tr(uiLanguage, 'Explore')}</div>
                <NavItem icon="compass" active={activePage === 'kareers'} onClick={() => setActivePage('kareers')}>{tr(uiLanguage, 'Kareers')}</NavItem>
                <NavItem icon="graduation" active={activePage === 'upskilling'} onClick={() => setActivePage('upskilling')}>{tr(uiLanguage, 'Learning Recommendations')}</NavItem>
                <button className={`cand-nav-item ${activePage === 'messages' ? 'active' : ''}`} type="button" onClick={() => setActivePage('messages')}>
                  <UIIcon name="message" className="cand-nav-icon" />
                  {tr(uiLanguage, 'Messages')}
                  {eligibleMessageApps.length > 0 && <span className="cand-nav-badge">{eligibleMessageApps.length}</span>}
                </button>
              </div>
            </div>
            <div className="cand-sidebar-bottom">
              <button className="cand-profile-card" type="button" onClick={() => setActivePage('account')}>
                <div className="cand-profile-avatar">{initials}</div>
                <div className="text-left">
                  <div className="text-[13px] font-bold text-dark">{displayName}</div>
                  <div className="cand-profile-location">
                    <UIIcon name="location" className="cand-profile-location-icon" />
                    {matchedLocation || tr(uiLanguage, 'Location not set')}
                  </div>
                </div>
                <UIIcon name="sliders" className="cand-profile-setting-icon" />
              </button>
            </div>
          </aside>

        <main className={`cand-content ${sidebarCollapsed ? 'expanded' : ''}`}>
          {inlineNotice && (
            <div className={`cand-notice ${inlineNotice.type === 'danger' ? 'error' : inlineNotice.type === 'warn' ? 'warn' : 'info'}`}>
              <span>{inlineNotice.message}</span>
              <button className="cand-notice-close" type="button" onClick={() => setInlineNotice(null)} aria-label="Dismiss notification">
                <UIIcon name="close" />
              </button>
            </div>
          )}
          {state.error && (
            <div className="cand-notice error">
              <span>{state.error}</span>
              <button className="cand-notice-close" type="button" onClick={() => setError(null)} aria-label="Dismiss error">
                <UIIcon name="close" />
              </button>
            </div>
          )}

          {activePage === 'dashboard' && (
            <DashboardOverview
              hasData={hasData}
              metrics={metricCards}
              topJobHighlights={topJobHighlights}
              recentApplications={recentApplications}
              topMissingSkills={topMissingSkills}
              recommendedSteps={recommendedSteps}
              courseRecommendations={courseRecommendations}
              onOpenMatches={() => setActivePage('jobmatches')}
              onOpenGaps={() => setActivePage('skillgaps')}
              onOpenUpskilling={() => setActivePage('upskilling')}
              onOpenMessages={() => setActivePage('messages')}
            />
          )}

          {activePage === 'jobmatches' && (
            <JobMatchesPage
              jobs={filteredJobs}
              topMatchesCount={topAllMatchesCount}
              allMatchesCount={totalQualifyingMatchesCount}
              jobSearch={jobSearch}
              jobFilter={jobFilter}
              applications={applications}
              savedJobs={savedJobs}
              savedJobRows={savedJobRows}
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

          {activePage === 'external-job' && (
            <ExternalJobAnalysisPage onOpenLearning={() => setActivePage('upskilling')} />
          )}

          {activePage === 'skillgaps' && (
            <SkillGapsPage
              gaps={gaps}
              jobs={jobs}
              categoryProgress={categoryProgress}
              courses={courses}
              evidenceRecords={evidenceRecords}
              skillProgressRecords={skillProgressRecords}
              onUpdateSkillProgress={updateSkillProgressStatus}
              onUploadSkillEvidence={openEvidenceUploadModal}
              onOpenUpskilling={() => setActivePage('upskilling')}
              onOpenResume={openResumeModal}
            />
          )}

          {activePage === 'applications' && (
            <ApplicationsPage
              loadStatus={applicationLoadStatus}
              applications={applications}
              onViewJob={(application) => {
                const knownJob = jobs.find((item) => item.id === application.jobId && item.jobSource === application.jobSource);
                const applicationJob: DashboardJob = knownJob || {
                  id: application.jobId,
                  jobSource: application.jobSource,
                  title: application.jobTitle,
                  company: application.company,
                  location: 'Location not specified',
                  setup: 'Work setup not specified',
                  employmentType: 'Not specified',
                  salary: 'Salary not specified',
                  matchScore: application.matchScore ?? 0,
                  hasMatchScore: application.matchScore !== null,
                  matchCategory: (application.matchScore ?? 0) >= 60 ? 'fit-now' : 'aspiration',
                  sourceType: 'internal',
                  requiredSkills: [],
                  preferredSkills: [],
                  responsibilities: [],
                  matchedSkills: [],
                  missingSkills: [],
                  explanation: '',
                };
                void openJobDetails(applicationJob);
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
                setExtraPreferences({ jobLevel: '', preferredLocation: '' });
                showToast('Changes reset.', 'success');
              }}
            />
          )}

          {activePage === 'account' && (
            <AccountSettingsPage
              user={{ name: displayName, email: displayEmail, publicId: candidatePublicId }}
              uiLanguage={uiLanguage}
              evidenceRecords={evidenceRecords}
              profile={profileForm}
              password={accountPassword}
              savedResumeFileName={savedResumeFileName}
              isSavingProfile={isSavingProfile}
              isUpdatingPassword={isUpdatingPassword}
              profileSaveNotice={profileSaveNotice}
              onLanguage={setUiLanguage}
              onOpenDelete={() => setDeleteModalOpen(true)}
              onOpenResume={openResumeModal}
              onViewResume={() => void viewSavedResume()}
              onOpenEvidenceUpload={openEvidenceUploadModal}
              onViewEvidence={handleViewEvidence}
              onReplaceEvidence={handleReplaceEvidence}
              onDeleteEvidence={handleDeleteEvidence}
              onProfileChange={setProfileForm}
              onIdentityChange={setAccountIdentity}
              onPasswordChange={setAccountPassword}
              onUpdatePassword={updateCandidatePassword}
              onSave={saveCandidateProfile}
            />
          )}

          {activePage === 'kareers' && (
            <KareersPage
              kareers={kareersList}
              selectedId={selectedKareerId}
              selected={selectedKareer}
              applications={applications}
              onSelect={setSelectedKareerId}
              onApply={applyToJob}
              onWithdraw={openWithdraw}
              onGetApplicationStatus={getApplicationStatus}
              onSave={toggleSaved}
              onOpenMatches={() => setActivePage('jobmatches')}
              onOpenApplications={() => setActivePage('applications')}
              onOpenUpskilling={() => setActivePage('upskilling')}
              isLoading={isLoadingKareers}
              error={kareersError}
              onRetry={() => void loadKareers()}
            />
          )}

          {activePage === 'upskilling' && (
            <UpskillingPage
              tab={upskillTab}
              courses={courses}
              jobs={jobs}
              gaps={gaps}
              skillProgressRecords={skillProgressRecords}
              onTab={setUpskillTab}
              onOpenSkillGaps={() => setActivePage('skillgaps')}
              onOpenJobMatches={() => setActivePage('jobmatches')}
            />
          )}

          {activePage === 'messages' && (
            <MessagesPage
              applications={eligibleMessageApps}
              selectedJobId={selectedThreadJobId}
              requestStates={persistedMessageStates}
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
          application={applications.find((app) => app.jobId === selectedJob.id && app.jobSource === selectedJob.jobSource && app.status !== 'Withdrawn') || null}
          courses={courses}
          onClose={() => setJobDetailOpen(false)}
          onApply={async () => {
            const applied = await applyToInternalJob(selectedJob);
            if (applied) setJobDetailOpen(false);
          }}
          onWithdraw={(application) => {
            setJobDetailOpen(false);
            openWithdraw(application);
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
          actionError={resumeActionError}
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

      {evidenceModalOpen && (
        <EvidenceFormModal
          loading={state.isLoading}
          record={editingEvidence}
          onClose={() => {
            setEvidenceModalOpen(false);
            setEditingEvidence(null);
          }}
          onSave={handleEvidenceSave}
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

      {deleteEvidenceTarget && (
        <ConfirmModal
          title="Delete Evidence?"
          description="Are you sure you want to delete this evidence? This may reduce your Skill Development Progress score if the evidence supports an active skill gap."
          danger
          onCancel={() => setDeleteEvidenceTarget(null)}
          onConfirm={confirmDeleteEvidence}
          confirmLabel="Delete Evidence"
        />
      )}

      {resumePreview && (
        <div className="cand-modal-overlay" onClick={closeResumePreview}>
          <div className="cand-modal-box lg cand-resume-preview-modal" onClick={(event) => event.stopPropagation()}>
            <div className="cand-modal-header">
              <div>
                <div className="cand-modal-title">Resume Preview</div>
                <div className="cand-modal-subtitle">{resumePreview.name}</div>
              </div>
              <button className="cand-modal-close" type="button" onClick={closeResumePreview} aria-label="Close resume preview">×</button>
            </div>
            {resumePreview.mimeType.includes('pdf') || resumePreview.name.toLowerCase().endsWith('.pdf') ? (
              <iframe className="cand-resume-preview-frame" src={resumePreview.url} title={`Preview of ${resumePreview.name}`} />
            ) : docxPreviewResult?.url !== resumePreview.url ? (
              <div className="cand-resume-preview-status" role="status">Preparing DOCX preview…</div>
            ) : docxPreviewResult.error ? (
              <div className="cand-notice info m-4"><span>{docxPreviewResult.error}</span></div>
            ) : (
              <div
                className="cand-resume-preview-document"
                aria-label={`Preview of ${resumePreview.name}`}
                dangerouslySetInnerHTML={{ __html: docxPreviewResult.html }}
              />
            )}
          </div>
        </div>
      )}

      {toast && <div className={`cand-toast ${toast.type}`}>{toast.message}</div>}

      {(jobDetailOpen || resumeModalOpen || withdrawModalOpen || deleteModalOpen || evidenceModalOpen || Boolean(deleteEvidenceTarget) || Boolean(resumePreview)) && (
        <button type="button" className="fixed inset-0 z-[450] h-0 w-0 opacity-0" aria-label="close modal by background" onClick={closeModal} />
      )}
    </div>
  );
}

function NavItem({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: IconName; children: ReactNode }) {
  return (
    <button className={`cand-nav-item ${active ? 'active' : ''}`} type="button" onClick={onClick}>
      <UIIcon name={icon} className="cand-nav-icon" />
      <span>{children}</span>
    </button>
  );
}

function FilterPanel({
  open,
  panelId,
  title,
  labelledBy,
  onClose,
  onApply,
  onClear,
  children,
}: {
  open: boolean;
  panelId: string;
  title: string;
  labelledBy: string;
  onClose: () => void;
  onApply: () => void;
  onClear: () => void;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <>
      <button className="cand-filter-backdrop" type="button" aria-label="Close filters" onClick={onClose} />
      <div id={panelId} ref={panelRef} className="cand-filter-panel" role="dialog" aria-modal="true" aria-labelledby={labelledBy} tabIndex={-1}>
        <div className="cand-filter-panel-header">
          <div>
            <div id={labelledBy} className="cand-filter-panel-title">{title}</div>
            <div className="cand-filter-panel-subtitle">Refine results with the filters below.</div>
          </div>
          <button className="cand-filter-close" type="button" aria-label={`Close ${title}`} onClick={onClose}>
            <UIIcon name="close" />
          </button>
        </div>
        <form onSubmit={(event) => { event.preventDefault(); onApply(); }}>
          <div className="cand-filter-panel-body">{children}</div>
          <div className="cand-filter-panel-actions">
            <button className="cand-filter-clear" type="button" onClick={onClear}>Clear all</button>
            <button className="cand-btn-primary cand-btn-sm" type="submit">Apply filters</button>
          </div>
        </form>
      </div>
    </>
  );
}

function ActiveFilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button className="cand-active-filter-chip" type="button" onClick={onRemove} aria-label={`Remove ${label} filter`}>
      <span>{label}</span>
      <UIIcon name="close" className="cand-active-filter-chip-icon" />
    </button>
  );
}

function SkillGapEmptyState() {
  return (
    <div className="cand-gap-empty-state">
      <UIIcon name="puzzle" className="cand-gap-empty-icon" />
      <div>
        <h3 className="cand-gap-empty-title">No skills to develop yet</h3>
        <p className="cand-gap-empty-description">Your skill gaps will appear here after Kareerly identifies missing skills from your job matches.</p>
      </div>
    </div>
  );
}

function DashboardOverview({
  hasData,
  metrics,
  topJobHighlights,
  recentApplications,
  topMissingSkills,
  recommendedSteps,
  courseRecommendations,
  onOpenMatches,
  onOpenGaps,
  onOpenUpskilling,
  onOpenMessages,
}: {
  hasData: boolean;
  metrics: Array<{ label: string; value: string; detail: string; iconClass: string; valueColor: string; icon: IconName }>;
  topJobHighlights: DashboardJob[];
  recentApplications: DashboardApplication[];
  topMissingSkills: DashboardGap[];
  recommendedSteps: string[];
  courseRecommendations: DashboardCourse[];
  onOpenMatches: () => void;
  onOpenGaps: () => void;
  onOpenUpskilling: () => void;
  onOpenMessages: () => void;
}) {
  const summaryTabs = [
    { id: 'steps', label: 'Next Steps', icon: 'list' },
    { id: 'matches', label: 'Job Highlights', icon: 'briefcase' },
    { id: 'gaps', label: 'Skills to Develop', icon: 'lightbulb' },
    { id: 'upskilling', label: 'Upskilling', icon: 'book' },
  ] as const;
  type SummaryTab = (typeof summaryTabs)[number]['id'];
  const [activeSummaryTab, setActiveSummaryTab] = useState<SummaryTab>('steps');

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

      <div className="cand-tab-row cand-summary-tabs">
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
                    <div className={`cand-match-badge friendly ${getMatchReadinessClass(job.matchScore)}`}>
                      {getMatchScoreBadge(job)}
                    </div>
                    <span className={`cand-match-cat ${job.matchCategory === 'fit-now' ? 'cand-cat-fit' : 'cand-cat-aspiration'}`}>
                      {job.hasMatchScore ? (job.matchCategory === 'fit-now' ? 'Fit Now' : 'Aspiration') : 'Match not available'}
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

      {activeSummaryTab === 'gaps' && (
        <div className="cand-card mb-6">
          <h2 className="cand-card-title"><UIIcon name="lightbulb" className="cand-title-icon" />Skills to Develop</h2>
          {topMissingSkills.length > 0 ? (
            <>
              {topMissingSkills.map((gap) => (
                <div key={gap.skill} className="flex items-center justify-between border-b border-bdr py-3 last:border-b-0">
                  <div>
                    <div className="text-sm font-bold text-dark">{gap.skill}</div>
                    <div className="text-xs text-soft">{formatGapMissingCount(gap)}</div>
                  </div>
                  <span className={`cand-gap-priority ${severityClass(gap.severity)}`}>{gap.severity}</span>
                </div>
              ))}
              <button className="cand-btn-secondary mt-4 w-full justify-center" type="button" onClick={onOpenGaps}>
                View All Skills to Develop
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
          <h2 className="cand-card-title"><UIIcon name="book" className="cand-title-icon" />Recommended Learning Resources</h2>
          {courseRecommendations.length > 0 ? (
            <>
              {courseRecommendations.map((course) => (
                <div key={course.id} className="flex items-center justify-between border-b border-bdr py-3 last:border-b-0">
                  <div>
                    <div className="text-sm font-bold text-dark">{course.title}</div>
                    <div className="text-xs text-soft">{course.provider} · {course.duration}</div>
                  </div>
                  <span className={`cand-pill ${course.isFree ? 'free' : 'paid'}`}>{course.fees}</span>
                </div>
              ))}
              <button className="cand-btn-secondary mt-4 w-full justify-center" type="button" onClick={onOpenUpskilling}>
                View resources
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
  topMatchesCount,
  allMatchesCount,
  jobSearch,
  jobFilter,
  applications,
  savedJobs,
  savedJobRows,
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
  topMatchesCount: number;
  allMatchesCount: number;
  jobSearch: string;
  jobFilter: JobFilter;
  applications: DashboardApplication[];
  savedJobs: Set<string>;
  savedJobRows: DashboardJob[];
  fitNowCount: number;
  aspirationCount: number;
  onSearch: (value: string) => void;
  onFilter: (value: JobFilter) => void;
  onSave: (jobId: string) => void;
  onApply: (job: DashboardJob) => Promise<boolean>;
  onView: (job: DashboardJob) => void;
  onVisitSite: (job: DashboardJob) => void;
}) {
  const fitNowJobs = jobs.filter((job) => job.matchCategory === 'fit-now');
  const aspirationJobs = jobs.filter((job) => job.matchCategory === 'aspiration');
  const savedTableRows = savedJobRows.filter((job) => {
    const query = jobSearch.trim().toLowerCase();
    return !query || [job.title, job.company, job.location, job.category || '', job.subCategory || ''].join(' ').toLowerCase().includes(query);
  });

  const groupedSections =
    jobFilter === 'fit-now'
      ? [{ key: 'fit-now', title: 'Fit-Now Opportunities', icon: 'check-circle' as IconName, items: fitNowJobs }]
      : jobFilter === 'aspiration'
        ? [{ key: 'aspiration', title: 'Aspiration Opportunities', icon: 'rocket' as IconName, items: aspirationJobs }]
        : [
            { key: 'fit-now', title: 'Fit-Now Opportunities', icon: 'check-circle' as IconName, items: fitNowJobs },
            { key: 'aspiration', title: 'Aspiration Opportunities', icon: 'rocket' as IconName, items: aspirationJobs },
          ];

  const renderJobCard = (job: DashboardJob) => {
    const activeApplication = applications.find((app) => app.jobId === job.id && app.jobSource === job.jobSource && app.status !== 'Withdrawn') || null;
    return (
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
          <div className={`cand-match-badge friendly ${getMatchReadinessClass(job.matchScore)}`}>
            {getMatchBadgeLabel(job)}
          </div>
          <div>
            <span className={`cand-match-cat ${job.matchCategory === 'fit-now' ? 'cand-cat-fit' : 'cand-cat-aspiration'}`}>
              {job.hasMatchScore ? (job.matchCategory === 'fit-now' ? 'Fit Now' : 'Aspiration') : 'Match not available'}
            </span>
          </div>
        </div>
      </div>

      <div className="cand-job-section">
        <div className="cand-job-section-label">Why this job matches you</div>
        <p className="cand-job-desc-preview">{buildJobExplanation(job)}</p>
      </div>

      <div className="cand-job-section">
        <div className="cand-job-section-label">Your Matching Skills</div>
        <div className="cand-skill-row">
          {job.matchedSkills.length > 0 ? job.matchedSkills.slice(0, 6).map((skill) => (
            <span key={`${job.id}-match-${skill}`} className="cand-skill-match">
              <UIIcon name="check-circle" className="cand-chip-icon" /> {cleanSkillDisplayName(skill)}
            </span>
          )) : <span className="cand-covered-empty">Matched skills not detected yet.</span>}
        </div>
      </div>

      <div className="cand-job-section">
        <div className="cand-job-section-label">Skills to Improve</div>
        <div className="cand-skill-row">
          {job.missingSkills.length > 0 ? job.missingSkills.slice(0, 6).map((skill) => (
            <span key={`${job.id}-missing-${skill}`} className="cand-skill-miss">
              {cleanSkillDisplayName(skill)}
            </span>
          )) : <span className="cand-covered-empty">No major missing skills detected for this role.</span>}
        </div>
      </div>

      <div className="cand-explain">
        <UIIcon name="lightbulb" className="cand-inline-info-icon" />
        <strong>Recommended Next Step:</strong> {getRecommendedNextStep(job)}
      </div>

      <div className="cand-actions">
        {job.sourceType === 'internal' ? (
          <>
            <button className="cand-btn-primary" type="button" onClick={() => onApply(job)} disabled={Boolean(activeApplication)}>
              <UIIcon name="paper-plane" className="cand-btn-icon" />{activeApplication ? 'Applied ✓' : 'Apply'}
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
  };

  return (
    <div className={jobFilter !== 'saved' && jobs.length > 0 ? 'cand-job-matches-page' : undefined}>
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
          <FilterTab active={jobFilter === 'top'} onClick={() => onFilter('top')}>Top Matches ({topMatchesCount})</FilterTab>
          <FilterTab active={jobFilter === 'fit-now'} onClick={() => onFilter('fit-now')}><UIIcon name="check-circle" className="cand-tab-icon green" />Fit-Now ({fitNowCount})</FilterTab>
          <FilterTab active={jobFilter === 'aspiration'} onClick={() => onFilter('aspiration')}><UIIcon name="rocket" className="cand-tab-icon mauve" />Aspiration ({aspirationCount})</FilterTab>
          <FilterTab active={jobFilter === 'all'} onClick={() => onFilter('all')}>Show All Matches ({allMatchesCount})</FilterTab>
          <FilterTab active={jobFilter === 'saved'} onClick={() => onFilter('saved')}><UIIcon name="bookmark" className="cand-tab-icon" />Saved Jobs ({savedJobs.size})</FilterTab>
        </div>
      </div>

      {jobFilter === 'saved' ? (
        savedTableRows.length > 0 ? (
          <div className="cand-table-wrap">
            <table className="cand-table">
              <thead>
                <tr>
                  <th>Job &amp; Company</th>
                  <th>Category</th>
                  <th>Location &amp; Setup</th>
                  <th>Match Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {savedTableRows.map((job) => {
                  const activeApplication = applications.find((app) => app.jobId === job.id && app.jobSource === job.jobSource && app.status !== 'Withdrawn');
                  return (
                    <tr key={`saved-${job.jobSource}-${job.id}`}>
                      <td>
                        <div className="text-sm font-bold text-dark">{job.title}</div>
                        <div className="text-xs text-soft">{job.company}</div>
                      </td>
                      <td>
                        <div className="text-xs font-bold text-mid">{job.category || 'Uncategorized'}</div>
                        <div className="text-xs text-soft">{job.subCategory || job.jobLevel || ''}</div>
                      </td>
                      <td>
                        <div className="text-xs text-mid">{job.location}</div>
                        <div className="text-xs text-soft">{job.setup}</div>
                      </td>
                      <td>
                        {job.hasMatchScore
                          ? <span className="font-display text-sm font-extrabold text-rust">{job.matchScore}% · {job.hasMatchScore ? (job.matchCategory === 'fit-now' ? 'Fit Now' : 'Aspiration') : 'Match not available'}</span>
                          : <span className="cand-status-badge">Not matched</span>}
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-2">
                          <button className="cand-btn-secondary cand-btn-sm" type="button" onClick={() => onView(job)}><UIIcon name="eye" className="cand-btn-icon" />View</button>
                          {job.sourceType === 'external' ? (
                            <button className="cand-btn-secondary cand-btn-sm" type="button" onClick={() => onVisitSite(job)}><UIIcon name="external" className="cand-btn-icon" />Visit Site</button>
                          ) : (
                            <button className="cand-btn-primary cand-btn-sm" type="button" disabled={Boolean(activeApplication)} onClick={() => onApply(job)}><UIIcon name="paper-plane" className="cand-btn-icon" />{activeApplication ? 'Applied' : 'Apply'}</button>
                          )}
                          <button className="cand-btn-secondary cand-btn-sm" type="button" onClick={() => onSave(job.id)}><UIIcon name="trash" className="cand-btn-icon" />Remove</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <div className="cand-empty">No saved jobs match your search. Save any role from Careers or Job Matches to see it here.</div>
      ) : jobs.length > 0 ? (
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
  courses,
  evidenceRecords,
  skillProgressRecords,
  onUpdateSkillProgress,
  onUploadSkillEvidence,
  onOpenUpskilling,
  onOpenResume,
}: {
  gaps: DashboardGap[];
  jobs: DashboardJob[];
  categoryProgress: CategoryProgressRow[];
  courses: DashboardCourse[];
  evidenceRecords: EvidenceUploadRecord[];
  skillProgressRecords: Record<string, SkillProgressRecord>;
  onUpdateSkillProgress: (skillKey: string, status: SkillProgressStatus, selectedResourceId?: string) => void;
  onUploadSkillEvidence: () => void;
  onOpenUpskilling: () => void;
  onOpenResume: () => void;
}) {
  const sortedCategories = useMemo(
    () => categoryProgress.slice().sort((a, b) => a.percent - b.percent),
    [categoryProgress],
  );
  const [activeSkillGapView, setActiveSkillGapView] = useState<'board' | 'progress'>('board');
  const [selectedCategory, setSelectedCategory] = useState<SkillCategory>(sortedCategories[0]?.category || 'Other');
  const skillGapTabOrder = ['board', 'progress'] as const;
  const selectSkillGapView = (view: 'board' | 'progress') => setActiveSkillGapView(view);
  const handleSkillGapTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = skillGapTabOrder.indexOf(activeSkillGapView);
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? skillGapTabOrder.length - 1
        : (currentIndex + (event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1) + skillGapTabOrder.length) % skillGapTabOrder.length;
    const nextView = skillGapTabOrder[nextIndex];
    selectSkillGapView(nextView);
    window.setTimeout(() => document.getElementById(`skill-gap-tab-${nextView}`)?.focus(), 0);
  };

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

  const boardGaps = useMemo(() => gaps.map((gap) => ({ ...gap, boardSeverity: gap.severity })), [gaps]);

  const critical = boardGaps.filter((gap) => gap.boardSeverity === 'Critical');
  const high = boardGaps.filter((gap) => gap.boardSeverity === 'High');
  const moderate = boardGaps.filter((gap) => gap.boardSeverity === 'Moderate');
  const totalCoveredSkills = Array.from(coveredByCategory.values()).reduce((sum, skills) => sum + skills.length, 0);
  const progressEntries = Object.values(skillProgressRecords);
  const activeMissingCount = progressEntries.filter((record) => ['missing', 'started', 'in_progress'].includes(record.status)).length || gaps.length;
  const inProgressCount = progressEntries.filter((record) => ['started', 'in_progress'].includes(record.status)).length;
  const completedCount = progressEntries.filter((record) => ['completed', 'evidenced', 'covered'].includes(record.status)).length;
  const evidenceUploadedCount = progressEntries.filter((record) => Boolean(record.evidenceFilename)).length || evidenceRecords.length;
  const selectedCategoryRow = categoryProgress.find((row) => row.category === selectedCategory) || null;
  const selectedMissing = missingByCategory.get(selectedCategory) || [];
  const selectedCovered = coveredByCategory.get(selectedCategory) || [];
  const selectedStatus = selectedCategoryRow ? normalizeProgressLabel(selectedCategoryRow.percent) : null;
  const hasAnyProgressData = gaps.length > 0 || categoryProgress.some((row) => row.percent > 0 || row.relatedSkillRecords.length > 0);
  const recommendedResourceByGap = useMemo(() => {
    const map = new Map<string, DashboardCourse>();
    gaps.forEach((gap) => {
      const match = [...(gap.topResources || []), ...courses].find((course) =>
        course.reviewed && course.mappedSkills.some((skill) => normalizeSkill(skill) === normalizeSkill(gap.skill)));
      if (match) map.set(gap.skill, match);
    });
    return map;
  }, [courses, gaps]);
  const summaryCards = [
    { label: 'Missing Skills', value: activeMissingCount, tone: 'critical', icon: 'puzzle' as IconName, subtitle: 'Still missing from top matches' },
    { label: 'In Progress', value: inProgressCount, tone: 'high', icon: 'graduation' as IconName, subtitle: 'Active learning underway' },
    { label: 'Completed / Covered', value: Math.max(totalCoveredSkills, completedCount), tone: 'progress', icon: 'check-circle' as IconName, subtitle: 'Covered by skills or learning' },
    { label: 'Evidence Uploaded', value: evidenceUploadedCount, tone: 'evidence', icon: 'upload' as IconName, subtitle: 'Supporting documents on file' },
  ] as const;
  return (
    <div>
      <div className="cand-page-header">
        <div className="cand-learning-header-row">
          <div>
            <h1 className="cand-page-title">Skill Gaps & Development Progress</h1>
            <p className="cand-page-subtitle">Missing skills identified from your job matches with guided development tracking</p>
          </div>
          <button className="cand-inline-link" type="button" onClick={onOpenUpskilling}>Explore Learning Recommendations →</button>
        </div>
      </div>

      <div className="cand-gap-insights-bar">
        {summaryCards.map((card) => (
          <div key={card.label} className={`cand-gap-insight ${card.tone}`}>
            <div className="cand-gap-insight-label"><UIIcon name={card.icon} className="cand-mini-icon" />{card.label}</div>
            <div className="cand-gap-insight-value">{card.value}</div>
            <div className="cand-gap-insight-subtitle">{card.subtitle}</div>
          </div>
        ))}
      </div>

      <div className="cand-tab-row cand-gap-view-tabs cand-skill-gap-tabs" role="tablist" aria-label="Skill gaps views">
          <button
            id="skill-gap-tab-board"
            className={`cand-tab-btn ${activeSkillGapView === 'board' ? 'active' : ''}`}
            type="button"
            role="tab"
            aria-selected={activeSkillGapView === 'board'}
            aria-controls="skill-gap-board-panel"
            tabIndex={activeSkillGapView === 'board' ? 0 : -1}
            onClick={() => selectSkillGapView('board')}
            onKeyDown={handleSkillGapTabKeyDown}
          >
            <UIIcon name="columns" className="cand-tab-icon" />Skill Gap Board
          </button>
          <button
            id="skill-gap-tab-progress"
            className={`cand-tab-btn ${activeSkillGapView === 'progress' ? 'active' : ''}`}
            type="button"
            role="tab"
            aria-selected={activeSkillGapView === 'progress'}
            aria-controls="skill-gap-progress-panel"
            tabIndex={activeSkillGapView === 'progress' ? 0 : -1}
            onClick={() => selectSkillGapView('progress')}
            onKeyDown={handleSkillGapTabKeyDown}
          >
            <UIIcon name="chart" className="cand-tab-icon" />Development Progress
          </button>
      </div>

      {activeSkillGapView === 'board' ? (
        <div id="skill-gap-board-panel" role="tabpanel" aria-labelledby="skill-gap-tab-board" tabIndex={0}>
          <h2 className="cand-card-title cand-gap-content-title mb-3"><UIIcon name="columns" className="cand-title-icon" />Skills to Develop</h2>
          {!hasAnyProgressData ? (
            <SkillGapEmptyState />
          ) : (
          <div className="cand-gap-kanban">
            {[
              { key: 'critical', title: 'Critical', icon: 'shield' as IconName, severity: 'Critical' as SeverityLevel, items: critical },
              { key: 'high', title: 'High Priority', icon: 'lightbulb' as IconName, severity: 'High' as SeverityLevel, items: high },
              { key: 'moderate', title: 'Moderate', icon: 'list' as IconName, severity: 'Moderate' as SeverityLevel, items: moderate },
            ].map((column) => (
              <div key={column.key} className="cand-gap-col">
                <div className={`cand-gap-col-head ${column.key}`}>
                  <UIIcon name={column.icon} className="cand-gap-col-icon" />
                  {column.title}
                  <span className="cand-gap-col-count">{column.items.length}</span>
                </div>
                <div className="cand-gap-col-body">
                  {column.items.length > 0 ? column.items.map((gap) => {
                    const progressKey = (gap.skillId || normalizeSkill(gap.skill)).toUpperCase();
                    const recommendedResource = recommendedResourceByGap.get(gap.skill);
                    return (
                      <div key={`${column.key}-${gap.skill}`} className="cand-gap-k-card">
                        <div className="cand-gap-top">
                          <span className="cand-gap-name">{cleanSkillDisplayName(gap.skill)}</span>
                          <span className={`cand-gap-priority ${severityClass(column.severity)}`}>{column.title}</span>
                        </div>
                        <div className="cand-gap-meta">
                          <span><UIIcon name="briefcase" className="cand-mini-icon" />{formatGapMissingCount(gap)}</span>
                          <span><UIIcon name="target" className="cand-mini-icon" />{gap.category}</span>
                        </div>
                        <div className="text-[11px] text-soft">
                          {gap.affectedCount === null ? 'This skill was identified as a gap in your matching results.' : `This skill is prioritized because it appears as a missing requirement in ${gap.affectedCount} of your recommended roles.`}
                        </div>
                        <div className="cand-gap-jobs">
                          {gap.relatedJobs.map((jobTitle) => (
                            <span key={`${gap.skill}-${jobTitle}`} className="cand-gap-chip">{jobTitle}</span>
                          ))}
                        </div>
                        <div className="cand-gap-learning">
                          <div className="cand-gap-label">Recommended Learning Resource</div>
                          <div className="cand-gap-value">
                            {recommendedResource ? `${recommendedResource.title} (${recommendedResource.provider})` : 'No recommended learning resource available yet.'}
                          </div>
                          {gap.topResources && gap.topResources.length > 1 ? (
                            <div className="mt-2 text-[11px] text-soft">
                              More options: {gap.topResources.slice(1, 3).map((resource) => resource.title).join(' · ')}
                            </div>
                          ) : null}
                        </div>
                        <p className="mt-2 text-xs text-soft">Learning and certificates are managed by the provider. Kareerly does not verify completion. Opening a resource does not change skill coverage, readiness, or match scores.</p>
                        <div className="cand-gap-actions">
                          <button className="cand-gap-start" type="button" disabled={!recommendedResource || !learningResourceUrl(recommendedResource)} onClick={() => {
                            const url = recommendedResource && learningResourceUrl(recommendedResource);
                            if (url) window.open(url, '_blank', 'noopener,noreferrer');
                          }}>
                            <UIIcon name="graduation" className="cand-btn-icon" />{recommendedResource?.urlLabel || 'Start learning'}
                          </button>
                          <button className="cand-gap-resource" type="button" onClick={() => onUpdateSkillProgress(progressKey, 'completed', recommendedResource?.id)}>
                            Mark Completed
                          </button>
                          <button className="cand-gap-resource cand-gap-upload" type="button" onClick={onUploadSkillEvidence}>
                            Upload Evidence
                          </button>
                          <button className="cand-gap-resource" type="button" onClick={onOpenUpskilling}>
                            View resources
                          </button>
                        </div>
                      </div>
                    );
                  }) : <div className="cand-gap-empty">No items in this column.</div>}
                </div>
              </div>
            ))}
          </div>
          )}
        </div>
      ) : (
        <div id="skill-gap-progress-panel" role="tabpanel" aria-labelledby="skill-gap-tab-progress" tabIndex={0}>
          <h2 className="cand-card-title cand-gap-content-title mb-2"><UIIcon name="chart" className="cand-title-icon" />Your Development Progress</h2>
          <p className="mb-3 text-xs text-soft">
            Progress is an explainable career-guidance indicator, not a mastery-verification score.
          </p>

          {!hasAnyProgressData ? (
            <SkillGapEmptyState />
          ) : (
          <div className="cand-sdp-dual">
            <div className="cand-sdp-list">
              <div className="cand-sdp-list-head">Categories & Progress</div>
              {sortedCategories.length > 0 ? sortedCategories.map((row) => {
                const rowStatus = normalizeProgressLabel(row.percent);
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
                      <div className="cand-sdp-row-counts">{row.missing} missing · {Math.max(row.matched, row.completed)} covered</div>
                      <div className="cand-sdp-row-counts">{row.evidenceUploaded} evidence · {row.completed} completed learning</div>
                    </div>
                  </button>
                );
              }) : <SkillGapEmptyState />}
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
                  <div className="cand-sdp-row-counts mb-3">
                    {selectedCategoryRow.evidenceUploaded} supporting evidence · {selectedCategoryRow.completed} completed learning
                  </div>

                  <div className="cand-sdp-detail-section">Missing Skills</div>
                  <div className="cand-skill-row">
                    {selectedMissing.length > 0 ? selectedMissing.map((skill) => <span key={`missing-${selectedCategory}-${skill}`} className="cand-skill-miss">{skill}</span>) : <span className="cand-covered-empty">No missing skills in this category.</span>}
                  </div>

                  <div className="cand-sdp-detail-section">Completed / Covered</div>
                  <div className="cand-skill-row">
                    {selectedCovered.length > 0 ? selectedCovered.map((skill) => <span key={`covered-${selectedCategory}-${skill}`} className="cand-skill-match"><UIIcon name="check-circle" className="cand-chip-icon" />{skill}</span>) : <span className="cand-covered-empty">No completed or covered skills yet.</span>}
                  </div>

                  <div className="cand-sdp-detail-section">Related Skill Records</div>
                  <div className="cand-skill-row">
                    {selectedCategoryRow.relatedSkillRecords.length > 0 ? selectedCategoryRow.relatedSkillRecords.map((skill) => (
                      <span key={`record-${selectedCategory}-${skill}`} className="cand-gap-chip">{cleanSkillDisplayName(skill)}</span>
                    )) : <span className="cand-covered-empty">No related skill records yet.</span>}
                  </div>

                  <div className="cand-sdp-detail-section">Recommended Next Action</div>
                  <div className="cand-sdp-next-action">
                    {selectedMissing.length > 0 ? `Focus on ${selectedMissing[0]} to improve category alignment.` : 'Maintain momentum by continuing related upskilling content.'}
                  </div>
                  <div className="cand-sdp-action-row">
                    <button className="cand-btn-primary cand-btn-sm" type="button" onClick={onOpenUpskilling}>
                      <UIIcon name="graduation" className="cand-btn-icon" />Open Learning Recommendations
                    </button>
                    <button className="cand-btn-secondary cand-btn-sm" type="button" onClick={onOpenResume}>
                      <UIIcon name="upload" className="cand-btn-icon" />Update Resume
                    </button>
                  </div>
                </>
              ) : (
                <SkillGapEmptyState />
              )}
            </div>
          </div>
          )}

          <div className="cand-sdp-disclaimer">
            Skill Development Progress remains an explainable indicator for guidance and does not certify verified competency or guarantee employment.
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: ApplicationStatus }) {
  return <span className={`app-status-badge status-${status.toLowerCase()}`}>{status}</span>;
}

function ApplicationsPage({
  loadStatus,
  applications,
  onViewJob,
  onWithdraw,
  onOpenMessages,
}: {
  loadStatus: 'loading' | 'ready' | 'error';
  applications: DashboardApplication[];
  onViewJob: (application: DashboardApplication) => void;
  onWithdraw: (application: DashboardApplication) => void;
  onOpenMessages: () => void;
}) {
  const [searchValue, setSearchValue] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'shortlisted' | 'interviewing' | 'hired' | 'rejected' | 'withdrawn'>('all');
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const hasInterviewing = applications.some((app) => app.status === 'Interviewing');
  const activeFilterCount = statusFilter === 'all' ? 0 : 1;
  const filteredApplications = useMemo(() => {
    const query = searchValue.trim().toLowerCase();
    return applications.filter((application) => {
      if (statusFilter !== 'all' && statusKey(application.status) !== statusFilter) return false;
      if (!query) return true;
      return `${application.jobTitle} ${application.company} ${application.status} ${scoreLabel(application.matchScore)}`
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
        <div className="cand-toolbar cand-app-toolbar">
          <div className="cand-app-search">
            <UIIcon name="search" className="cand-search-icon" />
            <input
              value={searchValue}
              onChange={(event) => setSearchValue(event.target.value)}
              placeholder="Search by job title, company, status, or match %..."
            />
          </div>
          <div className="cand-filter-control">
            <button
              className={`cand-filter-button ${activeFilterCount > 0 ? 'active' : ''}`}
              type="button"
              aria-expanded={filterPanelOpen}
              aria-controls="applications-filter-panel"
              onClick={() => setFilterPanelOpen((current) => !current)}
            >
              <UIIcon name="filter" className="cand-btn-icon" />
              Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
            </button>
            <FilterPanel
              open={filterPanelOpen}
              panelId="applications-filter-panel"
              title="Application filters"
              labelledBy="applications-filter-panel-title"
              onClose={() => setFilterPanelOpen(false)}
              onApply={() => setFilterPanelOpen(false)}
              onClear={() => { setStatusFilter('all'); setFilterPanelOpen(false); }}
            >
              <fieldset className="cand-filter-section">
                <legend className="cand-filter-section-title">Status</legend>
                <label className="cand-filter-radio">
                  <input type="radio" name="application-status" checked={statusFilter === 'all'} onChange={() => setStatusFilter('all')} />
                  <span>All statuses</span>
                </label>
                {APPLICATION_STATUS_FILTERS.map(([value, label]) => (
                  <label key={value} className="cand-filter-radio">
                    <input type="radio" name="application-status" checked={statusFilter === value} onChange={() => setStatusFilter(value)} />
                    <span>{label}</span>
                  </label>
                ))}
              </fieldset>
            </FilterPanel>
          </div>
        </div>
        {activeFilterCount > 0 && (
          <div className="cand-active-filter-chips" aria-label="Active application filters">
            <ActiveFilterChip label={APPLICATION_STATUS_FILTERS.find(([value]) => value === statusFilter)?.[1] || statusFilter} onRemove={() => setStatusFilter('all')} />
            <button className="cand-filter-reset-link" type="button" onClick={() => setStatusFilter('all')}>Clear all</button>
          </div>
        )}
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
                      <span className="font-display text-sm font-extrabold text-rust">{scoreLabel(application.matchScore)}</span>
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
          {loadStatus === 'loading' ? 'Loading applications…' : loadStatus === 'error' ? 'Applications could not be loaded. Please try again later.' : applications.length > 0 ? 'No applications match the selected filter/search.' : 'No internal applications yet. Apply from Job Matches to start tracking.'}
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
}: {
  surveyAnswers: SurveyAnswers;
  extraPreferences: { jobLevel: string; preferredLocation: string };
  skillNames: string[];
  isLoading: boolean;
  onUpdateExtra: (next: { jobLevel: string; preferredLocation: string }) => void;
  onUpdateSkills: (skills: string[]) => void;
  onSave: (answers: SurveyAnswers) => void;
  onReset: () => void;
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
          <FormField label="Career Area of Interest">
            <select className="cand-form-select" value={draft.industry} onChange={(event) => setDraft((current) => ({ ...current, industry: event.target.value }))}>
              {careerAreaOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
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
          </div>
        </div>

        <div className="cand-form-actions">
          <button className="cand-btn-primary" type="button" disabled={isLoading} onClick={() => onSave(draft)}>
            {isLoading ? 'Saving and Refreshing...' : 'Save Preferences'}
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
  profile,
  password,
  savedResumeFileName,
  isSavingProfile,
  isUpdatingPassword,
  profileSaveNotice,
  onLanguage,
  onOpenDelete,
  onOpenResume,
  onViewResume,
  onOpenEvidenceUpload,
  onViewEvidence,
  onReplaceEvidence,
  onDeleteEvidence,
  onProfileChange,
  onIdentityChange,
  onPasswordChange,
  onUpdatePassword,
  onSave,
}: {
  user: { name: string; email: string; publicId: string };
  uiLanguage: 'en' | 'fil';
  evidenceRecords: EvidenceUploadRecord[];
  savedResumeFileName: string;
  profile: {
    contactNumber: string;
    birthday: string;
    address: string;
    location: string;
    highestEducationalAttainment: string;
    degreeProgram: string;
    schoolUniversity: string;
    yearGraduated: string;
  };
  password: { current: string; next: string; confirm: string };
  isSavingProfile: boolean;
  isUpdatingPassword: boolean;
  profileSaveNotice: string | null;
  onLanguage: (lang: 'en' | 'fil') => void;
  onOpenDelete: () => void;
  onOpenResume: () => void;
  onViewResume: () => void;
  onOpenEvidenceUpload: () => void;
  onViewEvidence: (record: EvidenceUploadRecord) => void;
  onReplaceEvidence: (record: EvidenceUploadRecord) => void;
  onDeleteEvidence: (record: EvidenceUploadRecord) => void;
  onProfileChange: (profile: {
    contactNumber: string;
    birthday: string;
    address: string;
    location: string;
    highestEducationalAttainment: string;
    degreeProgram: string;
    schoolUniversity: string;
    yearGraduated: string;
  }) => void;
  onIdentityChange: (identity: { name: string; email: string }) => void;
  onPasswordChange: (password: { current: string; next: string; confirm: string }) => void;
  onUpdatePassword: () => void;
  onSave: () => void;
}) {
  const t = (text: string) => tr(uiLanguage, text);
  const groupedEvidence = useMemo(() => {
    const groups = new Map<string, EvidenceUploadRecord[]>();
    evidenceRecords.forEach((record) => {
      const key = record.category?.trim() || 'Other';
      const current = groups.get(key) || [];
      current.push(record);
      groups.set(key, current);
    });
    return Array.from(groups.entries()).sort(([left], [right]) => left.localeCompare(right));
  }, [evidenceRecords]);

  return (
    <div>
      <div className="cand-page-header">
        <h1 className="cand-page-title">{t('Account Settings')}</h1>
        <p className="cand-page-subtitle">{t('Manage personal details, resume, education, and account controls')}</p>
      </div>

      <div className="cand-acct-section">
        <div className="cand-acct-title">{t('Language Preference')}</div>
        <p className="mb-3 text-xs text-soft">
          {uiLanguage === 'fil'
            ? 'Gagamitin ang Filipino sa mga label at tagubilin ng Kareerly. Mananatili sa orihinal na wika ang nilalaman ng resume at mga trabahong ipinaskil ng employer.'
            : 'Choose the language used for Kareerly labels and instructions. Resume content and employer-provided job posts remain in their original language.'}
        </p>
        <div className="flex gap-2">
          <button className={`cand-tab-btn ${uiLanguage === 'en' ? 'active' : ''}`} type="button" onClick={() => onLanguage('en')}>
            {t('English')}
          </button>
          <button className={`cand-tab-btn ${uiLanguage === 'fil' ? 'active' : ''}`} type="button" onClick={() => onLanguage('fil')}>
            {t('Filipino')}
          </button>
        </div>
      </div>

      <div className="cand-acct-grid">
        <div className="cand-acct-section">
          <div className="cand-acct-title">{t('Personal Details')}</div>
          {profileSaveNotice && (
            <div className="cand-notice info mb-3">
              <span>{profileSaveNotice}</span>
            </div>
          )}
          <div className="space-y-3">
            <FormField label={t('Full Name')}><input className="cand-form-input" value={user.name} onChange={(event) => onIdentityChange({ name: event.target.value, email: user.email })} /></FormField>
            <FormField label={t('Email Address')}><input className="cand-form-input" type="email" value={user.email} onChange={(event) => onIdentityChange({ name: user.name, email: event.target.value })} /></FormField>
            <FormField label={t('Candidate ID')}><input className="cand-form-input" value={user.publicId || t('Not available')} readOnly /></FormField>
            <FormField label={t('Contact Number')}><input className="cand-form-input" value={profile.contactNumber} onChange={(event) => onProfileChange({ ...profile, contactNumber: event.target.value })} placeholder={t('Enter contact number')} /></FormField>
            <FormField label={t('Birthday')}><input className="cand-form-input" value={profile.birthday} onChange={(event) => onProfileChange({ ...profile, birthday: event.target.value })} type="date" /></FormField>
            <FormField label={t('Address')}><input className="cand-form-input" value={profile.address} onChange={(event) => onProfileChange({ ...profile, address: event.target.value })} placeholder={t('Enter your address')} /></FormField>
            <FormField label={t('Location / Region')}><input className="cand-form-input" value={profile.location} onChange={(event) => onProfileChange({ ...profile, location: event.target.value })} placeholder={t('Enter your region')} /></FormField>
          </div>
          <button className="cand-btn-primary mt-4" type="button" onClick={onSave} disabled={isSavingProfile}>
            {isSavingProfile ? `${t('Saving')}...` : t('Save Details')}
          </button>
        </div>

        <div>
          <div className="cand-acct-section">
            <div className="cand-acct-title">{t('Password & Security')}</div>
            <div className="space-y-3">
              <FormField label={t('Current Password')}><input className="cand-form-input" type="password" value={password.current} onChange={(event) => onPasswordChange({ ...password, current: event.target.value })} /></FormField>
              <FormField label={t('New Password')}><input className="cand-form-input" type="password" value={password.next} onChange={(event) => onPasswordChange({ ...password, next: event.target.value })} /></FormField>
              <FormField label={t('Confirm New Password')}><input className="cand-form-input" type="password" value={password.confirm} onChange={(event) => onPasswordChange({ ...password, confirm: event.target.value })} /></FormField>
            </div>
            <button className="cand-btn-primary mt-4" type="button" onClick={onUpdatePassword} disabled={isUpdatingPassword}>
              {isUpdatingPassword ? `${t('Updating')}...` : t('Update Password')}
            </button>
          </div>

          <div className="cand-acct-section">
            <div className="cand-acct-title">{t('Resume')}</div>
            <div className="cand-notice info mb-3">
              <span>{uiLanguage === 'fil' ? 'Tingnan o i-upload ang pinakabagong resume. Ang pag-update nito ay magre-refresh ng mga tugmang trabaho, kakulangan sa kasanayan, at rekomendasyon.' : 'View or upload your latest resume. Updating resume refreshes matches, gaps, and recommendations.'}</span>
            </div>
            <div className="mb-3 text-sm text-mid">
              {t('Saved resume:')} <strong>{savedResumeFileName || t('No resume saved yet')}</strong>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button className="cand-btn-secondary flex-1 justify-center" type="button" onClick={onViewResume} disabled={!savedResumeFileName}>
                <UIIcon name="eye" className="cand-btn-icon" />{t('View Resume')}
              </button>
              <button className="cand-btn-secondary flex-1 justify-center" type="button" onClick={onOpenResume}>
                <UIIcon name="upload" className="cand-btn-icon" />{t('Update Resume')}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="cand-acct-section">
          <div className="cand-acct-title">Education</div>
          <div className="cand-form-grid">
          <FormField label="Highest Educational Attainment"><input className="cand-form-input" value={profile.highestEducationalAttainment} onChange={(event) => onProfileChange({ ...profile, highestEducationalAttainment: event.target.value })} placeholder="Enter highest educational attainment" /></FormField>
          <FormField label="Degree / Program"><input className="cand-form-input" value={profile.degreeProgram} onChange={(event) => onProfileChange({ ...profile, degreeProgram: event.target.value })} placeholder="Enter degree or program" /></FormField>
          <FormField label="School / University"><input className="cand-form-input" value={profile.schoolUniversity} onChange={(event) => onProfileChange({ ...profile, schoolUniversity: event.target.value })} placeholder="Enter school or university" /></FormField>
          <FormField label="Year Graduated"><input className="cand-form-input" value={profile.yearGraduated} onChange={(event) => onProfileChange({ ...profile, yearGraduated: event.target.value })} placeholder="Enter graduation year" /></FormField>
          </div>
        <button className="cand-btn-primary mt-3" type="button" onClick={onSave} disabled={isSavingProfile}>
          {isSavingProfile ? 'Saving...' : 'Save Education'}
        </button>
      </div>

      <div className="cand-acct-section">
        <div className="cand-acct-title">User-Uploaded Evidence</div>
        <p className="mb-3 text-xs text-soft">
          Parsed resume information is used for your profile and job matching. Only PDFs submitted through Upload Evidence appear here. File checks do not confirm issuer authenticity, completion, or certificate validity. Uploads remain Pending Verification.
        </p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-soft">Upload certificates, course completion files, portfolio outputs, or project samples to support your Skill Development Progress.</div>
          <button className="cand-btn-secondary cand-btn-sm" type="button" onClick={onOpenEvidenceUpload}>
            <UIIcon name="upload" className="cand-btn-icon" />Upload Evidence
          </button>
        </div>
        <div className="mt-4 space-y-4">
          {groupedEvidence.length > 0 ? (
            groupedEvidence.map(([category, records]) => (
              <div key={category} className="cand-evidence-group">
                <div className="cand-evidence-group-title">{category}</div>
                <div className="space-y-3">
                  {records.map((record) => (
                    <div key={record.id} className="cand-evidence-card">
                      <div className="cand-evidence-card-main">
                        <div className="cand-evidence-card-title-row">
                          <div className="cand-evidence-card-title">{record.title}</div>
                          <span className={`cand-msg-badge ${record.status === 'Verified' ? 'accepted' : 'pending'}`}>{record.status}</span>
                        </div>
                        <div className="cand-evidence-card-meta">
                          <span>{cleanSkillDisplayName(record.relatedSkill || '') || 'Related skill not set'}</span>
                          <span>{record.evidenceType}</span>
                          <span>Uploaded {formatDateLabel(record.uploadedAt)}</span>
                        </div>
                        {record.notes ? <div className="cand-evidence-card-note">{record.notes}</div> : null}
                      </div>
                      <div className="cand-evidence-card-actions">
                        <button className="cand-btn-secondary cand-btn-sm" type="button" onClick={() => onViewEvidence(record)}>
                          <UIIcon name="eye" className="cand-btn-icon" />View
                        </button>
                        <button className="cand-btn-secondary cand-btn-sm" type="button" onClick={() => onReplaceEvidence(record)}>
                          <UIIcon name="upload" className="cand-btn-icon" />Replace
                        </button>
                        <button className="cand-btn-danger cand-btn-sm" type="button" onClick={() => onDeleteEvidence(record)}>
                          <UIIcon name="trash" className="cand-btn-icon" />Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          ) : (
            <div className="cand-gap-empty-state">
              No evidence uploaded yet. Upload certificates, course completion files, portfolio outputs, or project samples to support your Skill Development Progress.
            </div>
          )}
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
  applications,
  onSelect,
  onApply,
  onWithdraw,
  onGetApplicationStatus,
  onSave,
  onOpenMatches,
  onOpenApplications,
  onOpenUpskilling,
  isLoading,
  error,
  onRetry,
}: {
  kareers: DashboardJob[];
  selectedId: string;
  selected: DashboardJob | null;
  applications: DashboardApplication[];
  onSelect: (id: string) => void;
  onApply: (jobId: string) => Promise<boolean>;
  onWithdraw: (application: DashboardApplication) => void;
  onGetApplicationStatus: (jobId: string, jobSource: 'internal' | 'employer') => ApplicationStatus | null;
  onSave: (jobId: string) => void;
  onOpenMatches: () => void;
  onOpenApplications: () => void;
  onOpenUpskilling: () => void;
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const [searchValue, setSearchValue] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [levelFilter, setLevelFilter] = useState('');
  const [setupFilter, setSetupFilter] = useState('');
  const [employmentFilter, setEmploymentFilter] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest' | 'salary-high' | 'salary-low' | 'az' | 'za'>('newest');
  const [alignFilter, setAlignFilter] = useState('');
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pendingApplyJob, setPendingApplyJob] = useState<DashboardJob | null>(null);
  const [submittedApplyJob, setSubmittedApplyJob] = useState<DashboardJob | null>(null);

  const filteredKareers = useMemo(() => {
    const query = searchValue.trim().toLowerCase();
    const filtered = kareers.filter((job) => {
      if (categoryFilter && !(job.category || '').toLowerCase().includes(categoryFilter.toLowerCase())) return false;
      if (levelFilter && !(job.jobLevel || '').toLowerCase().includes(levelFilter.toLowerCase())) return false;
      if (setupFilter && !(job.setup || '').toLowerCase().includes(setupFilter.toLowerCase())) return false;
      if (employmentFilter && !(job.employmentType || '').toLowerCase().includes(employmentFilter.toLowerCase())) return false;
      if (locationFilter && !(job.location || '').toLowerCase().includes(locationFilter.toLowerCase())) return false;
      if (alignFilter && job.matchCategory !== alignFilter) return false;
      if (!query) return true;
      return `${job.title} ${job.company} ${job.category || ''} ${job.subCategory || ''} ${job.location} ${job.setup} ${job.description || ''} ${job.requiredSkills.join(' ')} ${job.preferredSkills.join(' ')}`
        .toLowerCase()
        .includes(query);
    });
    return filtered.sort((left, right) => {
      if (sortOrder === 'az' || sortOrder === 'za') return (sortOrder === 'az' ? 1 : -1) * left.title.localeCompare(right.title);
      if (sortOrder === 'salary-high' || sortOrder === 'salary-low') return (sortOrder === 'salary-high' ? -1 : 1) * ((left.salaryMax || left.salaryMin || 0) - (right.salaryMax || right.salaryMin || 0));
      const leftDate = new Date(left.createdAt || 0).getTime();
      const rightDate = new Date(right.createdAt || 0).getTime();
      return sortOrder === 'oldest' ? leftDate - rightDate : rightDate - leftDate;
    });
  }, [alignFilter, categoryFilter, employmentFilter, kareers, levelFilter, locationFilter, searchValue, setupFilter, sortOrder]);

  const categories = useMemo(() => Array.from(new Set(kareers.map((job) => job.category).filter(Boolean) as string[])).sort(), [kareers]);
  const locations = useMemo(() => Array.from(new Set(kareers.map((job) => job.location).filter(Boolean))).sort(), [kareers]);
  const pageCount = Math.max(1, Math.ceil(filteredKareers.length / 20));
  const pagedKareers = filteredKareers.slice((page - 1) * 20, page * 20);
  const activeCareerFilters = [
    categoryFilter ? { label: categoryFilter, onRemove: () => setCategoryFilter('') } : null,
    employmentFilter ? { label: `Employment: ${employmentFilter}`, onRemove: () => setEmploymentFilter('') } : null,
    levelFilter ? { label: `Experience: ${levelFilter}`, onRemove: () => setLevelFilter('') } : null,
    setupFilter ? { label: `Work setup: ${setupFilter}`, onRemove: () => setSetupFilter('') } : null,
    locationFilter ? { label: `Location: ${locationFilter}`, onRemove: () => setLocationFilter('') } : null,
    alignFilter ? { label: `Alignment: ${alignFilter === 'fit-now' ? 'Fit-Now' : 'Aspiration'}`, onRemove: () => setAlignFilter('') } : null,
  ].filter((filter): filter is { label: string; onRemove: () => void } => Boolean(filter));
  const clearCareerFilters = () => {
    setCategoryFilter('');
    setEmploymentFilter('');
    setLevelFilter('');
    setSetupFilter('');
    setLocationFilter('');
    setAlignFilter('');
    setFilterPanelOpen(false);
  };

  useEffect(() => { setPage(1); }, [alignFilter, categoryFilter, employmentFilter, levelFilter, locationFilter, searchValue, setupFilter, sortOrder]);

  useEffect(() => {
    if (filteredKareers.length === 0) return;
    if (!filteredKareers.some((job) => job.id === selectedId)) {
      onSelect(filteredKareers[0].id);
    }
  }, [filteredKareers, onSelect, selectedId]);

  const activeSelected = filteredKareers.find((job) => job.id === selectedId) || selected || filteredKareers[0] || null;
  const activeApplication = activeSelected ? applications.find((app) => app.jobId === activeSelected.id && app.jobSource === activeSelected.jobSource && app.status !== 'Withdrawn') || null : null;
  const activeApplicationStatus = activeSelected ? onGetApplicationStatus(activeSelected.id, activeSelected.jobSource) : null;
  const isApplied = Boolean(activeApplicationStatus);

  return (
    <div>
      <div className="cand-sticky-controls">
        <div className="cand-page-header cand-page-header-inline">
          <h1 className="cand-page-title">Kareers</h1>
          <p className="cand-page-subtitle">Explore career paths and job opportunities by source, category, and alignment</p>
        </div>
      </div>

      <div className="cand-toolbar cand-kareers-toolbar">
        <div className="cand-search-box cand-kareers-search">
          <UIIcon name="search" className="cand-search-icon" />
          <input value={searchValue} onChange={(event) => setSearchValue(event.target.value)} placeholder="Search by role, skill, category, or location..." />
        </div>
        <div className="cand-filter-control">
          <button
            className={`cand-filter-button ${activeCareerFilters.length > 0 ? 'active' : ''}`}
            type="button"
            aria-expanded={filterPanelOpen}
            aria-controls="career-filter-panel"
            onClick={() => setFilterPanelOpen((current) => !current)}
          >
            <UIIcon name="filter" className="cand-btn-icon" />
            Filters{activeCareerFilters.length > 0 ? ` (${activeCareerFilters.length})` : ''}
          </button>
          <FilterPanel
            open={filterPanelOpen}
            panelId="career-filter-panel"
            title="Career filters"
            labelledBy="career-filter-panel-title"
            onClose={() => setFilterPanelOpen(false)}
            onApply={() => setFilterPanelOpen(false)}
            onClear={clearCareerFilters}
          >
            <div className="cand-filter-section">
              <div className="cand-filter-section-title">Job details</div>
              <div className="cand-filter-grid">
                <div className="cand-filter-field">
                  <label htmlFor="career-category-filter">Category</label>
                  <select id="career-category-filter" className="cand-form-select" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
                    <option value="">All categories</option>
                    {categories.map((category) => <option key={category} value={category}>{category}</option>)}
                  </select>
                </div>
                <div className="cand-filter-field">
                  <label htmlFor="career-employment-filter">Employment type</label>
                  <select id="career-employment-filter" className="cand-form-select" value={employmentFilter} onChange={(event) => setEmploymentFilter(event.target.value)}>
                    <option value="">All employment types</option>
                    {['Full Time', 'Part Time', 'Contract', 'Internship', 'Freelance'].map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                </div>
                <div className="cand-filter-field">
                  <label htmlFor="career-level-filter">Experience level</label>
                  <select id="career-level-filter" className="cand-form-select" value={levelFilter} onChange={(event) => setLevelFilter(event.target.value)}>
                    <option value="">All levels</option>
                    <option value="Entry">Entry level</option>
                    <option value="Junior">Junior</option>
                    <option value="Mid">Mid-level</option>
                    <option value="Senior">Senior</option>
                    <option value="Trainee">Trainee</option>
                  </select>
                </div>
                <div className="cand-filter-field">
                  <label htmlFor="career-setup-filter">Work setup</label>
                  <select id="career-setup-filter" className="cand-form-select" value={setupFilter} onChange={(event) => setSetupFilter(event.target.value)}>
                    <option value="">All work setups</option>
                    <option value="Remote">Remote</option>
                    <option value="Hybrid">Hybrid</option>
                    <option value="Onsite">Onsite</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="cand-filter-section">
              <div className="cand-filter-section-title">Location</div>
              <div className="cand-filter-field">
                <label htmlFor="career-location-filter">Location</label>
                <select id="career-location-filter" className="cand-form-select" value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)}>
                  <option value="">All locations</option>
                  {locations.map((location) => <option key={location} value={location}>{location}</option>)}
                </select>
              </div>
            </div>
            <div className="cand-filter-section">
              <div className="cand-filter-section-title">Match</div>
              <div className="cand-filter-field">
                <label htmlFor="career-alignment-filter">Alignment</label>
                <select id="career-alignment-filter" className="cand-form-select" value={alignFilter} onChange={(event) => setAlignFilter(event.target.value)}>
                  <option value="">All alignments</option>
                  <option value="fit-now">Fit-Now</option>
                  <option value="aspiration">Aspiration</option>
                </select>
              </div>
            </div>
          </FilterPanel>
        </div>
        <label className="cand-sort-control">
          <span className="sr-only">Sort jobs</span>
          <select className="cand-toolbar-select" value={sortOrder} onChange={(event) => setSortOrder(event.target.value as typeof sortOrder)}>
          <option value="newest">Newest</option><option value="oldest">Oldest</option><option value="salary-high">Salary High–Low</option><option value="salary-low">Salary Low–High</option><option value="az">A–Z</option><option value="za">Z–A</option>
          </select>
        </label>
      </div>
      {activeCareerFilters.length > 0 && (
        <div className="cand-active-filter-chips" aria-label="Active career filters">
          {activeCareerFilters.map((filter) => <ActiveFilterChip key={filter.label} label={filter.label} onRemove={filter.onRemove} />)}
          <button className="cand-filter-reset-link" type="button" onClick={clearCareerFilters}>Clear all</button>
        </div>
      )}

      <div className="cand-two-panel">
        <div className="cand-two-panel-left">
          <div className="cand-two-panel-left-hd">Career Paths and Roles</div>
          <div className="cand-kareer-list-scroll">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, index) => <div key={index} className="m-3 h-28 animate-pulse rounded-xl bg-bg" />)
            ) : error ? (
              <div className="p-4 text-sm text-red">Unable to load jobs.<button className="ml-2 font-bold underline" type="button" onClick={onRetry}>Retry</button></div>
            ) : pagedKareers.length > 0 ? (
              pagedKareers.map((job) => (
                <div key={job.id} className={`cand-kareer-item ${selectedId === job.id ? 'active' : ''}`}>
                  <button className="cand-kareer-select" type="button" onClick={() => onSelect(job.id)}>
                    <div className="text-sm font-bold text-dark"><UIIcon name="briefcase" className="cand-chip-icon" />{job.title}</div>
                    <div className="text-xs text-soft">{job.company} · {job.category || 'Not specified'}</div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {job.matchedSkills.slice(0, 3).map((skill) => (
                        <span key={`${job.id}-${skill}`} className="rounded-full bg-cream-d px-2 py-0.5 text-[10px] font-semibold text-mid">
                          {cleanSkillDisplayName(skill)}
                        </span>
                      ))}
                    </div>
                    <div className="cand-kareer-item-badges">
                      <span className="cand-kareer-mini-badge">{job.setup}</span>
                      <span className="cand-kareer-mini-badge">{job.jobLevel || 'Not specified'}</span>
                      <span className={`cand-kareer-mini-badge ${job.matchCategory === 'fit-now' ? 'fit' : 'asp'}`}>{job.hasMatchScore ? (job.matchCategory === 'fit-now' ? 'Fit-Now' : 'Aspiration') : 'Match not available'}</span>
                    </div>
                    <div className="cand-kareer-view-link">View Details</div>
                  </button>
                  <div className="cand-kareer-card-actions">
                    {job.sourceType === 'internal' ? (
                      <button
                        className={`cand-btn-secondary cand-btn-sm ${onGetApplicationStatus(job.id, job.jobSource) ? 'opacity-70' : ''}`}
                        type="button"
                        disabled={Boolean(onGetApplicationStatus(job.id, job.jobSource))}
                        onClick={() => {
                          onSelect(job.id);
                          if (!onGetApplicationStatus(job.id, job.jobSource)) setPendingApplyJob(job);
                        }}
                      >
                        {onGetApplicationStatus(job.id, job.jobSource) ? 'Applied ✓' : 'Apply'}
                      </button>
                    ) : (
                      <button className="cand-btn-secondary cand-btn-sm" type="button" onClick={() => onSelect(job.id)}>
                        View External Job
                      </button>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <div className="p-4 text-sm text-soft">{kareers.length === 0 ? 'No jobs are available right now.' : 'No jobs matched your current filters.'}</div>
            )}
          </div>
          {!isLoading && !error && pageCount > 1 && <div className="flex items-center justify-center gap-3 border-t border-bdr p-3 text-sm"><button type="button" disabled={page === 1} onClick={() => setPage((value) => value - 1)}>Previous</button><span>Page {page} of {pageCount}</span><button type="button" disabled={page === pageCount} onClick={() => setPage((value) => value + 1)}>Next</button></div>}
        </div>
        <div className="cand-two-panel-right">
          {activeSelected ? (
            <>
              <div className="mb-2 font-display text-2xl font-extrabold text-dark">{activeSelected.title}</div>
              <div className="mb-2 text-xs text-soft">
                {activeSelected.company} · {activeSelected.location} · {activeSelected.setup}
              </div>
              <div className={`mb-4 rounded-lg px-4 py-3 text-sm ${activeSelected.hasMatchScore && activeSelected.matchScore >= 60 ? 'bg-green-l text-forest' : 'bg-rust-l text-mid'}`}>
                {activeSelected.hasMatchScore ? getMatchBadgeLabel(activeSelected) : 'Explorable opportunity'}
              </div>
              <div className="mb-4 text-sm text-mid">{buildKareerScoreSupport(activeSelected)}</div>

              {activeSelected.sourceType === 'internal' && (
                <>
                  <div className="cand-kareer-apply-guidance">
                    <div className="cand-kareer-apply-title">Before You Apply</div>
                    {activeSelected.hasMatchScore ? (
                      <>
                        <div className="cand-kareer-apply-line">Matched Skills: {activeSelected.matchedSkills.length > 0 ? activeSelected.matchedSkills.slice(0, 3).map(cleanSkillDisplayName).join(', ') : 'Matched skills not detected yet.'}</div>
                        <div className="cand-kareer-apply-line">Missing Skills: {activeSelected.missingSkills.length > 0 ? activeSelected.missingSkills.slice(0, 3).map(cleanSkillDisplayName).join(', ') : 'No major missing skills identified yet.'}</div>
                        <div className="cand-kareer-apply-line">Recommended Learning Resources: {activeSelected.missingSkills.length > 0 ? `Start with ${cleanSkillDisplayName(activeSelected.missingSkills[0])} and related Kareerly learning resources.` : 'Continue strengthening your profile through Kareerly learning resources.'}</div>
                      </>
                    ) : (
                      <>
                        <div className="cand-kareer-apply-line">Required Skills: {activeSelected.requiredSkills.length > 0 ? activeSelected.requiredSkills.slice(0, 5).map(cleanSkillDisplayName).join(', ') : 'Required skills are not listed yet.'}</div>
                        <div className="cand-kareer-apply-line">Resume Match: Not calculated yet for this listing.</div>
                        <div className="cand-kareer-apply-line">You can still apply. The employer will review your application details.</div>
                      </>
                    )}
                  </div>

                  <div className="cand-kareer-primary-actions">
                    {isApplied ? (
                      <>
                        <button className="cand-btn-primary" type="button" disabled>
                          Applied ✓
                        </button>
                        {activeApplication && ['Pending', 'Shortlisted', 'Interviewing'].includes(activeApplication.status) && (
                          <button className="cand-btn-secondary" type="button" onClick={() => onWithdraw(activeApplication)}>
                            Withdraw Application
                          </button>
                        )}
                        <button className="cand-btn-secondary" type="button" onClick={onOpenApplications}>
                          View Application
                        </button>
                      </>
                    ) : (
                      <>
                        <button className="cand-btn-primary" type="button" onClick={() => setPendingApplyJob(activeSelected)}>
                          Apply Now
                        </button>
                        <button className="cand-btn-secondary" type="button" onClick={() => onSave(activeSelected.id)}>
                          <UIIcon name="bookmark" className="cand-btn-icon" />Save Job
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}

              <div className="cand-kareer-info-grid">
                <div><span className="cand-kareer-info-label">Category</span><span className="cand-kareer-info-value">{activeSelected.category || 'Not specified'}</span></div>
                <div><span className="cand-kareer-info-label">Sub-category</span><span className="cand-kareer-info-value">{activeSelected.subCategory || 'Not specified'}</span></div>
                <div><span className="cand-kareer-info-label">Experience Level</span><span className="cand-kareer-info-value">{activeSelected.jobLevel || 'Not specified'}</span></div>
                <div><span className="cand-kareer-info-label">Posted</span><span className="cand-kareer-info-value">{activeSelected.createdAt ? formatDateLabel(activeSelected.createdAt) : 'Date not available'}</span></div>
                <div><span className="cand-kareer-info-label">Location</span><span className="cand-kareer-info-value">{activeSelected.location}</span></div>
                <div><span className="cand-kareer-info-label">Work Setup</span><span className="cand-kareer-info-value">{activeSelected.setup}</span></div>
                <div><span className="cand-kareer-info-label">Employment Type</span><span className="cand-kareer-info-value">{activeSelected.employmentType || 'Not specified'}</span></div>
                <div><span className="cand-kareer-info-label">Salary</span><span className="cand-kareer-info-value">{activeSelected.salary || 'Salary not specified'}</span></div>
                <div><span className="cand-kareer-info-label">Match Category</span><span className="cand-kareer-info-value">{activeSelected.hasMatchScore ? (activeSelected.matchCategory === 'fit-now' ? 'Fit-Now' : 'Aspiration') : 'Not available'}</span></div>
                <div><span className="cand-kareer-info-label">Match Percentage</span><span className="cand-kareer-info-value">{activeSelected.hasMatchScore ? `${Math.round(activeSelected.matchScore)}%` : 'Not available'}</span></div>
              </div>

              <div className="mb-2 text-xs font-bold uppercase tracking-[0.5px] text-soft">Job Description</div>
              <div className="cand-kareer-detail-box whitespace-pre-wrap">
                {activeSelected.description ? formatJobDescription(activeSelected.description) : 'Full job description is not available yet for this listing, but you can still explore the role details and guidance below.'}
              </div>

              <div className="mb-2 mt-4 text-xs font-bold uppercase tracking-[0.5px] text-soft">Responsibilities</div>
              <div className="cand-kareer-detail-box">
                {activeSelected.responsibilities.length > 0 ? (
                  <ul className="cand-kareer-detail-list">
                    {activeSelected.responsibilities.map((item) => (
                      <li key={`${activeSelected.id}-resp-${item}`}>{item}</li>
                    ))}
                  </ul>
                ) : 'Responsibilities were not separately provided by the employer.'}
              </div>

              <div className="mb-2 mt-4 text-xs font-bold uppercase tracking-[0.5px] text-soft">{buildKareerGuidanceHeading(activeSelected)}</div>
              <div className="cand-kareer-detail-box">
                {buildKareerGuidanceText(activeSelected)}
              </div>

              <div className="mb-2 mt-4 text-xs font-bold uppercase tracking-[0.5px] text-soft">Your Matching Skills</div>
              <div className="cand-skill-row">
                {activeSelected.matchedSkills.length > 0 ? activeSelected.matchedSkills.map((skill) => (
                  <span key={`${activeSelected.id}-m-${skill}`} className="cand-skill-match"><UIIcon name="check-circle" className="cand-chip-icon" />{cleanSkillDisplayName(skill)}</span>
                )) : <span className="cand-covered-empty">Matched skills not detected yet.</span>}
              </div>

              <div className="mb-2 mt-4 text-xs font-bold uppercase tracking-[0.5px] text-soft">Skills to Improve</div>
              <div className="cand-skill-row">
                {activeSelected.missingSkills.length > 0 ? activeSelected.missingSkills.map((skill) => (
                  <span key={`${activeSelected.id}-g-${skill}`} className="cand-skill-miss">{cleanSkillDisplayName(skill)}</span>
                )) : <span className="cand-covered-empty">No specific improvement skills identified yet.</span>}
              </div>

              <div className="mb-2 mt-4 text-xs font-bold uppercase tracking-[0.5px] text-soft">Required Skills</div>
              <div className="cand-skill-row">
                {activeSelected.requiredSkills.length > 0 ? activeSelected.requiredSkills.map((skill) => (
                  <span key={`${activeSelected.id}-req-${skill}`} className="cand-skill-match">{cleanSkillDisplayName(skill)}</span>
                )) : <span className="cand-covered-empty">Required skills are not listed for this role.</span>}
              </div>

              {activeSelected.preferredSkills.length > 0 && (
                <>
                  <div className="mb-2 mt-4 text-xs font-bold uppercase tracking-[0.5px] text-soft">Preferred Skills</div>
                  <div className="cand-skill-row">
                    {activeSelected.preferredSkills.map((skill) => (
                      <span key={`${activeSelected.id}-pref-${skill}`} className="cand-skill-nice">{cleanSkillDisplayName(skill)}</span>
                    ))}
                  </div>
                </>
              )}

              {activeSelected.niceToHaveSkills && activeSelected.niceToHaveSkills.length > 0 && (
                <>
                  <div className="mb-2 mt-4 text-xs font-bold uppercase tracking-[0.5px] text-soft">Nice-to-Have Skills</div>
                  <div className="cand-skill-row">
                    {activeSelected.niceToHaveSkills.map((skill) => (
                      <span key={`${activeSelected.id}-nice-${skill}`} className="cand-skill-nice">{cleanSkillDisplayName(skill)}</span>
                    ))}
                  </div>
                </>
              )}

              <div className="mb-2 mt-4 text-xs font-bold uppercase tracking-[0.5px] text-soft">Recommended Next Step</div>
              <div className="cand-kareer-detail-box">
                {getRecommendedNextStep(activeSelected)}
              </div>

              <div className="mb-2 mt-4 text-xs font-bold uppercase tracking-[0.5px] text-soft">Recommended Learning Resources</div>
              <div className="cand-kareer-detail-box">
                {activeSelected.missingSkills.length > 0
                  ? `Focus on ${cleanSkillDisplayName(activeSelected.missingSkills[0])} first, then explore related learning resources in Kareerly.`
                  : 'Use the recommended learning resources to strengthen your readiness for similar roles over time.'}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button className="cand-btn-secondary" type="button" onClick={onOpenUpskilling}>
                  <UIIcon name="graduation" className="cand-btn-icon" />Explore Learning Recommendations
                </button>
                {activeSelected.sourceType === 'internal' && activeApplication ? (
                  <button className="cand-btn-secondary" type="button" onClick={onOpenApplications}>
                    <UIIcon name="clipboard" className="cand-btn-icon" />View Application
                  </button>
                ) : (
                  <button className="cand-btn-secondary" type="button" onClick={onOpenMatches}>
                    <UIIcon name="briefcase" className="cand-btn-icon" />View Job Matches
                  </button>
                )}
              </div>

              <div className="cand-kareer-footer-note">
                Kareerly provides explainable career guidance. Match scores are advisory and do not prevent candidates from applying. Final hiring decisions remain with the employer.
              </div>
            </>
          ) : (
            <div className="cand-empty">Select a role from the left panel to view details.</div>
          )}
        </div>
      </div>

      {pendingApplyJob && (
        <ConfirmModal
          title="Apply for this position?"
          description="You are about to apply for this Internal Kareerly job. Your current fit analysis will NOT affect your ability to submit this application. The employer will make the final hiring decision."
          onCancel={() => setPendingApplyJob(null)}
          onConfirm={async () => {
            const applied = await onApply(pendingApplyJob.id);
            if (applied) setSubmittedApplyJob(pendingApplyJob);
            setPendingApplyJob(null);
          }}
          confirmLabel="Submit Application"
        />
      )}

      {submittedApplyJob && (
        <ApplicationSubmittedModal
          onClose={() => setSubmittedApplyJob(null)}
          onOpenApplications={() => {
            setSubmittedApplyJob(null);
            onOpenApplications();
          }}
          onContinue={() => setSubmittedApplyJob(null)}
        />
      )}
    </div>
  );
}

function learningResourceUrl(course: DashboardCourse): string | undefined {
  try {
    if (!course.url) return undefined;
    const url = new URL(course.url);
    return ['https:', 'http:'].includes(url.protocol) && url.hostname && !url.username && !url.password && !/\s/.test(course.url) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function LearningEmptyState({
  title,
  description,
  primaryAction,
  secondaryAction,
}: {
  title: string;
  description: string;
  primaryAction?: { label: string; onClick: () => void };
  secondaryAction?: { label: string; onClick: () => void };
}) {
  return (
    <section className="cand-learning-empty" aria-live="polite">
      <h2>{title}</h2>
      <p>{description}</p>
      {(primaryAction || secondaryAction) && (
        <div className="cand-actions cand-learning-empty-actions">
          {primaryAction && <button className="cand-btn-primary cand-btn-sm" type="button" onClick={primaryAction.onClick}>{primaryAction.label}</button>}
          {secondaryAction && <button className="cand-btn-secondary cand-btn-sm" type="button" onClick={secondaryAction.onClick}>{secondaryAction.label}</button>}
        </div>
      )}
    </section>
  );
}

function UpskillingPage({ tab, courses, jobs, gaps, skillProgressRecords, onTab, onOpenSkillGaps, onOpenJobMatches }: {
  tab: UpskillTab;
  courses: DashboardCourse[];
  jobs: DashboardJob[];
  gaps: DashboardGap[];
  skillProgressRecords: Record<string, SkillProgressRecord>;
  onTab: (tab: UpskillTab) => void;
  onOpenSkillGaps: () => void;
  onOpenJobMatches: () => void;
}) {
  const [selectedJobId, setSelectedJobId] = useState(jobs[0]?.id || '');
  const [selectedSkill, setSelectedSkill] = useState('all');
  const jobSelectRef = useRef<HTMLSelectElement>(null);
  const selectedJob = jobs.find((job) => job.id === selectedJobId) || jobs[0];
  const visibleCourses = selectedJob ? getLearningForJob(selectedJob, courses) : [];
  const skillsToDevelop = Array.from(new Set((selectedJob?.missingSkills || []).map(cleanSkillDisplayName).filter(Boolean)));
  const selectedSkillGap = (skill: string) => gaps.find((gap) => normalizeSkill(gap.skill) === normalizeSkill(skill));
  const learningTabOrder: UpskillTab[] = ['recommended', 'by-gap'];
  const handleLearningTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = learningTabOrder.indexOf(tab);
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? learningTabOrder.length - 1
        : (currentIndex + (event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1) + learningTabOrder.length) % learningTabOrder.length;
    const nextTab = learningTabOrder[nextIndex];
    onTab(nextTab);
    window.setTimeout(() => document.getElementById(`learning-tab-${nextTab}`)?.focus(), 0);
  };
  const filteredCourses = selectedSkill === 'all'
    ? visibleCourses
    : visibleCourses.filter((course) => getCourseSkillLabels(course).some((skill) => normalizeSkill(skill) === normalizeSkill(selectedSkill)));
  const groups = skillsToDevelop.map((skill) => ({
    skill,
    gap: selectedSkillGap(skill),
    resources: filteredCourses.filter((course) => getCourseSkillLabels(course).some((mapped) => normalizeSkill(mapped) === normalizeSkill(skill))),
  })).filter((group) => selectedSkill === 'all' || normalizeSkill(group.skill) === normalizeSkill(selectedSkill));

  const focusAnotherJob = () => jobSelectRef.current?.focus();
  const selectedJobHasGaps = Boolean(selectedJob && skillsToDevelop.length > 0);
  const noResourceForSelection = selectedJobHasGaps && filteredCourses.length === 0;

  return (
    <div>
      <div className="cand-page-header">
        <div className="cand-learning-header-row">
          <div>
            <h1 className="cand-page-title">Learning Recommendations</h1>
            <p className="cand-page-subtitle">Explore recommended resources for the skills you want to develop.</p>
          </div>
          <button className="cand-inline-link" type="button" onClick={onOpenSkillGaps}>← View Skill Gaps</button>
        </div>
      </div>

      <section className="cand-learning-toolbar" aria-label="Learning recommendation controls">
        <div className="cand-learning-focus">
          <label id="learning-focus-heading" htmlFor="learning-target-job">Focus job</label>
          <select
            ref={jobSelectRef}
            id="learning-target-job"
            value={selectedJob?.id || ''}
            disabled={jobs.length === 0}
            onChange={(event) => { setSelectedJobId(event.target.value); setSelectedSkill('all'); }}
          >
            {jobs.length === 0 && <option value="">No matched jobs available</option>}
            {jobs.map((job) => <option key={job.id} value={job.id}>{job.title} — {job.company}</option>)}
          </select>
        </div>

        <div className="cand-tab-row cand-gap-view-tabs cand-skill-gap-tabs cand-learning-tabs" role="tablist" aria-label="Learning recommendation views">
          <button
            id="learning-tab-recommended"
            className={`cand-tab-btn ${tab === 'recommended' ? 'active' : ''}`}
            type="button"
            role="tab"
            aria-selected={tab === 'recommended'}
            aria-controls="learning-panel-recommended"
            tabIndex={tab === 'recommended' ? 0 : -1}
            onClick={() => onTab('recommended')}
            onKeyDown={handleLearningTabKeyDown}
          >
            <UIIcon name="book" className="cand-tab-icon" />What to Learn Next
          </button>
          <button
            id="learning-tab-by-gap"
            className={`cand-tab-btn ${tab === 'by-gap' ? 'active' : ''}`}
            type="button"
            role="tab"
            aria-selected={tab === 'by-gap'}
            aria-controls="learning-panel-by-gap"
            tabIndex={tab === 'by-gap' ? 0 : -1}
            onClick={() => onTab('by-gap')}
            onKeyDown={handleLearningTabKeyDown}
          >
            <UIIcon name="list" className="cand-tab-icon" />By Skill Gap
          </button>
        </div>
      </section>

      {selectedJobHasGaps && (
        <section className="cand-learning-skills" aria-labelledby="skills-to-develop-heading">
          <div className="cand-learning-section-heading">
            <h2 id="skills-to-develop-heading">Skills to Develop</h2>
            <span>Areas to work on for this job match.</span>
          </div>
          <div className="cand-learning-skill-list">
            {skillsToDevelop.map((skill) => {
              const gap = selectedSkillGap(skill);
              return (
                <button
                  key={skill}
                  className={`cand-learning-skill-chip ${selectedSkill === skill ? 'active' : ''}`}
                  type="button"
                  onClick={() => setSelectedSkill((current) => current === skill ? 'all' : skill)}
                  aria-pressed={selectedSkill === skill}
                >
                  {gap && <span>{gap.severity} · </span>}{skill}
                </button>
              );
            })}
          </div>
          <div className="cand-learning-filter-row" aria-label="Filter resources by skill">
            <span>Filter resources:</span>
            <button className={`cand-learning-filter ${selectedSkill === 'all' ? 'active' : ''}`} type="button" onClick={() => setSelectedSkill('all')} aria-pressed={selectedSkill === 'all'}>All</button>
            {skillsToDevelop.map((skill) => <button key={`filter-${skill}`} className={`cand-learning-filter ${selectedSkill === skill ? 'active' : ''}`} type="button" onClick={() => setSelectedSkill(skill)} aria-pressed={selectedSkill === skill}>{skill}</button>)}
          </div>
        </section>
      )}

      <div id={tab === 'recommended' ? 'learning-panel-recommended' : 'learning-panel-by-gap'} role="tabpanel" aria-labelledby={`learning-tab-${tab}`} tabIndex={0}>
      {jobs.length === 0 ? (
        <LearningEmptyState
          title="No learning recommendations yet"
          description="Generate job matches first so Kareerly can identify skill gaps and recommend relevant learning resources."
          primaryAction={{ label: 'View Job Matches', onClick: onOpenJobMatches }}
        />
      ) : !selectedJobHasGaps ? (
        <LearningEmptyState
          title="No skills to develop identified"
          description="This job does not currently have prioritized missing skills for your profile."
          primaryAction={{ label: 'Choose Another Job', onClick: focusAnotherJob }}
          secondaryAction={{ label: 'View Skill Gaps', onClick: onOpenSkillGaps }}
        />
      ) : noResourceForSelection ? (
        <LearningEmptyState
          title="No learning resources found for this skill yet"
          description="Try another skill or check again when the learning catalog is updated."
          primaryAction={{ label: 'Show All Skills', onClick: () => setSelectedSkill('all') }}
        />
      ) : tab === 'recommended' ? (
        <section className="cand-learning-results" aria-labelledby="what-to-learn-heading">
          <div className="cand-learning-section-heading">
            <h2 id="what-to-learn-heading">What to Learn Next</h2>
            <span>Suggested resources for your current skill gaps.</span>
          </div>
          <div className="cand-course-grid">
            {filteredCourses.map((course) => <CourseCard key={course.id} course={course} selectedJob={selectedJob} gaps={gaps} skillProgressRecords={skillProgressRecords} />)}
          </div>
          <LearningProviderNote />
        </section>
      ) : (
        <section className="cand-learning-results" aria-labelledby="by-skill-gap-heading">
          <div className="cand-learning-section-heading">
            <h2 id="by-skill-gap-heading">By Skill Gap</h2>
            <span>Suggested options organized around the skills you want to develop.</span>
          </div>
          <div className="cand-learning-gap-groups">
            {groups.map(({ skill, gap, resources }) => (
              <section key={skill} className="cand-learning-gap-group" aria-labelledby={`learning-gap-${normalizeSkill(skill).replace(/[^a-z0-9]+/g, '-')}`}>
                <div className="cand-learning-gap-heading">
                  <div>
                    <h3 id={`learning-gap-${normalizeSkill(skill).replace(/[^a-z0-9]+/g, '-')}`}>{skill}</h3>
                    <div className="cand-learning-gap-meta">
                      {gap && <span className={`cand-gap-priority ${severityClass(gap.severity)}`}>{gap.severity} Priority</span>}
                      <span>{resources.length} recommended resource{resources.length === 1 ? '' : 's'}</span>
                    </div>
                  </div>
                </div>
                {resources.length > 0 ? (
                  <div className="cand-course-grid">{resources.map((course) => <CourseCard key={course.id} course={course} selectedJob={selectedJob} gaps={gaps} skillProgressRecords={skillProgressRecords} />)}</div>
                ) : <p className="cand-learning-no-resource">No learning resources found for this skill yet.</p>}
              </section>
            ))}
          </div>
          <LearningProviderNote />
        </section>
      )}
      </div>
    </div>
  );
}

function LearningProviderNote() {
  return <p className="cand-learning-provider-note"><UIIcon name="external" className="cand-mini-icon" />Resources open on their providers’ websites. Kareerly recommends resources based on identified skill gaps but does not verify enrollment, course completion, assessments, or certificates.</p>;
}

function CourseCard({ course, selectedJob, gaps, skillProgressRecords }: { course: DashboardCourse; selectedJob?: DashboardJob; gaps: DashboardGap[]; skillProgressRecords: Record<string, SkillProgressRecord> }) {
  const url = learningResourceUrl(course);
  const mappedSkills = getCourseSkillLabels(course);
  const primarySkill = mappedSkills[0] || cleanSkillDisplayName(course.gapTag) || 'This skill gap';
  const primaryGap = gaps.find((gap) => mappedSkills.some((skill) => normalizeSkill(skill) === normalizeSkill(gap.skill)));
  const progressRecord = mappedSkills.map((skill) => Object.values(skillProgressRecords).find((record) => normalizeSkill(record.skillName) === normalizeSkill(skill))).find(Boolean);
  const isKnown = (value: string | undefined): value is string => Boolean(value && !/unknown|not stated|not specified/i.test(value));
  const metadata = [course.level, course.deliveryMode, course.duration, course.isFree ? 'Free' : course.fees].filter(isKnown);
  const recommendationReason = primaryGap && selectedJob
    ? `${primarySkill} is a ${primaryGap.severity} gap for your ${selectedJob.title} match.`
    : selectedJob
      ? `${primarySkill} is an identified skill gap for your ${selectedJob.title} match.`
      : `This resource addresses your ${primarySkill} skill gap.`;

  return (
    <div className="cand-course-card">
      <div className="cand-course-top">
        <div className="cand-provider-badge">{course.provider.slice(0, 2).toUpperCase()}</div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-dark">{course.title}</h3>
          <div className="text-xs text-soft">{course.provider}</div>
        </div>
      </div>
      <div className="cand-course-skill-block">
        <div className="cand-course-label">Helps address</div>
        <div className="cand-course-skill-list">{mappedSkills.length > 0 ? mappedSkills.map((skill) => <span key={skill} className="cand-course-gap-tag">{skill}</span>) : <span className="text-xs text-soft">Skill mapping unavailable</span>}</div>
      </div>
      <div className="cand-course-reason"><span className="cand-course-label">Recommended because</span><span className="text-xs text-mid">{recommendationReason}</span></div>
      {metadata.length > 0 && <div className="cand-course-meta">{metadata.map((item) => <span key={item}>{item}</span>)}</div>}
      {progressRecord && <span className="cand-learning-status">{getProgressStatusLabel(progressRecord.status)}</span>}
      <div className="cand-course-actions">
        {url ? (
          <a className="cand-btn-primary cand-btn-sm" href={url} target="_blank" rel="noopener noreferrer" aria-label={`${course.urlLabel}: ${course.title} (opens in a new tab)`}>
            View Resource<UIIcon name="external" className="cand-btn-icon" />
          </a>
        ) : <span className="text-xs text-soft">Provider link unavailable</span>}
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
                <button className="cand-msg-send" type="button" disabled={!canReply} onClick={onSend} aria-label="Send message" title="Send message">
                  <UIIcon name="paper-plane" />
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
  application,
  courses,
  isSaved,
  onClose,
  onApply,
  onWithdraw,
  onSave,
}: {
  job: DashboardJob;
  application: DashboardApplication | null;
  courses: DashboardCourse[];
  isSaved: boolean;
  onClose: () => void;
  onApply: () => void | Promise<void>;
  onWithdraw: (application: DashboardApplication) => void;
  onSave: () => void;
}) {
  const canWithdraw = application && ['Pending', 'Shortlisted', 'Interviewing'].includes(application.status);
  const learningResources = getLearningForJob(job, courses);
  const confidence = getConfidenceLabel(job);
  const requiredSkills = job.requiredSkills.length > 0 ? job.requiredSkills : [...job.matchedSkills, ...job.missingSkills];
  const preferredSkills = job.preferredSkills.length > 0 ? job.preferredSkills : job.niceToHaveSkills || [];
  const matchReasons = buildMatchReasons(job, requiredSkills);
  const matchedKeys = new Set(job.matchedSkills.map(normalizeSkill));
  const score = job.hasMatchScore ? Math.max(0, Math.min(100, Math.round(job.matchScore))) : 0;
  const readinessClass = job.hasMatchScore ? getMatchReadinessClass(job.matchScore) : 'develop';
  const details = [
    { label: 'Level', value: job.jobLevel },
    { label: 'Employment', value: job.employmentType },
    { label: 'Work Setup', value: job.setup },
    { label: 'Location', value: job.location },
    { label: 'Salary', value: job.salary },
    { label: 'Category', value: job.category },
  ].filter((item) => item.value && item.value.trim() && item.value !== '—');

  return (
    <div className="cand-modal-overlay" onClick={onClose}>
      <div className="cand-modal-box lg cand-jd" onClick={(event) => event.stopPropagation()}>
        <div className="cand-modal-header cand-jd-header">
          <div>
            <div className="cand-modal-title">{job.title}</div>
            <div className="cand-modal-subtitle">{job.company}</div>
            <div className="cand-jd-tags">
              <span className={`cand-match-cat ${job.matchCategory === 'fit-now' ? 'cand-cat-fit' : 'cand-cat-aspiration'}`}>
                {job.hasMatchScore ? (job.matchCategory === 'fit-now' ? 'Fit Now' : 'Aspiration') : 'Match not available'}
              </span>
              <span className={`cand-type-tag ${job.sourceType === 'internal' ? 'cand-type-internal' : 'cand-type-external'}`}>
                {job.sourceType === 'internal' ? 'Internal' : 'External'}
              </span>
            </div>
          </div>
          <button className="cand-modal-close cand-jd-close" type="button" onClick={onClose} aria-label="Close job details">
            <UIIcon name="close" />
          </button>
        </div>

        <section className={`cand-jd-why ${readinessClass}`} aria-labelledby={`${job.id}-why-title`}>
          <div className="cand-jd-why-top">
            <div className="cand-jd-score" style={{ ['--score' as string]: `${score}` }} aria-hidden="true">
              <span>{job.hasMatchScore ? `${score}%` : '—'}</span>
            </div>
            <div className="min-w-0">
              <h3 id={`${job.id}-why-title`} className="cand-jd-why-title">Why this job matches you</h3>
              <div className="cand-jd-why-meta">
                {getMatchBadgeLabel(job)} · Confidence: {confidence}
              </div>
            </div>
          </div>
          <p className="cand-jd-why-summary">{job.explanation?.trim() || buildJobExplanation(job)}</p>
          {matchReasons.length > 0 && (
            <ul className="cand-jd-reasons">
              {matchReasons.map((reason) => (
                <li key={`${job.id}-reason-${reason.text}`} className={reason.tone}>
                  <UIIcon name={reason.tone === 'strength' ? 'check-circle' : 'target'} className="cand-jd-reason-icon" />
                  <span>{reason.text}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {details.length > 0 && (
          <dl className="cand-jd-details">
            {details.map((item) => (
              <div key={`${job.id}-detail-${item.label}`}>
                <dt>{item.label}</dt>
                <dd>{item.value?.replace(/\//g, '/\u200b')}</dd>
              </div>
            ))}
          </dl>
        )}

        <section className="cand-jd-section">
          <h4 className="cand-jd-heading">Job Description</h4>
          <div className="cand-jd-text whitespace-pre-wrap">
            {job.description?.trim() ? formatJobDescription(job.description) : 'Full job description is not available yet for this listing, but you can still explore the role details and personalized guidance below.'}
          </div>
        </section>

        <section className="cand-jd-section">
          <h4 className="cand-jd-heading">Responsibilities</h4>
          {job.responsibilities.length > 0 ? (
            <ul className="cand-bullet-list cand-jd-text">
              {job.responsibilities.map((item) => (
                <li key={`${job.id}-resp-${item}`}>{item}</li>
              ))}
            </ul>
          ) : (
            <div className="cand-jd-empty">Responsibilities have not yet been provided by the employer.</div>
          )}
        </section>

        <section className="cand-jd-section">
          <h4 className="cand-jd-heading">Your Matching Strengths</h4>
          <div className="cand-skill-row">
            {job.matchedSkills.map((skill) => (
              <span key={`${job.id}-jd-m-${skill}`} className="cand-skill-match">
                <UIIcon name="check-circle" className="cand-chip-icon" />
                {cleanSkillDisplayName(skill)}
              </span>
            ))}
            {job.matchedSkills.length === 0 && <span className="cand-jd-empty">Matched skills not detected yet.</span>}
          </div>
        </section>

        <section className="cand-jd-section">
          <h4 className="cand-jd-heading">Skills for This Role</h4>
          <div className="cand-jd-sublabel">Required</div>
          <div className="cand-skill-row">
            {requiredSkills.length > 0 ? requiredSkills.map((skill) => (
              <span key={`${job.id}-req-${skill}`} className={matchedKeys.has(normalizeSkill(skill)) ? 'cand-skill-match' : 'cand-jd-chip'}>{cleanSkillDisplayName(skill)}</span>
            )) : <span className="cand-jd-empty">Required skills have not yet been provided by the employer.</span>}
          </div>
          <div className="cand-jd-sublabel">Preferred</div>
          <div className="cand-skill-row">
            {preferredSkills.length > 0 ? preferredSkills.map((skill) => (
              <span key={`${job.id}-pref-${skill}`} className="cand-skill-nice">{cleanSkillDisplayName(skill)}</span>
            )) : <span className="cand-jd-empty">Preferred skills have not yet been provided by the employer.</span>}
          </div>
        </section>

        <section className="cand-jd-section">
          <h4 className="cand-jd-heading">Skills to Improve</h4>
          <div className="cand-skill-row">
            {job.missingSkills.slice(0, 8).map((skill, index) => (
              <span key={`${job.id}-jd-g-${skill}`} className="cand-skill-miss">
                {index === 0 ? 'Critical: ' : index <= 2 ? 'High: ' : 'Medium: '}
                {cleanSkillDisplayName(skill)}
              </span>
            ))}
            {job.missingSkills.length === 0 && <span className="cand-jd-empty">No major missing skills detected for this role.</span>}
          </div>
        </section>

        <section className="cand-jd-section">
          <h4 className="cand-jd-heading">Recommended Learning</h4>
          {learningResources.length > 0 ? (
            learningResources.map((course) => (
              <div key={`${job.id}-learn-${course.id}`} className="cand-jd-course">
                <UIIcon name="graduation" className="cand-inline-info-icon" />
                <div>
                  <strong>{course.title}</strong>
                  <div className="text-xs text-mid">
                    {course.provider} · {course.level} · {course.duration} · {course.fees} ·{' '}
                    <span className={grantsCredential(course.credentialType) ? 'cand-credential-yes' : 'cand-credential-no'}>{course.credentialLabel}</span>
                  </div>
                  <div className="text-xs text-mid">This learning resource supports {cleanSkillDisplayName(course.gapTag)}, one of the skills connected to this role.</div>
                  {learningResourceUrl(course) ? (
                    <a className="cand-btn-secondary cand-btn-sm mt-2" href={learningResourceUrl(course)} target="_blank" rel="noopener noreferrer" aria-label={`${course.urlLabel}: ${course.title} (opens in a new tab)`}>{course.urlLabel}</a>
                  ) : <span className="text-xs text-soft">Provider link unavailable</span>}
                  <p className="text-xs text-soft">The provider manages learning and certificates. Kareerly does not verify completion; opening this resource does not change skills, readiness, or match scores.</p>
                </div>
              </div>
            ))
          ) : (
            <div className="cand-jd-empty">No learning resources are available yet for this role's current skill gaps.</div>
          )}
        </section>

        <section className="cand-jd-section">
          <h4 className="cand-jd-heading">Career Guidance</h4>
          <div className="cand-explain cand-jd-guidance"><UIIcon name="lightbulb" className="cand-inline-info-icon" />{getCareerGuidance(job)}</div>
        </section>

        {job.sourceType === 'internal' ? (
          <div className="cand-modal-actions cand-jd-actions">
            {application ? (
              <>
                <button className="cand-btn-primary" type="button" disabled>
                  Applied ✓
                </button>
                {canWithdraw && (
                  <button className="cand-btn-secondary" type="button" onClick={() => onWithdraw(application)}>
                    Withdraw Application
                  </button>
                )}
              </>
            ) : (
              <button className="cand-btn-primary" type="button" onClick={onApply}>
                <UIIcon name="paper-plane" className="cand-btn-icon" />Apply Now
              </button>
            )}
            <button className="cand-btn-secondary" type="button" onClick={onSave}>
              <UIIcon name="bookmark" className="cand-btn-icon" />{isSaved ? 'Saved' : 'Save Job'}
            </button>
            <button className="cand-btn-secondary" type="button" onClick={onClose}>
              Back to Matches
            </button>
          </div>
        ) : (
          <>
            <div className="cand-notice warn">
              <span>This is an external opportunity. In-platform application tracking, withdrawal, and messaging are not available.</span>
            </div>
            <div className="cand-modal-actions cand-jd-actions">
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
              <button className="cand-btn-secondary" type="button" onClick={onClose}>
                Back to Matches
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
  actionError,
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
  actionError: string;
  onClose: () => void;
  onDragOver: (value: boolean) => void;
  onPickFile: (file: File | null) => void;
  onProcess: () => void;
  onBack: () => void;
  onReviewPreferencesPath: () => void;
  onSkip: () => void;
  onConfirm: () => void | Promise<void>;
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
          <button className="cand-modal-close" type="button" onClick={onClose} aria-label="Close update resume">
            <FontAwesomeIcon icon={faXmark} aria-hidden="true" />
          </button>
        </div>

        {actionError && <div className="cand-resume-action-error" role="alert">{actionError}</div>}

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
              <div className="text-xs text-soft">PDF or DOCX · max 5MB</div>
            </label>

            {file && (
              <div className="cand-upload-file">
                <span className="text-2xl flex-shrink-0">
                  <FontAwesomeIcon icon={faFileLines} aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  {/* Long unbroken file names must wrap inside the modal instead of overflowing it. */}
                  <div className="text-sm font-bold [overflow-wrap:anywhere]">{file.name}</div>
                  <div className="text-xs mt-0.5">{formatFileSize(file.size)} · Ready for analysis</div>
                </div>
                <button
                  className="text-soft hover:text-red transition-colors text-xl px-1 flex-shrink-0"
                  type="button"
                  onClick={() => onPickFile(null)}
                  title="Remove"
                  aria-label="Remove resume"
                >
                  <FontAwesomeIcon icon={faXmark} aria-hidden="true" />
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
              <span>Review your skills and preferences, or apply the resume to your dashboard now.</span>
            </div>
            <div className="cand-modal-actions cand-resume-decision-actions">
              <button className="cand-btn-primary" type="button" disabled={loading} onClick={onReviewPreferencesPath}>
                <FontAwesomeIcon icon={faCircleCheck} aria-hidden="true" />
                <span>{loading ? 'Saving...' : 'Skills & Preferences'}</span>
              </button>
              <button className="cand-btn-secondary" type="button" disabled={loading} onClick={onSkip}>
                <FontAwesomeIcon icon={faForward} aria-hidden="true" />
                <span>{loading ? 'Applying...' : 'Skip & Apply'}</span>
              </button>
              <button className="cand-btn-secondary cand-resume-back-btn" type="button" disabled={loading} onClick={onBack} aria-label="Back to upload" title="Back to upload">
                <FontAwesomeIcon icon={faArrowLeft} aria-hidden="true" />
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
              <button className="cand-btn-secondary cand-modal-back" type="button" onClick={() => onBack()}>
                Back
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function EvidenceFormModal({
  loading,
  record,
  onClose,
  onSave,
}: {
  loading: boolean;
  record: EvidenceUploadRecord | null;
  onClose: () => void;
  onSave: (draft: {
    id?: string;
    title: string;
    evidenceType: EvidenceType;
    relatedSkill: string;
    category: string;
    notes?: string;
    file: File | null;
  }) => void;
}) {
  const [title, setTitle] = useState(record?.title || '');
  const [evidenceType, setEvidenceType] = useState<EvidenceType>(record?.evidenceType || 'Certificate');
  const [relatedSkill, setRelatedSkill] = useState(record?.relatedSkill || '');
  const [category, setCategory] = useState(record?.category || '');
  const [notes, setNotes] = useState(record?.notes || '');
  const [file, setFile] = useState<File | null>(null);

  return (
    <div className="cand-modal-overlay" onClick={onClose}>
      <div className="cand-modal-box lg" onClick={(event) => event.stopPropagation()}>
        <div className="cand-modal-header">
          <div>
            <div className="cand-modal-title">{record ? 'Replace Evidence' : 'Upload Evidence'}</div>
            <div className="cand-modal-subtitle">Pending verification is retained for new or replaced uploads.</div>
          </div>
          <button className="cand-modal-close" type="button" onClick={onClose}>
            x
          </button>
        </div>

        <div className="cand-form-grid">
          <FormField label="Evidence Title">
            <input className="cand-form-input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Enter evidence title" />
          </FormField>
          <FormField label="Evidence Type">
            <select className="cand-form-select" value={evidenceType} onChange={(event) => setEvidenceType(event.target.value as EvidenceType)}>
              {['Certificate', 'Course Completion', 'Portfolio', 'Project', 'Training', 'Other'].map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </FormField>
          <FormField label="Related Skill">
            <input className="cand-form-input" value={relatedSkill} onChange={(event) => setRelatedSkill(event.target.value)} placeholder="Enter related skill" />
          </FormField>
          <FormField label="Skill Category">
            <input className="cand-form-input" value={category} onChange={(event) => setCategory(event.target.value)} placeholder="Enter skill category" />
          </FormField>
        </div>

        <FormField label="PDF Upload">
          <label className="cand-evidence-upload">
            <UIIcon name="upload" className="cand-upload-inline-icon" />
            <span>{file?.name || record?.fileName || 'Choose PDF evidence file'}</span>
            <input
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={(event) => setFile(event.target.files?.[0] || null)}
            />
          </label>
        </FormField>

        <FormField label="Optional Notes">
          <textarea className="cand-form-textarea" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Add context for verification or skill relevance" />
        </FormField>

        <div className="cand-notice info">
          <span>PDF only. Uploaded evidence remains pending verification until independently reviewed.</span>
        </div>

        <div className="cand-modal-actions">
          <button
            className="cand-btn-primary"
            type="button"
            disabled={loading || !title.trim() || !relatedSkill.trim() || !category.trim()}
            onClick={() => onSave({
              id: record?.id,
              title,
              evidenceType,
              relatedSkill,
              category,
              notes,
              file,
            })}
          >
            {loading ? 'Saving...' : record ? 'Replace Evidence' : 'Upload Evidence'}
          </button>
          <button className="cand-btn-secondary" type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function ApplicationSubmittedModal({
  onClose,
  onOpenApplications,
  onContinue,
}: {
  onClose: () => void;
  onOpenApplications: () => void;
  onContinue: () => void;
}) {
  return (
    <div className="cand-modal-overlay" onClick={onClose}>
      <div className="cand-modal-box" onClick={(event) => event.stopPropagation()}>
        <div className="cand-modal-header">
          <div>
            <div className="cand-modal-title">Application Submitted</div>
            <div className="cand-modal-subtitle">Your application has been sent successfully.</div>
          </div>
          <button className="cand-modal-close" type="button" onClick={onClose}>
            x
          </button>
        </div>
        <div className="cand-notice info">
          <span>You can track its progress from the Applications page.</span>
        </div>
        <div className="cand-modal-actions">
          <button className="cand-btn-primary" type="button" onClick={onOpenApplications}>
            Go to Applications
          </button>
          <button className="cand-btn-secondary" type="button" onClick={onContinue}>
            Continue Browsing Jobs
          </button>
        </div>
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

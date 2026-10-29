import { savedMatchScore } from '../../lib/uiData';
import type { EvidenceUploadRecord } from '../../lib/evidence';
import { analyzeResume, removeMatchFeedback, saveMatchFeedback, type AvailableJobItem } from '../../lib/api';
import type { MatchVote } from '../../lib/matchFeedback';
import { cleanSkillLabel } from '../../lib/skillLabels';
import { normalizeCareerAreaValue } from '../../lib/careerAreas';
import { supabase } from '../../lib/supabase';
import { loadLatestResume } from '../../lib/userData';
import type { LearningRecommendation as RunLearningRecommendation, CredentialType, CourseRecommendation, JobMatch, MatchResultItem, ParsedResume, PrioritizedSkillGap, SkillGap, SurveyAnswers } from '../../types';
import { extractMatchPercent, extractSkillGapMatchCount, extractSkillGapMatchPercent, parseNumericValue } from '../../lib/matchScoring';
import { normalizeLocationScope } from '../../lib/regionPreference';

export type DashboardPage =
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

export type MatchView = 'fit-now' | 'aspiration' | 'saved';

export type UpskillTab = 'recommended' | 'by-gap';

export type ToastType = '' | 'success' | 'warn' | 'danger';

export type ApplicationStatus = 'Pending' | 'Shortlisted' | 'Interviewing' | 'Hired' | 'Rejected' | 'Withdrawn';

export type MessageRequestState = 'Pending' | 'Accepted' | 'Declined' | 'Ignored';

export type SeverityLevel = 'Critical' | 'High' | 'Moderate';

export type UiLanguage = 'en' | 'fil';

export const FILIPINO_UI: Record<string, string> = {
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
  Region: 'Rehiyon', Province: 'Lalawigan', 'City or municipality': 'Lungsod o munisipalidad',
  'Up to 11 digits, e.g. 09123456789.': 'Hanggang 11 numero, hal. 09123456789.',
  'Select a region': 'Pumili ng rehiyon', 'Select a province': 'Pumili ng lalawigan', 'Choose a region first': 'Pumili muna ng rehiyon',
  'Select a city or municipality': 'Pumili ng lungsod o munisipalidad', 'Choose a province first': 'Pumili muna ng lalawigan',
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
  'Upload Evidence': 'Mag-upload ng Katibayan', View: 'Tingnan', Replace: 'Palitan', Edit: 'I-edit', Delete: 'Tanggalin',
  'Delete Profile': 'Tanggalin ang Profile',
  'Update resume': 'I-update ang resume', 'Upload proof': 'Mag-upload ng katibayan', 'Personal details': 'Personal na detalye',
  'Password and security': 'Password at seguridad', 'Delete profile': 'Tanggalin ang profile', 'Request deletion': 'Humiling na tanggalin',
  'Certificates and proof': 'Mga sertipiko at katibayan', 'Save changes': 'I-save ang mga pagbabago', 'Change password': 'Palitan ang password',
  Home: 'Home', Matches: 'Mga Tugma', Skills: 'Mga Kasanayan', 'Profile & resume': 'Profile at resume', 'Request Profile Deletion': 'Humiling na Tanggalin ang Profile',
};

export function tr(language: UiLanguage, english: string): string {
  return language === 'fil' ? FILIPINO_UI[english] || english : english;
}

export type SkillCategory = 'Core Office Tools' | 'Programming & Scripting' | 'Statistical Analysis' | 'Data Visualization' | 'Data Engineering' | 'Other';

export type DashboardJob = {
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
  /** Shown when no job passes Fit-Now; listed with Aspiration but labelled Closest Match, never Fit-Now. */
  closestMatch?: boolean;
  /** Listed as Fit-Now because no job passes every Fit-Now rule: the job closest to the resume. */
  closestFitNow?: boolean;
  /** Preferences the job does not fit, e.g. work setup "On-site" when the candidate chose "Hybrid". */
  preferenceMismatches?: PreferenceMismatch[];
  sourceType: 'internal' | 'external';
  requiredSkills: string[];
  preferredSkills: string[];
  responsibilities: string[];
  /** Education, licences or experience the employer asks for, one per item. */
  qualifications?: string[];
  description?: string;
  matchedSkills: string[];
  missingSkills: string[];
  missingSkillIds?: string[];
  /** Nice-to-have skills the resume does not show; gaps worth learning, never required. */
  missingPreferredSkills?: string[];
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
  // Position in the backend's Fit-Now or Aspiration list (1 = first).
  rankPosition?: number;
};

export const TOP_MATCHES_PER_CATEGORY = 10;

// Within a list, keep the backend's order: Aspiration follows preference
// alignment, and an active feedback model may adjust either list. Results saved
// before rank positions existed keep the order they arrive in.
export function orderByBackendRank(jobs: DashboardJob[]): DashboardJob[] {
  if (!jobs.length || !jobs.every((job) => typeof job.rankPosition === 'number')) return jobs;
  return jobs.slice().sort((a, b) => (a.rankPosition as number) - (b.rankPosition as number));
}

export type DashboardGap = {
  skill: string;
  /** Only set by the older report gap list; the Skills page uses tiers (skillGaps.ts). */
  severity?: SeverityLevel;
  affectedCount: number | null;
  affectedPercent?: number;
  priorityScore?: number;
  categoryName?: string;
  requirementImportance?: string;
  /** Only preferred (nice-to-have) in the returned jobs, never required. */
  optional?: boolean;
  learningResourceAvailable?: boolean;
  category: SkillCategory;
  relatedJobs: string[];
  topResources?: DashboardCourse[];
  skillId?: string;
};

export type DashboardCourse = {
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
  /** Catalogue career area, e.g. "Office Administration and Records". */
  categoryName?: string;
  /** Listable: has a title and a skill mapping, so it can be shown for a gap. */
  reviewed: boolean;
  /** Passed the catalog review (reviewer, evidence, verified date). */
  verified: boolean;
  recommendationNote?: string;
  /** Per job ID, the reason for that job's gap; preferred over recommendationNote when a job is selected. */
  recommendationNoteByJob?: Record<string, string>;
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

export type CourseCompletion = {
  status: 'completed' | 'evidenced';
  markedAt: string;
  evidenceId?: string;
};

export type EvidencePrefill = Pick<EvidenceUploadRecord, 'title' | 'evidenceType' | 'relatedSkill' | 'category'>;

export type SkillProgressStatus = 'missing' | 'started' | 'in_progress' | 'completed' | 'evidenced' | 'covered';

export type SkillProgressRecord = {
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

/** A gap skill the candidate says they already have (self-reported, not verified). */
export type ClaimedSkill = {
  skillId?: string;
  skillName: string;
  claimedAt: string;
};

/** One key per skill, shared by skill progress and claimed skills. */
export function skillRecordKey(skill: { skillId?: string | null; skill: string }): string {
  return (skill.skillId || normalizeSkill(skill.skill)).toUpperCase();
}

/** True when the candidate marked this skill as one they already have. */
export function isClaimedSkill(claimed: Record<string, ClaimedSkill>, skill: { skillId?: string | null; skill: string }): boolean {
  if (claimed[skillRecordKey(skill)]) return true;
  const name = normalizeSkill(skill.skill);
  return Object.values(claimed).some((item) => normalizeSkill(item.skillName) === name);
}

/** Shown wherever a skill is self-reported or a course is finished without proof. */
export const EMPLOYER_CHECK_REMINDER = 'Employers may still check this skill with a short test, a task, or by asking for samples of past work, so keep an example ready.';

export type DashboardApplication = {
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

export type JobApplicationRow = {
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

export const SKILL_PROGRESS_PERCENT: Record<SkillProgressStatus, number> = {
  missing: 0,
  started: 10,
  in_progress: 35,
  completed: 70,
  evidenced: 90,
  covered: 100,
};

// Skill Development Progress Labels (thesis table): the label for a 0-100 score.
// The paper lists four ranges up to 75%; 76-100% is labelled "Skill Covered".
export function skillProgressLabel(percent: number): string {
  if (percent <= 0) return 'Not Started / Missing';
  if (percent <= 25) return 'Foundation Progress';
  if (percent <= 50) return 'Intermediate Progress';
  if (percent <= 75) return 'Advanced Progress';
  return 'Skill Covered';
}

export type ResumeAnalyzeResponse = Awaited<ReturnType<typeof analyzeResume>>;

export const defaultSurveyAnswers: SurveyAnswers = {
  industry: '',
  role: '',
  setup: '',
  salary: '',
  skill: '',
  locationScope: 'anywhere',
  region: '',
};

export const employmentTypeLabels: Record<string, string> = {
  'full-time': 'Full-time',
  'part-time': 'Part-time',
  contract: 'Contract',
  temporary: 'Temporary',
  internship: 'Internship',
  any: 'No preference',
};

export const setupLabels: Record<string, string> = {
  remote: '100% Work from Home',
  hybrid: 'Hybrid',
  onsite: 'On-site',
  flexible: 'Flexible - no preference',
};

export const salaryLabels: Record<string, string> = {
  '15-35': 'PHP 15,000 - PHP 35,000/month',
  '35-50': 'PHP 35,001 - PHP 50,000/month',
  '50+': 'PHP 50,001 - more',
  unsure: "I'm not sure",
};

// Ranges offered before; still labelled for saved answers but no longer selectable.
export const legacySalaryLabels: Record<string, string> = {
  entry: 'Entry level',
  '20-30': 'PHP 20,000 - PHP 30,000/month',
  '30-50': 'PHP 30,000 - PHP 50,000/month',
  '50-80': 'PHP 50,000 - PHP 80,000/month',
  '80+': 'PHP 80,000+/month',
  '25000-40000': 'PHP 25,000 - PHP 40,000/month',
  '40000-60000': 'PHP 40,000 - PHP 60,000/month',
  '60000+': 'PHP 60,000+/month',
};

export function normalizeSkill(value: string): string {
  return cleanSkillDisplayName(value).toLowerCase().replace(/\s*\([^)]*\)/g, '').trim();
}

export const PRESERVED_ACRONYMS = new Set(['SQL', 'HTML', 'CSS', 'CRM', 'API', 'UI', 'UX', 'HR', 'QA', 'SEO', 'AWS', 'PHP', 'BI', 'ETL', 'PDF']);

export const PLACEHOLDER_VALUE_PATTERN = /^(?:(?:location|work setup|salary|date|credential)\s+)?(?:not specified|not stated|not available|unknown|n\/a|none|—|-)$/i;

// Shows a compact hyphen instead of wordy placeholders like "Not specified".
export function displayOrDash(value?: string | null): string {
  const trimmed = (value || '').trim();
  return !trimmed || PLACEHOLDER_VALUE_PATTERN.test(trimmed) ? '-' : trimmed;
}

export function titleCase(value: string): string {
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

export function cleanSkillDisplayName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';

  const withoutPrefix = trimmed.replace(/^SK[_-]?/i, '');
  const normalized = withoutPrefix.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return titleCase(normalized);
}

export function cleanSkillList(skills: string[]): string[] {
  return skills.map(cleanSkillDisplayName).filter(Boolean);
}

export function extractStringList(value: unknown): string[] {
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

/** Items kept whole, one per line: qualifications often contain commas. */
export function extractLineList(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => extractLineList(item));
  if (typeof value === 'string') return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  return [];
}

export function getMatchReadinessLabel(score: number): string {
  if (score >= 90) return 'Excellent Match';
  if (score >= 80) return 'Strong Match';
  if (score >= 60) return 'Good Match';
  if (score >= 40) return 'Growth Match';
  if (score >= 1) return 'Partial Match';
  return 'Match pending';
}

export function getMatchBadgeLabel(job: DashboardJob): string {
  if (!job.hasMatchScore) return 'Match not available';
  const score = job.hasMatchScore ? Math.max(0, Math.min(100, Math.round(job.matchScore))) : 0;
  return `${score}% · ${getMatchReadinessLabel(score)}`;
}

export function getConfidenceLabel(job: DashboardJob): string {
  return job.confidence || 'Not available';
}

export function buildJobExplanation(job: DashboardJob): string {
  if (!job.hasMatchScore) return 'Run matching with your current profile to see your alignment with this role.';
  // Prefer the backend's explanation, which cites the resume evidence.
  if (job.explanation?.trim()) return job.explanation.trim();
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

export function hasDisplayValue(value?: string | null): boolean {
  return displayOrDash(value) !== '-';
}

export function splitSkillList(skills: string[]): string[] {
  const seen = new Set<string>();
  return skills
    .flatMap((skill) => skill.split(/[;|\n]+/))
    .map(cleanSkillDisplayName)
    .filter((skill) => {
      const key = skill.toLowerCase();
      if (!skill || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function getCareerGuidance(job: DashboardJob): string {
  if (!job.hasMatchScore) return 'Run matching with your current profile to generate career guidance for this role.';
  if (job.matchScore >= 80 && job.missingSkills.length <= 2) return 'Your skills already cover most of what this role asks for.';
  if (job.missingSkills.length > 0 && job.missingSkills.length <= 3) return `This role is achievable after improving ${job.missingSkills.length === 1 ? 'one key skill' : `${job.missingSkills.length} key skills`}.`;
  if (job.missingSkills.length > 0) return `Consider exploring resources for ${cleanSkillDisplayName(job.missingSkills[0])} before applying.`;
  return 'You can apply now while continuing to strengthen your profile over time.';
}

export type MatchReason = { tone: 'strength' | 'growth'; text: string };

export function formatSkillList(skills: string[]): string {
  const names = skills.map(cleanSkillDisplayName).filter(Boolean);
  if (names.length <= 1) return names[0] || '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

export function buildMatchReasons(job: DashboardJob, requiredSkills: string[]): MatchReason[] {
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

export function getLearningForJob(job: DashboardJob, courses: DashboardCourse[]): DashboardCourse[] {
  // Custom employer skills have no taxonomy ID, so match by ID or by name.
  const missingIds = new Set((job.missingSkillIds || []).map((id) => id.toUpperCase()));
  const missingNames = new Set([...job.missingSkills, ...(job.missingPreferredSkills || [])].map(normalizeSkill).filter(Boolean));
  return courses
    .filter((course) => course.reviewed && (
      course.mappedSkillIds.some((id) => missingIds.has(id.toUpperCase()))
      || course.mappedSkills.some((skill) => missingNames.has(normalizeSkill(skill)))
    ))
    .sort((a, b) => Number(b.verified) - Number(a.verified));
}

export function getCourseSkillLabels(course: DashboardCourse): string[] {
  const rawSkills = course.mappedSkills.length > 0
    ? course.mappedSkills
    : course.gapTag.split(',').map((skill) => skill.trim()).filter(Boolean);
  return Array.from(new Set(rawSkills.map(cleanSkillDisplayName).filter(Boolean)));
}

export function formatGapMissingCount(gap: DashboardGap): string {
  if (gap.affectedCount === null) return 'Affected match count unavailable';
  return `Missing in ${gap.affectedCount} match${gap.affectedCount === 1 ? '' : 'es'}`;
}

export function getInitials(name: string, email: string): string {
  const source = name.trim() || email.split('@')[0] || 'User';
  const words = source.split(/[\s._-]+/).filter(Boolean);
  return (words.slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || 'U').slice(0, 2);
}

export function formatDateLabel(value: string): string {
  const parsed = new Date(value);
  if (!value || Number.isNaN(parsed.getTime())) return 'Date unavailable';
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function getSkillLabel(skill: unknown): string {
  if (typeof skill === 'string') return cleanSkillLabel(skill);
  if (skill && typeof skill === 'object') {
    const record = skill as Record<string, unknown>;
    const label = record.name || record.skill_name || record.title || record.message;
    if (typeof label === 'string') return cleanSkillLabel(label);
  }
  return '';
}

export function extractSkillsFromResume(resume: ParsedResume | null | undefined): string[] {
  return (resume?.skills || []).map(getSkillLabel).filter(Boolean);
}

export function extractResumeText(resume: ParsedResume | null | undefined): string {
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

export function classifySkillCategory(skill: string): SkillCategory {
  const value = normalizeSkill(skill);
  if (/(excel|word|powerpoint|google sheets|google workspace|docs|slides|office|canva)/.test(value)) return 'Core Office Tools';
  if (/(python|sql|javascript|typescript|java|c\+\+|react|node|api|git|linux|pandas|numpy|programming)/.test(value)) return 'Programming & Scripting';
  if (/(statistics|spss|r language|regression|hypothesis|analytics)/.test(value)) return 'Statistical Analysis';
  if (/(power bi|tableau|visualization|dashboard|dax)/.test(value)) return 'Data Visualization';
  if (/(azure|dbt|spark|pipeline|warehouse|airflow|engineering)/.test(value)) return 'Data Engineering';
  return 'Other';
}

// The skill category stored with an evidence upload: the matching gap's
// taxonomy category, else the course's category, else a keyword guess.
export function deriveEvidenceCategory(relatedSkill: string, gaps: DashboardGap[], course?: DashboardCourse | null): string {
  const skills = relatedSkill.split(',').map(normalizeSkill).filter(Boolean);
  const gap = gaps.find((item) => skills.includes(normalizeSkill(item.skill)));
  const fromGap = gap?.categoryName?.trim() || (gap && gap.category !== 'Other' ? gap.category : '');
  return fromGap || course?.categoryName?.trim() || classifySkillCategory(skills[0] || '');
}

export const SKILL_STATUS_LABEL: Record<SkillProgressStatus, string> = {
  missing: 'Not started',
  started: 'Started',
  in_progress: 'In progress',
  completed: 'Done',
  evidenced: 'Done · proof added',
  covered: 'Covered',
};

export function skillNextStep(status: SkillProgressStatus, skill: string): string {
  if (status === 'missing') return 'Set to In progress when you start.';
  if (status === 'started' || status === 'in_progress') return 'Set to Done when you finish.';
  if (status === 'completed') return 'Proof is optional.';
  if (status === 'evidenced') return 'Proof added, pending review.';
  return `${skill} no longer appears as a gap in your current matches.`;
}

export function mapSeverity(value: string): SeverityLevel {
  const normalized = value.toLowerCase();
  if (normalized.includes('critical')) return 'Critical';
  if (normalized.includes('high')) return 'High';
  return 'Moderate';
}

export function severityPriority(value: SeverityLevel): number {
  if (value === 'Critical') return 0;
  if (value === 'High') return 1;
  return 2;
}

export function withMatchVote(current: Record<string, MatchVote>, key: string, vote: MatchVote | null): Record<string, MatchVote> {
  if (vote) return { ...current, [key]: vote };
  return Object.fromEntries(Object.entries(current).filter(([entryKey]) => entryKey !== key));
}

export function persistMatchVote(job: DashboardJob, vote: MatchVote | null): Promise<unknown> {
  return vote
    ? saveMatchFeedback({
      jobId: job.id, jobSource: job.jobSource, vote,
      matchCategory: job.matchCategory,
      matchScore: job.hasMatchScore ? Math.max(0, Math.min(1, job.matchScore / 100)) : undefined,
    })
    : removeMatchFeedback({ jobId: job.id, jobSource: job.jobSource });
}

export function matchCategoryBadge(job: Pick<DashboardJob, 'matchCategory' | 'closestMatch' | 'closestFitNow'>, fitNowLabel = 'Fit Now'): string {
  if (job.matchCategory === 'fit-now') return job.closestFitNow ? 'Closest Fit' : fitNowLabel;
  return job.closestMatch ? 'Closest Match' : 'Aspiration';
}

export interface PreferenceMismatch {
  /** "work setup", "level" or "salary". */
  label: string;
  jobValue: string;
  chosenValue: string;
}

export function mapPreferenceMismatches(value: MatchResultItem['preference_mismatches']): PreferenceMismatch[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item.job_value === 'string' && item.job_value.trim())
    .map((item) => ({ label: String(item.label || ''), jobValue: item.job_value.trim(), chosenValue: String(item.chosen_value || '').trim() }));
}

export function mapRunMatch(match: MatchResultItem, category: 'fit-now' | 'aspiration'): DashboardJob {
  const scoreContext = category === 'fit-now' ? 'fit_now' : 'aspiration';
  const normalizedScore = extractMatchPercent(match, scoreContext);
  const score = normalizedScore === null ? 0 : Math.round(normalizedScore);
  const dynamic = match as unknown as Record<string, unknown>;
  const linkFields = [match.external_job_link_optional, dynamic.job_url, dynamic.url];
  // Catalogue jobs listed elsewhere (e.g. imported from Jooble) carry their link as external_job_link_optional.
  const externalUrl = linkFields.find((value): value is string => typeof value === 'string' && value.trim() !== '');
  const jobSource = dynamic.job_source === 'employer' ? 'employer' : 'internal';
  const sourceType: 'internal' | 'external' = externalUrl ? 'external' : 'internal';
  const location = match.location || 'Location not specified';
  const setup = typeof dynamic.work_setup === 'string' && dynamic.work_setup.trim() ? dynamic.work_setup : typeof dynamic.work_type === 'string' && dynamic.work_type.trim() ? dynamic.work_type : 'Work setup not specified';
  const matchedSkills = cleanSkillList(match.matched_skills || []);
  const missingSkills = cleanSkillList(match.missing_skills || []);
  const requiredSkills = Array.from(new Set([...cleanSkillList(extractStringList(match.required_skills)), ...matchedSkills, ...missingSkills]));
  const preferredSkills = cleanSkillList(extractStringList(match.preferred_skills));
  const responsibilities = extractStringList((match as unknown as Record<string, unknown>).responsibilities);
  const qualifications = extractLineList(dynamic.qualifications);
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
    closestMatch: match.is_closest_match === true,
    closestFitNow: category === 'fit-now' && match.fit_now_fallback === true && match.fit_now_fallback_reason !== 'outside_region_filter',
    preferenceMismatches: mapPreferenceMismatches(match.preference_mismatches),
    sourceType,
    requiredSkills,
    preferredSkills,
    responsibilities,
    qualifications,
    description: typeof (match as unknown as Record<string, unknown>).job_description === 'string'
      ? String((match as unknown as Record<string, unknown>).job_description)
      : typeof (match as unknown as Record<string, unknown>).description === 'string'
        ? String((match as unknown as Record<string, unknown>).description)
        : undefined,
    matchedSkills,
    missingSkills,
    missingSkillIds: match.missing_skill_ids,
    missingPreferredSkills: cleanSkillList(match.missing_preferred_skills || []).filter((skill) => !missingSkills.includes(skill)),
    explanation: match.explanation || '',
    category: titleCase(categoryLabel),
    subCategory: titleCase(subCategoryLabel),
    jobLevel: titleCase(jobLevel),
    niceToHaveSkills: [],
    externalUrl,
    rankPosition: typeof dynamic.rank_position === 'number' ? dynamic.rank_position : undefined,
  };
}

/** Match score at or above which a job counts as Fit-Now; mirrors the backend FIT_NOW_MIN_REQUIRED_COVERAGE and the employer Match filter. */
export const FIT_NOW_MATCH_PERCENT = 70;

export function mapModelMatch(match: JobMatch): DashboardJob {
  const score = Math.max(0, Math.min(100, Math.round(match.matchScore)));
  const category: 'fit-now' | 'aspiration' = score >= FIT_NOW_MATCH_PERCENT ? 'fit-now' : 'aspiration';
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

export function mapAvailableJob(job: AvailableJobItem): DashboardJob {
  const location = job.location || 'Location not specified';
  const workType = (job.work_type || job.work_setup || '').toLowerCase();
  const setup = workType.includes('remote') ? 'Remote' : workType.includes('hybrid') ? 'Hybrid' : workType.includes('onsite') || workType.includes('on-site') ? 'Onsite' : (job.work_type || job.work_setup || 'Work setup not specified');
  const sourceType: 'internal' | 'external' = job.external_job_link_optional ? 'external' : 'internal';
  const jobSource: 'internal' | 'employer' = job.job_source === 'employer' ? 'employer' : 'internal';
  const requiredSkills = Array.isArray(job.required_skills) ? cleanSkillList(job.required_skills).slice(0, 12) : [];
  const preferredSkills = cleanSkillList(extractStringList(job.preferred_skills));
  const responsibilities = extractStringList(job.responsibilities);
  const qualifications = extractLineList(job.qualifications);

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
    qualifications,
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

export function mergeSupabaseJobDetails(job: DashboardJob, detail?: AvailableJobItem): DashboardJob {
  if (!detail) return job;
  const requiredSkills = Array.isArray(detail.required_skills) ? cleanSkillList(detail.required_skills) : cleanSkillList(extractStringList(detail.required_skills));
  const preferredSkills = cleanSkillList(extractStringList(detail.preferred_skills));
  const responsibilities = extractStringList(detail.responsibilities);
  const qualifications = extractLineList(detail.qualifications);
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
    qualifications: qualifications.length > 0 ? qualifications : job.qualifications,
    description: detail.job_description || detail.description || job.description,
    category: titleCase(detail.job_category || job.category || ''),
    subCategory: titleCase(detail.job_subcategory || job.subCategory || ''),
    jobLevel: titleCase(detail.experience_level_required || detail.job_level || job.jobLevel || ''),
    externalUrl: detail.external_job_link_optional || job.externalUrl,
    sourceType: detail.external_job_link_optional ? 'external' : job.sourceType,
  };
}

export function mapApplicationStatus(status: string | null | undefined): ApplicationStatus {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'shortlisted') return 'Shortlisted';
  if (normalized === 'interviewing') return 'Interviewing';
  if (normalized === 'hired') return 'Hired';
  if (normalized === 'rejected') return 'Rejected';
  if (normalized === 'withdrawn') return 'Withdrawn';
  return 'Pending';
}

export function mapApplicationRow(row: JobApplicationRow, jobs: DashboardJob[]): DashboardApplication {
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

export type ExtractedEducation = NonNullable<ResumeAnalyzeResponse['candidate_profile']['education']>[number];

export function extractEducationFromSavedText(resumeText: string): ExtractedEducation[] {
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

export function withExtractedEducation(analysis: ResumeAnalyzeResponse): ResumeAnalyzeResponse {
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

export function normalizeSavedResumeAnalysis(record: Awaited<ReturnType<typeof loadLatestResume>>): ResumeAnalyzeResponse | null {
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

export function mapRunGap(gap: PrioritizedSkillGap): DashboardGap {
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
    optional: gap.gap_type === 'optional',
    learningResourceAvailable: Boolean(gap.learning_resource_available),
    category: classifySkillCategory(gap.skill_name || ''),
    relatedJobs: (gap.related_jobs || []).map(titleCase).slice(0, 4),
    topResources: (gap.recommended_learning_resources || []).map(mapRunLearningRecommendation).filter((course) => course.reviewed),
    skillId: gap.skill_id,
  };
}

export function mapModelGap(gap: SkillGap, matches: JobMatch[]): DashboardGap {
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

export const CREDENTIAL_LABELS: Record<CredentialType, string> = {
  exam_review: 'Licensure exam review',
  professional_certificate: 'Professional certificate',
  industry_certification: 'Industry certification',
  certificate_course: 'Certificate on completion',
  course: 'Course, no certificate',
};

/** Only these award something a candidate can show an employer. */
export function grantsCredential(credentialType: CredentialType): boolean {
  return credentialType !== 'course' && credentialType !== 'exam_review';
}

export function resolveCredentialType(value: unknown, fallbackHasCertificate?: boolean): CredentialType {
  const raw = String(value || '').trim().toLowerCase();
  if (raw in CREDENTIAL_LABELS) return raw as CredentialType;
  // Legacy records with only a boolean: keep the weaker of the two claims.
  return fallbackHasCertificate ? 'certificate_course' : 'course';
}

export function mapCourse(rec: CourseRecommendation): DashboardCourse {
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
    mappedSkills: [], mappedSkillIds: [], reviewed: false, verified: false, fees: 'Unknown', certificateCost: 'Unknown', prerequisites: 'Unknown', credentialConditions: 'Unknown',
    url: rec.course?.url,
    urlLabel: 'Open Resource',
    deliveryMode: undefined,
    source: 'backend',
  };
}

export function mapRunLearningRecommendation(rec: RunLearningRecommendation): DashboardCourse {
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
    mappedSkills, mappedSkillIds: rec.matched_gap_skill_ids || [],
    categoryName: rec.category_name || undefined,
    reviewed: Boolean(rec.resource_id || rec.title) && mappedSkills.length > 0,
    verified: rec.review_status === 'verified',
    recommendationNote: rec.why_recommended || undefined,
    recommendationNoteByJob: rec.why_by_job || undefined,
    fees: rec.cost_type || 'Unknown', certificateCost: rec.certificate_cost || 'Unknown',
    prerequisites: rec.prerequisites || 'Unknown', credentialConditions: rec.credential_conditions || 'Unknown',
    verifiedAt: rec.last_verified_at,
    url: rec.url || undefined,
    urlLabel: ['Start learning', 'View preparation course', 'View certification'].includes(rec.url_label || '') ? rec.url_label! : 'Start learning',
    deliveryMode: rec.delivery_mode || undefined,
    source: 'backend',
  };
}

export function getPreferenceLabel(table: Record<string, string>, key: string): string {
  return table[key] || key;
}

export function preferenceKeyForLabel(table: Record<string, string>, label: string | null | undefined): string {
  const value = (label || '').trim();
  if (!value) return '';
  if (table[value]) return value;
  return Object.keys(table).find((key) => table[key].toLowerCase() === value.toLowerCase()) || value;
}

// The Preferences page saves labels to the candidate profile; map them back to answers.
const PROFILE_PREFERENCE_COLUMNS = 'preferred_industry,target_role,preferred_work_setup,expected_salary,skill_to_develop,preferred_location_scope,preferred_region';
type ProfilePreferenceRow = Record<string, string | null>;
type ProfilePreferenceRead = { data: ProfilePreferenceRow | null; error: { message: string } | null };

export async function loadProfilePreferences(userId: string): Promise<SurveyAnswers | null> {
  const select = async (columns: string): Promise<ProfilePreferenceRead> => {
    const { data, error } = await supabase.from('candidate_profiles').select(columns).eq('user_id', userId).maybeSingle();
    return { data: (data as unknown as ProfilePreferenceRow | null) ?? null, error };
  };
  let { data, error } = await select(`${PROFILE_PREFERENCE_COLUMNS},preferred_employment_type`);
  if (error && /preferred_employment_type/i.test(error.message || '')) {
    // The column comes from a migration; until it runs, load the other answers.
    ({ data, error } = await select(PROFILE_PREFERENCE_COLUMNS));
  }
  if (error) {
    console.warn('Unable to load saved preferences:', error.message);
    return null;
  }
  if (!data?.preferred_industry) return null;
  return {
    industry: normalizeCareerAreaValue(data.preferred_industry),
    role: data.target_role || '',
    setup: preferenceKeyForLabel(setupLabels, data.preferred_work_setup),
    salary: preferenceKeyForLabel({ ...legacySalaryLabels, ...salaryLabels }, data.expected_salary),
    skill: data.skill_to_develop || '',
    employmentType: data.preferred_employment_type || '',
    locationScope: normalizeLocationScope(data.preferred_location_scope),
    region: data.preferred_region || '',
  };
}

export function learningResourceUrl(course: DashboardCourse): string | undefined {
  try {
    if (!course.url) return undefined;
    const url = new URL(course.url);
    return ['https:', 'http:'].includes(url.protocol) && url.hostname && !url.username && !url.password && !/\s/.test(course.url) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

// ---------- Display helpers for the redesigned views ----------

/** A job field worth showing, or '' for placeholders such as "Not specified". */
export function knownValue(value?: string | null): string {
  const trimmed = (value || '').trim();
  if (!trimmed || PLACEHOLDER_VALUE_PATTERN.test(trimmed)) return '';
  if (/^unknown company$|not specified$|^not available$/i.test(trimmed)) return '';
  return trimmed;
}

/** Company · location · work setup, leaving out anything unknown. */
export function jobMetaParts(job: Pick<DashboardJob, 'company' | 'location' | 'setup'>): string[] {
  return [job.company, job.location, job.setup].map(knownValue).filter(Boolean);
}

export function jobScore(job: Pick<DashboardJob, 'hasMatchScore' | 'matchScore'>): number | null {
  return job.hasMatchScore ? Math.max(0, Math.min(100, Math.round(job.matchScore))) : null;
}

/** "4 of 5 skills" and the first missing skills, for compact job rows. */
export function jobSkillSummary(job: Pick<DashboardJob, 'matchedSkills' | 'missingSkills'>): { matched: number; total: number; missing: string[] } {
  const matched = splitSkillList(job.matchedSkills);
  const missing = splitSkillList(job.missingSkills);
  return { matched: matched.length, total: matched.length + missing.length, missing };
}

export function categoryBadgeClass(job: Pick<DashboardJob, 'matchCategory' | 'closestMatch' | 'hasMatchScore'>): string {
  if (!job.hasMatchScore) return 'k-badge';
  return job.matchCategory === 'fit-now' ? 'k-badge k-badge-fit' : 'k-badge k-badge-aspiration';
}

export function severityBadgeClass(severity: SeverityLevel): string {
  if (severity === 'Critical') return 'k-badge k-badge-critical';
  if (severity === 'High') return 'k-badge k-badge-high';
  return 'k-badge';
}

export const WITHDRAWABLE_STATUSES: ApplicationStatus[] = ['Pending', 'Shortlisted', 'Interviewing'];
export const MESSAGING_STATUSES: ApplicationStatus[] = ['Interviewing', 'Hired'];

export function applicationBadgeClass(status: ApplicationStatus): string {
  if (status === 'Hired') return 'k-badge k-badge-success';
  if (status === 'Interviewing' || status === 'Shortlisted') return 'k-badge k-badge-info';
  if (status === 'Rejected') return 'k-badge k-badge-danger';
  if (status === 'Withdrawn') return 'k-badge k-badge-outline';
  return 'k-badge k-badge-high';
}

/** Opens a job's external posting, or a web search for it when no link is stored. */
export function externalJobUrl(job: Pick<DashboardJob, 'externalUrl' | 'title' | 'company'>): string {
  return job.externalUrl || `https://www.google.com/search?q=${encodeURIComponent(`${job.title} ${knownValue(job.company)} jobs`)}`;
}

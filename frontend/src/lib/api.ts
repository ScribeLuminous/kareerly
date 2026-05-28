import type { JobMatchRunResults, MatchResultItem, ResumeAnalysisResult, SurveyAnswers } from '../types';
import { normalizeMatchItemPercentages } from './matchScoring';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';
const REQUEST_TIMEOUT_MS = 90_000;

function getReadableMessage(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  if (Array.isArray(value)) {
    return value.map(getReadableMessage).filter(Boolean).join(', ');
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const directMessage =
      record.message ||
      record.msg ||
      record.detail ||
      record.title ||
      record.name ||
      record.skill_name;

    if (directMessage) return getReadableMessage(directMessage);

    try {
      return JSON.stringify(value);
    } catch {
      return 'Unexpected backend response.';
    }
  }

  return '';
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMessage: string,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(timeoutMessage);
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export type UserMode = 'guest' | 'registered' | 'logged_in';
export type ViewMode = 'initial' | 'full';
export type SkillSearchItem = {
  skill_id: string;
  skill_name: string;
  skill_category?: string;
  skill_subcategory?: string;
};

export type AvailableJobItem = {
  job_id: string;
  job_title: string;
  job_category?: string;
  job_subcategory?: string;
  experience_level_required?: string;
  location?: string;
  work_type?: string;
  salary_range_monthly_php?: string;
  required_skills?: string[];
  external_job_link_optional?: string;
  source_dataset?: string;
  company_name?: string;
};

export async function analyzeResume(resumeFile: File, _legacySurveyAnswers?: Partial<SurveyAnswers>): Promise<ResumeAnalysisResult> {
  const formData = new FormData();
  formData.append('resume', resumeFile);

  let response: Response;

  try {
    response = await fetchWithTimeout(
      `${API_BASE_URL}/api/resume/analyze`,
      {
        method: 'POST',
        body: formData,
      },
      'Resume analysis timed out. Please try again with a smaller or simpler PDF/DOCX file.',
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes('timed out')) throw error;
    throw new Error('Cannot reach the ML backend. Start FastAPI on http://127.0.0.1:8000, then try again.');
  }

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    throw new Error(getReadableMessage(errorBody?.detail || errorBody) || 'Resume analysis failed.');
  }

  const data = (await response.json()) as ResumeAnalysisResult;

  const resumeTextForMatching = data.normalized_for_matching?.resume_text_for_matching || '';

  const parsedResume = data.parsedResume || {
    skills: (data.candidate_profile?.skills || []).map((skill) => ({ name: skill.skill_name })),
    education: [],
    experience: [],
    normalized_for_matching: {
      resume_text_for_matching: resumeTextForMatching,
    },
    cleanedText: resumeTextForMatching,
    rawText: resumeTextForMatching,
  };

  return {
    ...data,
    parsedResume,
    jobMatches: data.jobMatches || [],
    skillGaps: data.skillGaps || [],
    courseRecommendations: data.courseRecommendations || [],
  };
}

export type RunJobMatchesPayload = {
  user_mode?: UserMode;
  view_mode?: ViewMode;
  resume_text_for_matching: string;
  candidate_skill_ids?: string[];
  skill_names?: string[];
  preferences: {
    industry: string;
    target_role?: string;
    role?: string;
    work_setup: string;
    salary?: string;
    salary_expectation?: string;
    skill_to_develop: string;
    job_level?: string;
  };
};

export async function runJobMatches(payload: RunJobMatchesPayload): Promise<JobMatchRunResults> {
  const candidateSkillIds = (payload.candidate_skill_ids || payload.skill_names || [])
    .map((skillId) => String(skillId || '').trim().toUpperCase())
    .filter(Boolean);
  const uniqueCandidateSkillIds = Array.from(new Set(candidateSkillIds));
  const resumeText = (payload.resume_text_for_matching || '').trim();

  if (!resumeText) {
    throw new Error('No resume text available for matching.');
  }

  const normalizedPayload = {
    user_mode: payload.user_mode || 'guest',
    view_mode: payload.view_mode || 'initial',
    resume_text_for_matching: resumeText,
    candidate_skill_ids: uniqueCandidateSkillIds,
    preferences: {
      industry: payload.preferences.industry || '',
      target_role: payload.preferences.target_role || payload.preferences.role || payload.preferences.job_level || '',
      role: payload.preferences.role || payload.preferences.job_level || '',
      work_setup: payload.preferences.work_setup || '',
      salary: payload.preferences.salary || '',
      salary_expectation: payload.preferences.salary_expectation || payload.preferences.salary || '',
      skill_to_develop: payload.preferences.skill_to_develop || '',
    },
  };

  let response: Response;

  try {
    response = await fetchWithTimeout(
      `${API_BASE_URL}/api/matches/run`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(normalizedPayload),
      },
      'Job matching timed out. Please try generating the report again.',
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes('timed out')) throw error;
    throw new Error('Cannot reach the job matching backend. Start FastAPI on http://127.0.0.1:8000, then try again.');
  }

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    throw new Error(getReadableMessage(errorBody?.detail || errorBody) || 'Job matching failed.');
  }

  const rawResults = (await response.json()) as JobMatchRunResults;

  const normalizeMatchList = (items: MatchResultItem[] | undefined, context: 'fit_now' | 'aspiration'): MatchResultItem[] => {
    if (!Array.isArray(items)) return [];
    return items.map((item) => normalizeMatchItemPercentages(item, context));
  };
  const normalizedSkillGaps = rawResults.skill_gaps || rawResults.prioritized_skill_gaps || [];
  const normalizedLearning = rawResults.learning_recommendations || [];

  return {
    ...rawResults,
    fit_now_matches: normalizeMatchList(rawResults.fit_now_matches, 'fit_now'),
    aspiration_matches: normalizeMatchList(rawResults.aspiration_matches, 'aspiration'),
    skill_gaps: normalizedSkillGaps,
    learning_recommendations: normalizedLearning,
    limited_report: {
      fit_now_matches: normalizeMatchList(rawResults.limited_report?.fit_now_matches, 'fit_now'),
      aspiration_matches: normalizeMatchList(rawResults.limited_report?.aspiration_matches, 'aspiration'),
      skill_gaps: rawResults.limited_report?.skill_gaps || normalizedSkillGaps,
      learning_recommendations: rawResults.limited_report?.learning_recommendations || normalizedLearning,
    },
  };
}

export async function searchSkills(query: string, limit = 20): Promise<{ results: SkillSearchItem[] }> {
  let response: Response;
  const q = query.trim();
  const safeLimit = Math.max(1, Math.min(limit, 50));

  try {
    response = await fetchWithTimeout(
      `${API_BASE_URL}/api/skills/search?q=${encodeURIComponent(q)}&limit=${safeLimit}`,
      {
        method: 'GET',
      },
      'Skill search timed out. Please try again.',
    );
  } catch {
    throw new Error('Cannot reach skill search backend. Start FastAPI on http://127.0.0.1:8000, then try again.');
  }

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    throw new Error(getReadableMessage(errorBody?.detail || errorBody) || 'Skill search failed.');
  }

  const data = (await response.json()) as { results?: SkillSearchItem[] };
  return { results: Array.isArray(data.results) ? data.results : [] };
}

export async function fetchAvailableJobs(limit = 200): Promise<{ results: AvailableJobItem[] }> {
  let response: Response;
  const safeLimit = Math.max(1, Math.min(limit, 500));

  try {
    response = await fetchWithTimeout(
      `${API_BASE_URL}/api/jobs/list?limit=${safeLimit}`,
      {
        method: 'GET',
      },
      'Job listing request timed out. Please try again.',
    );
  } catch {
    throw new Error('Cannot reach jobs listing backend. Start FastAPI on http://127.0.0.1:8000, then try again.');
  }

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    throw new Error(getReadableMessage(errorBody?.detail || errorBody) || 'Unable to load job listings.');
  }

  const data = (await response.json()) as { results?: AvailableJobItem[] };
  return { results: Array.isArray(data.results) ? data.results : [] };
}

export async function validateCertificateFile(certificateFile: File): Promise<{ status: string; message: string }> {
  const formData = new FormData();
  formData.append('certificate', certificateFile);

  let response: Response;

  try {
    response = await fetchWithTimeout(
      `${API_BASE_URL}/api/certificates/validate`,
      {
        method: 'POST',
        body: formData,
      },
      'Certificate validation timed out. Please try again.',
    );
  } catch {
    throw new Error('Cannot reach certificate validation backend. Start FastAPI on http://127.0.0.1:8000, then try again.');
  }

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    throw new Error(getReadableMessage(errorBody?.detail || errorBody) || 'Certificate validation failed.');
  }

  const data = (await response.json()) as { status?: string; message?: string };
  return {
    status: data.status || 'valid',
    message: data.message || 'Certificate file passed baseline validation checks.',
  };
}

export function buildMatchPayloadFromAnalysis(params: {
  analysis: ResumeAnalysisResult;
  answers: SurveyAnswers;
  userMode: UserMode;
  viewMode: ViewMode;
}): RunJobMatchesPayload {
  const { analysis, answers, userMode, viewMode } = params;

  return {
    user_mode: userMode,
    view_mode: viewMode,
    resume_text_for_matching: analysis.normalized_for_matching?.resume_text_for_matching || '',
    candidate_skill_ids: analysis.normalized_for_matching?.skill_ids || [],
    preferences: {
      industry: answers.industry,
      target_role: answers.role,
      role: answers.role,
      work_setup: answers.setup,
      salary: answers.salary,
      salary_expectation: answers.salary,
      skill_to_develop: answers.skill,
    },
  };
}

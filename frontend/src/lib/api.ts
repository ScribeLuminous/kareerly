import type { JobMatchRunResults, MatchResultItem, PrioritizedSkillGap, ResumeAnalysisResult, ResumeAnalysisSkill, SelectedSkill, SurveyAnswers } from '../types';
import { normalizeMatchItemPercentages, normalizeSkillGapPercentages, parseNumericValue } from './matchScoring';
import { supabase } from './supabase';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';
const REQUEST_TIMEOUT_MS = 90_000;
export const CONFIRMED_SKILL_LIMIT = 20;

export type PersistedApplicationMessage = {
  id?: string;
  sender_role: 'candidate' | 'employer';
  message_kind: 'request' | 'message';
  message_text: string;
  created_at?: string | null;
};

async function authenticatedMessageRequest(path: string, options: RequestInit = {}) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Your session has expired. Please log in again.');
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(getReadableMessage(payload) || 'Unable to process the message.');
  return payload;
}

export async function loadApplicationMessages(applicationId: string): Promise<PersistedApplicationMessage[]> {
  const payload = await authenticatedMessageRequest(`/api/messages/${encodeURIComponent(applicationId)}`);
  return Array.isArray(payload) ? payload as PersistedApplicationMessage[] : [];
}

export async function sendApplicationMessage(input: { applicationId: string; text: string; kind?: 'request' | 'message' }): Promise<PersistedApplicationMessage> {
  return authenticatedMessageRequest('/api/messages', {
    method: 'POST',
    body: JSON.stringify({ application_id: input.applicationId, message_text: input.text, message_kind: input.kind || 'message' }),
  }) as Promise<PersistedApplicationMessage>;
}

export async function updateEmployerApplicationStatus(input: { applicationId: string; status: string; rejectionReason?: string }): Promise<void> {
  await authenticatedMessageRequest('/api/messages/application-status', {
    method: 'POST',
    body: JSON.stringify({ application_id: input.applicationId, status: input.status, rejection_reason: input.rejectionReason || null }),
  });
}

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
  preferred_label?: string;
  category?: string;
  skill_category?: string;
  skill_subcategory?: string;
  matched_alias?: string;
};

export type AvailableJobItem = {
  job_id: string;
  job_title: string;
  job_source?: 'internal' | 'employer';
  job_category?: string;
  job_subcategory?: string;
  experience_level_required?: string;
  location?: string;
  work_type?: string;
  work_setup?: string;
  employment_type?: string;
  job_level?: string;
  salary_range_monthly_php?: string;
  required_skills?: string[];
  preferred_skills?: string[] | string;
  responsibilities?: string[] | string;
  job_description?: string;
  description?: string;
  external_job_link_optional?: string;
  source_dataset?: string;
  company_name?: string;
  created_at?: string;
  updated_at?: string;
  salary_min_php?: string;
  salary_max_php?: string;
};

export type JobDetailResponse = {
  job?: AvailableJobItem;
  match_analysis?: {
    match_label?: string;
    confidence?: string;
    why_this_matches?: string;
    matched_skills?: string[];
    missing_skills?: string[];
    recommended_learning?: Array<Record<string, unknown>>;
    career_guidance?: string;
  };
};

export type AdminOverview = {
  admin_user_id: string;
  counts: {
    users: number;
    candidate_profiles: number;
    employer_profiles: number;
    job_posts: number;
    applications: number;
    messages: number;
    evidence_records: number;
    roles: Record<'candidate' | 'employer' | 'admin', number>;
  };
  recent: {
    profiles: Array<Record<string, unknown>>;
    job_posts: Array<Record<string, unknown>>;
    applications: Array<Record<string, unknown>>;
    messages: Array<Record<string, unknown>>;
    evidence: Array<Record<string, unknown>>;
  };
};

export async function fetchAdminOverview(accessToken: string): Promise<AdminOverview> {
  let response: Response;

  try {
    response = await fetchWithTimeout(
      `${API_BASE_URL}/api/admin/overview`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      'Admin overview request timed out. Please try again.',
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes('timed out')) throw error;
    throw new Error('Cannot reach the FastAPI backend. Start FastAPI on http://127.0.0.1:8000, then try again.');
  }

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    throw new Error(getReadableMessage(errorBody?.detail || errorBody) || 'Unable to load admin overview.');
  }

  return response.json() as Promise<AdminOverview>;
}

export async function resetAdminApplication(accessToken: string, applicationId: string): Promise<void> {
  const response = await fetchWithTimeout(
    `${API_BASE_URL}/api/admin/applications/reset`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ application_id: applicationId }),
    },
    'Application reset timed out. Please try again.',
  );
  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    throw new Error(getReadableMessage(errorBody?.detail || errorBody) || 'Unable to reset application.');
  }
}

async function adminMutation(accessToken: string, path: string, method: string, body?: object): Promise<void> {
  const response = await fetchWithTimeout(`${API_BASE_URL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }, 'Admin action timed out. Please try again.');
  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    throw new Error(getReadableMessage(errorBody?.detail || errorBody) || 'Unable to complete admin action.');
  }
}

export const updateAdminUser = (token: string, input: { user_id: string; email?: string; password?: string }) => adminMutation(token, '/api/admin/users', 'PATCH', input);
export const updateAdminJob = (token: string, input: { job_id: string; job_title?: string; company_name?: string; posting_status?: string }) => adminMutation(token, '/api/admin/jobs', 'PATCH', input);
export const deleteAdminJob = (token: string, jobId: string) => adminMutation(token, `/api/admin/jobs/${encodeURIComponent(jobId)}`, 'DELETE');
export const updateAdminApplication = (token: string, input: { application_id: string; status: string }) => adminMutation(token, '/api/admin/applications', 'PATCH', input);

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
    role_level?: string;
    role?: string;
    work_setup: string;
    salary?: string;
    salary_expectation?: string;
    skill_to_develop: string;
    job_level?: string;
  };
};

type MatchFromResumePayload = {
  resumeFile: File;
  userMode?: UserMode;
  viewMode?: ViewMode;
  confirmedSkills?: SelectedSkill[];
  preferences: {
    industry?: string;
    target_role?: string;
    role_level?: string;
    work_setup?: string;
    salary_expectation?: string;
    skill_to_develop?: string;
  };
};

type MatchFromResumeResponse = {
  filename?: string;
  extracted_skills?: Array<{
    skill_id?: string;
    skill_name?: string;
    category_id?: string;
    skill_category?: string;
    skill_subcategory?: string;
    matched_alias?: string;
    matched_text?: string;
    source_section?: string;
    source?: string;
    source_metadata?: Record<string, unknown>;
    skill_priority_score?: number;
    confidence?: number;
    method?: string;
  }>;
  fit_now_matches?: MatchResultItem[];
  aspiration_matches?: MatchResultItem[];
  all_fit_now_matches?: MatchResultItem[];
  all_aspiration_matches?: MatchResultItem[];
  total_qualifying_matches?: number | string;
  skill_gaps?: PrioritizedSkillGap[];
  prioritized_skill_gaps?: PrioritizedSkillGap[];
  learning_recommendations?: JobMatchRunResults['learning_recommendations'];
  access_control?: JobMatchRunResults['access_control'];
  limited_report?: JobMatchRunResults['limited_report'];
  debug_summary?: JobMatchRunResults['debug_summary'];
  resume_text_preview?: string;
  model_used?: string;
  metadata?: JobMatchRunResults['metadata'];
};

function resolveTotalMatchCount(
  matchLists: Array<MatchResultItem[] | undefined>,
  metadataTotal?: unknown,
): number | undefined {
  const metadataCount = parseNumericValue(metadataTotal);
  if (metadataCount !== null && metadataCount > 0) return Math.round(metadataCount);

  const uniqueJobIds = new Set<string>();
  let fallbackCount = 0;

  matchLists.forEach((matches) => {
    if (!Array.isArray(matches)) return;

    matches.forEach((match) => {
      fallbackCount += 1;
      const jobId = typeof match.job_id === 'string' ? match.job_id.trim() : '';
      if (jobId) uniqueJobIds.add(jobId);
    });
  });

  if (uniqueJobIds.size > 0) return uniqueJobIds.size;
  if (fallbackCount > 0) return fallbackCount;
  return undefined;
}

function normalizeSkillGapList(
  skillGaps: PrioritizedSkillGap[] | undefined,
  totalMatchCount?: number,
): PrioritizedSkillGap[] {
  if (!Array.isArray(skillGaps)) return [];
  return skillGaps.map((gap) => normalizeSkillGapPercentages(gap, totalMatchCount));
}

export async function runJobMatches(payload: RunJobMatchesPayload): Promise<JobMatchRunResults> {
  const candidateSkillIds = (payload.candidate_skill_ids || payload.skill_names || [])
    .map((skillId) => String(skillId || '').trim().toUpperCase())
    .filter(Boolean);
  const uniqueCandidateSkillIds = Array.from(new Set(candidateSkillIds));
  const resumeText = (payload.resume_text_for_matching || '').trim();

  if (!resumeText) {
    throw new Error('No resume text available for matching.');
  }

  if (uniqueCandidateSkillIds.length > CONFIRMED_SKILL_LIMIT) {
    throw new Error(`You can confirm up to ${CONFIRMED_SKILL_LIMIT} skills.`);
  }

  const normalizedPayload = {
    user_mode: payload.user_mode || 'guest',
    view_mode: payload.view_mode || 'initial',
    resume_text_for_matching: resumeText,
    candidate_skill_ids: uniqueCandidateSkillIds,
    preferences: {
      industry: payload.preferences.industry || '',
      target_role: payload.preferences.target_role || payload.preferences.role || payload.preferences.job_level || '',
      role_level: payload.preferences.role_level || payload.preferences.job_level || '',
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

  const normalizedFitNowMatches = normalizeMatchList(rawResults.fit_now_matches, 'fit_now');
  const normalizedAspirationMatches = normalizeMatchList(rawResults.aspiration_matches, 'aspiration');
  const normalizedAllFitNowMatches = normalizeMatchList(rawResults.all_fit_now_matches || rawResults.fit_now_matches, 'fit_now');
  const normalizedAllAspirationMatches = normalizeMatchList(rawResults.all_aspiration_matches || rawResults.aspiration_matches, 'aspiration');
  const topLevelTotalMatches = resolveTotalMatchCount(
    [normalizedFitNowMatches, normalizedAspirationMatches],
    rawResults.metadata?.total_jobs_scored,
  );

  const normalizedPrioritizedSkillGaps = normalizeSkillGapList(rawResults.prioritized_skill_gaps, topLevelTotalMatches);
  const normalizedSkillGaps = normalizeSkillGapList(
    rawResults.skill_gaps || rawResults.prioritized_skill_gaps,
    topLevelTotalMatches,
  );

  const normalizedLimitedFitNowMatches = normalizeMatchList(rawResults.limited_report?.fit_now_matches, 'fit_now');
  const normalizedLimitedAspirationMatches = normalizeMatchList(rawResults.limited_report?.aspiration_matches, 'aspiration');
  const limitedTotalMatches = resolveTotalMatchCount([normalizedLimitedFitNowMatches, normalizedLimitedAspirationMatches]);
  const normalizedLimitedSkillGaps = normalizeSkillGapList(
    rawResults.limited_report?.skill_gaps || normalizedSkillGaps,
    limitedTotalMatches ?? topLevelTotalMatches,
  );

  const normalizedLearning = rawResults.learning_recommendations || [];

  return {
    ...rawResults,
    fit_now_matches: normalizedFitNowMatches,
    aspiration_matches: normalizedAspirationMatches,
    all_fit_now_matches: normalizedAllFitNowMatches,
    all_aspiration_matches: normalizedAllAspirationMatches,
    skill_gaps: normalizedSkillGaps,
    prioritized_skill_gaps: normalizedPrioritizedSkillGaps,
    learning_recommendations: normalizedLearning,
    limited_report: {
      fit_now_matches: normalizedLimitedFitNowMatches,
      aspiration_matches: normalizedLimitedAspirationMatches,
      skill_gaps: normalizedLimitedSkillGaps,
      learning_recommendations: rawResults.limited_report?.learning_recommendations || normalizedLearning,
    },
  };
}

function normalizeExtractedSkills(skills: MatchFromResumeResponse['extracted_skills']): ResumeAnalysisSkill[] {
  if (!Array.isArray(skills)) return [];
  const normalized: ResumeAnalysisSkill[] = [];
  skills.forEach((skill, index) => {
      const skillName = String(skill?.skill_name || '').trim();
      if (!skillName) return;
      const fallbackId = `EXTRACTED_${index + 1}`;
      const skillId = String(skill?.skill_id || '').trim().toUpperCase();
      normalized.push({
        skill_id: skillId || skillName.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || fallbackId,
        skill_name: skillName,
        skill_category: String(skill?.skill_category || '').trim() || undefined,
        skill_subcategory: String(skill?.skill_subcategory || '').trim() || undefined,
        matched_text: String(skill?.matched_text || skill?.matched_alias || '').trim() || undefined,
        source_section: String(skill?.source_section || '').trim() || 'resume_upload',
        source: String(skill?.source || '').trim() || 'resume_extracted',
        source_metadata: skill?.source_metadata,
        skill_priority_score: typeof skill?.skill_priority_score === 'number' ? skill.skill_priority_score : undefined,
        confidence: typeof skill?.confidence === 'number' ? skill.confidence : undefined,
        method: String(skill?.method || '').trim() || 'pre-trained Cross-Encoder BERT semantic scoring',
      });
    });
  return normalized.slice(0, CONFIRMED_SKILL_LIMIT);
}

export async function runMatchesFromResume(payload: MatchFromResumePayload): Promise<JobMatchRunResults> {
  const formData = new FormData();
  const confirmedSkills = (payload.confirmedSkills || []).slice(0, CONFIRMED_SKILL_LIMIT);
  if ((payload.confirmedSkills || []).length > CONFIRMED_SKILL_LIMIT) {
    throw new Error(`You can confirm up to ${CONFIRMED_SKILL_LIMIT} skills.`);
  }
  formData.append('file', payload.resumeFile);
  formData.append('confirmed_skills', JSON.stringify(confirmedSkills));
  formData.append('user_mode', payload.userMode || 'guest');
  formData.append('view_mode', payload.viewMode || 'initial');
  formData.append(
    'preferences',
    JSON.stringify({
      industry: payload.preferences.industry || '',
      target_role: payload.preferences.target_role || '',
      role_level: payload.preferences.role_level || '',
      work_setup: payload.preferences.work_setup || '',
      salary_expectation: payload.preferences.salary_expectation || '',
      skill_to_develop: payload.preferences.skill_to_develop || '',
    }),
  );

  let response: Response;
  const { data: sessionData } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
  const accessToken = sessionData.session?.access_token;
  const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined;

  try {
    response = await fetchWithTimeout(
      `${API_BASE_URL}/api/matches/from-resume`,
      {
        method: 'POST',
        headers,
        body: formData,
      },
      'Analyzing resume and generating job matches timed out. Please try again.',
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes('timed out')) throw error;
    throw new Error('Cannot reach the job matching backend. Start FastAPI on http://127.0.0.1:8000, then try again.');
  }

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    const detail = getReadableMessage(errorBody?.detail || errorBody) || 'Job matching failed.';
    if (response.status >= 500) {
      throw new Error('We could not generate matches right now. Please try again or upload a clearer resume.');
    }
    throw new Error(detail);
  }

  const rawResults = (await response.json()) as MatchFromResumeResponse;
  const normalizedFitNowMatches = Array.isArray(rawResults.fit_now_matches)
    ? rawResults.fit_now_matches.map((item) => normalizeMatchItemPercentages(item, 'fit_now'))
    : [];
  const normalizedAspirationMatches = Array.isArray(rawResults.aspiration_matches)
    ? rawResults.aspiration_matches.map((item) => normalizeMatchItemPercentages(item, 'aspiration'))
    : [];
  const normalizedAllFitNowMatches = Array.isArray(rawResults.all_fit_now_matches)
    ? rawResults.all_fit_now_matches.map((item) => normalizeMatchItemPercentages(item, 'fit_now'))
    : normalizedFitNowMatches;
  const normalizedAllAspirationMatches = Array.isArray(rawResults.all_aspiration_matches)
    ? rawResults.all_aspiration_matches.map((item) => normalizeMatchItemPercentages(item, 'aspiration'))
    : normalizedAspirationMatches;
  const totalMatches = resolveTotalMatchCount([normalizedFitNowMatches, normalizedAspirationMatches]);
  const normalizedPrioritizedSkillGaps = normalizeSkillGapList(
    rawResults.skill_gaps || rawResults.prioritized_skill_gaps,
    totalMatches,
  );
  const normalizedExtractedSkills = normalizeExtractedSkills(rawResults.extracted_skills);
  const isInitialView = (payload.viewMode || 'initial') === 'initial';
  const perTypeLimit = isInitialView ? ((payload.userMode || 'registered') === 'guest' ? 3 : 5) : 10;
  const normalizeMatchList = (items: MatchResultItem[] | undefined, context: 'fit_now' | 'aspiration'): MatchResultItem[] => {
    if (!Array.isArray(items)) return [];
    return items.map((item) => normalizeMatchItemPercentages(item, context));
  };
  const normalizedLimitedFitNowMatches = normalizeMatchList(rawResults.limited_report?.fit_now_matches, 'fit_now');
  const normalizedLimitedAspirationMatches = normalizeMatchList(rawResults.limited_report?.aspiration_matches, 'aspiration');
  const limitedFitNowMatches = normalizedLimitedFitNowMatches.length > 0
    ? normalizedLimitedFitNowMatches
    : normalizedFitNowMatches.slice(0, perTypeLimit);
  const limitedAspirationMatches = normalizedLimitedAspirationMatches.length > 0
    ? normalizedLimitedAspirationMatches
    : normalizedAspirationMatches.slice(0, perTypeLimit);
  const limitedTotalMatches = resolveTotalMatchCount([limitedFitNowMatches, limitedAspirationMatches]);
  const limitedSkillGapLimit = rawResults.access_control?.skill_gap_limit ?? (isInitialView ? perTypeLimit : 8);
  const limitedSkillGapsFromBackend = normalizeSkillGapList(
    rawResults.limited_report?.skill_gaps,
    limitedTotalMatches ?? totalMatches,
  );
  const limitedSkillGaps = (limitedSkillGapsFromBackend.length > 0 ? limitedSkillGapsFromBackend : normalizedPrioritizedSkillGaps.slice(0, limitedSkillGapLimit)).map((gap) =>
    normalizeSkillGapPercentages(gap, limitedTotalMatches ?? totalMatches),
  );
  const normalizedLearning = Array.isArray(rawResults.learning_recommendations) ? rawResults.learning_recommendations : [];
  const learningLimit = rawResults.access_control?.learning_recommendation_limit ?? (isInitialView ? perTypeLimit : 10);
  const limitedLearningRecommendations = Array.isArray(rawResults.limited_report?.learning_recommendations)
    ? rawResults.limited_report.learning_recommendations
    : normalizedLearning.slice(0, learningLimit);

  return {
    fit_now_matches: normalizedFitNowMatches,
    aspiration_matches: normalizedAspirationMatches,
    all_fit_now_matches: normalizedAllFitNowMatches,
    all_aspiration_matches: normalizedAllAspirationMatches,
    total_qualifying_matches: rawResults.total_qualifying_matches,
    skill_gaps: normalizedPrioritizedSkillGaps,
    prioritized_skill_gaps: normalizedPrioritizedSkillGaps,
    learning_recommendations: normalizedLearning,
    access_control: rawResults.access_control || {
      user_mode: payload.userMode || 'guest',
      view_mode: payload.viewMode || 'initial',
      access_label: 'resume_match_upload',
      job_limit_per_match_type: perTypeLimit,
      skill_gap_limit: isInitialView ? perTypeLimit : 8,
      learning_recommendation_limit: learningLimit,
      guest_note: (payload.userMode || 'registered') === 'guest' ? 'Guest users receive a limited Top 3 report.' : '',
    },
    limited_report: {
      fit_now_matches: limitedFitNowMatches,
      aspiration_matches: limitedAspirationMatches,
      skill_gaps: limitedSkillGaps,
      learning_recommendations: limitedLearningRecommendations,
      development_progress: rawResults.limited_report?.development_progress,
    },
    extracted_skills: normalizedExtractedSkills,
    debug_summary: rawResults.debug_summary,
    resume_text_preview: rawResults.resume_text_preview || '',
    model_used: rawResults.model_used || '',
    metadata: {
      ...rawResults.metadata,
      model_version: rawResults.metadata?.model_version || rawResults.model_used || 'pre-trained Cross-Encoder BERT semantic scoring',
      total_jobs_scored: rawResults.metadata?.total_jobs_scored || totalMatches,
      method: 'resume_upload_formdata',
      jobs_source: rawResults.metadata?.jobs_source || 'backend_job_source',
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

export async function fetchJobDetails(jobId: string, jobSource: 'internal' | 'employer' = 'internal'): Promise<JobDetailResponse> {
  let response: Response;

  try {
    response = await fetchWithTimeout(
      `${API_BASE_URL}/api/jobs/detail?job_id=${encodeURIComponent(jobId)}&job_source=${encodeURIComponent(jobSource)}`,
      {
        method: 'GET',
      },
      'Job details request timed out. Please try again.',
    );
  } catch {
    throw new Error('Cannot reach jobs detail backend. Start FastAPI on http://127.0.0.1:8000, then try again.');
  }

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    throw new Error(getReadableMessage(errorBody?.detail || errorBody) || 'Unable to load job details.');
  }

  return response.json() as Promise<JobDetailResponse>;
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

export function buildResumeAnalysisFromMatchResults(matchResults: JobMatchRunResults): ResumeAnalysisResult {
  const extractedSkills = (matchResults.extracted_skills || []).slice(0, CONFIRMED_SKILL_LIMIT);
  const skillIds = extractedSkills.map((skill) => skill.skill_id).filter((skillId): skillId is string => Boolean(skillId));
  const skillNames = extractedSkills.map((skill) => skill.skill_name).filter(Boolean);
  const resumeText = matchResults.resume_text_preview || '';

  return {
    status: 'success',
    raw_text_length: resumeText.length,
    sections_detected: {
      skills: extractedSkills.length > 0,
      education: false,
      certifications: false,
      experience: resumeText.length > 0,
    },
    candidate_profile: {
      skills: extractedSkills,
      education_indicators: [],
      certification_indicators: [],
      experience_indicators: [],
    },
    normalized_for_matching: {
      skill_ids: skillIds,
      skill_names: skillNames,
      resume_text_for_matching: resumeText,
    },
    warnings: [],
    parsedResume: {
      skills: extractedSkills.map((skill) => ({ name: skill.skill_name })),
      education: [],
      experience: [],
      rawText: resumeText,
      cleanedText: resumeText,
      normalized_for_matching: {
        resume_text_for_matching: resumeText,
      },
    },
    jobMatches: [],
    skillGaps: [],
    courseRecommendations: [],
    extracted_skills: extractedSkills,
    resume_text_preview: resumeText,
    model_used: matchResults.model_used,
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

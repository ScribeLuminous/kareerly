import type { JobMatchRunResults, MatchResultItem, PrioritizedSkillGap, ResumeAnalysisResult, ResumeAnalysisSkill, SelectedSkill, SurveyAnswers } from '../types';
import { normalizeMatchItemPercentages, normalizeSkillGapPercentages, parseNumericValue } from './matchScoring';
import { supabase } from './supabase';
import type { MatchFeedbackRow, MatchFeedbackSource, MatchVote } from './matchFeedback';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL?.trim() || 'http://127.0.0.1:8000').replace(/\/+$/, '');
const REQUEST_TIMEOUT_MS = 90_000;
// Matching may load the encoder and embed every job before it can answer. A host
// that sleeps when idle pays that on the first request after waking, which does
// not fit in the default budget.
const MATCHING_TIMEOUT_MS = 240_000;
export const CONFIRMED_SKILL_LIMIT = 20;

const REACHABILITY_PROBE_TIMEOUT_MS = 10_000;
// A sleeping or redeploying host drops requests before CORS headers are added, which
// fetch() reports exactly like a wrong URL. Give it this long to come back first.
const BACKEND_WAKE_TIMEOUT_MS = 90_000;
const BACKEND_WAKE_POLL_MS = 5_000;
const isLocalBackend = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(API_BASE_URL);

/** Opaque probe: it resolves whenever the host answers, even when CORS hides the body. */
async function backendIsReachable(): Promise<boolean> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), REACHABILITY_PROBE_TIMEOUT_MS);
  try {
    await fetch(`${API_BASE_URL}/api/health`, {
      method: 'GET',
      mode: 'no-cors',
      cache: 'no-store',
      signal: controller.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function backendConnectionError(error: unknown): Promise<Error> {
  console.error('Job matching backend request failed', { apiBaseUrl: API_BASE_URL, error });
  if (isLocalBackend) {
    return new Error(`Cannot reach the job matching backend at ${API_BASE_URL}. For local development, run npm run dev. For a deployed website, configure VITE_API_BASE_URL with the public backend URL and redeploy the frontend.`);
  }

  // An opaque response also includes gateway errors and challenge pages. It
  // cannot prove that FastAPI rejected this website's CORS origin.
  const reachable = await backendIsReachable();
  return new Error(reachable
    ? `The job matching service at ${API_BASE_URL} answered, but the request could not complete. Its hosting protection or a network interruption may be blocking it. Please try again shortly; if it continues, report the time of the failure to the site administrator.`
    : `The job matching backend at ${API_BASE_URL} is not responding. It may be asleep, still starting up, or failing to boot — check its service logs, then try again. If the URL is wrong, update VITE_API_BASE_URL and redeploy this website.`);
}

export type PersistedApplicationMessage = {
  id?: string;
  sender_role: 'candidate' | 'employer';
  message_kind: 'request' | 'message';
  message_text: string;
  created_at?: string | null;
};

async function authenticatedMessageRequest(path: string, options: RequestInit = {}, fallbackError = 'Unable to process the message.') {
  const { data } = await supabase.auth.getSession();
  let token = data.session?.access_token;
  if (!token) throw new Error('Your session has expired. Please log in again.');
  const send = (accessToken: string) => fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}`, ...(options.headers || {}) },
  });
  let response = await send(token);
  if (response.status === 401) {
    // The cached access token can be stale (e.g. after the tab slept); refresh once and retry.
    const { data: refreshed } = await supabase.auth.refreshSession();
    token = refreshed.session?.access_token;
    if (!token) throw new Error('Your session has expired. Please log in again.');
    response = await send(token);
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(getReadableMessage(payload) || fallbackError);
  return payload;
}

const MATCH_FEEDBACK_PATH = '/api/candidate/match-feedback';

export async function loadMatchFeedback(): Promise<MatchFeedbackRow[]> {
  const payload = await authenticatedMessageRequest(MATCH_FEEDBACK_PATH, {}, 'Unable to load your match ratings.');
  return Array.isArray(payload?.feedback) ? payload.feedback : [];
}

export async function saveMatchFeedback(input: { jobId: string; jobSource: MatchFeedbackSource; vote: MatchVote }): Promise<MatchFeedbackRow> {
  const payload = await authenticatedMessageRequest(MATCH_FEEDBACK_PATH, {
    method: 'PUT',
    body: JSON.stringify({ job_id: input.jobId, job_source: input.jobSource, vote: input.vote }),
  }, 'Unable to save your rating.');
  return payload.feedback;
}

export async function removeMatchFeedback(input: { jobId: string; jobSource: MatchFeedbackSource }): Promise<void> {
  const query = new URLSearchParams({ job_id: input.jobId, job_source: input.jobSource });
  await authenticatedMessageRequest(`${MATCH_FEEDBACK_PATH}?${query.toString()}`, { method: 'DELETE' }, 'Unable to remove your rating.');
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

export type MessageModerationState = {
  blocked: boolean;
  blocked_by_me: boolean;
  blocked_by_role: 'candidate' | 'employer' | null;
  reported_by_me: boolean;
};

export type MessageReportReason = 'spam' | 'harassment' | 'scam' | 'inappropriate' | 'impersonation' | 'other';

export async function loadMessageModeration(applicationId: string): Promise<MessageModerationState> {
  return authenticatedMessageRequest(`/api/messages/${encodeURIComponent(applicationId)}/moderation`) as Promise<MessageModerationState>;
}

export async function submitMessageModeration(input: {
  applicationId: string;
  action: 'report' | 'block' | 'unblock';
  reason?: MessageReportReason;
  details?: string;
}): Promise<MessageModerationState> {
  return authenticatedMessageRequest('/api/messages/moderation', {
    method: 'POST',
    body: JSON.stringify({ application_id: input.applicationId, action: input.action, reason: input.reason || null, details: input.details || null }),
  }) as Promise<MessageModerationState>;
}

export async function updateEmployerApplicationStatus(input: { applicationId: string; status: string; rejectionReason?: string }): Promise<void> {
  await authenticatedMessageRequest('/api/messages/application-status', {
    method: 'POST',
    body: JSON.stringify({ application_id: input.applicationId, status: input.status, rejection_reason: input.rejectionReason || null }),
  });
}

export type EmployerAccountSettings = {
  company_name: string | null;
  company_size: string | null;
  industry: string | null;
  business_email: string | null;
  company_location: string | null;
  company_website: string | null;
  company_description: string | null;
  contact_person_name: string | null;
  contact_role: string | null;
  contact_number: string | null;
  account_email: string | null;
  first_name: string | null;
  last_name: string | null;
};

export async function loadEmployerAccountSettings(): Promise<EmployerAccountSettings> {
  return authenticatedMessageRequest('/api/employer/account-settings') as Promise<EmployerAccountSettings>;
}

export async function saveEmployerAccountSettings(input: Partial<EmployerAccountSettings>): Promise<EmployerAccountSettings> {
  return authenticatedMessageRequest('/api/employer/account-settings', {
    method: 'PATCH',
    body: JSON.stringify(input),
  }) as Promise<EmployerAccountSettings>;
}

export type CandidateAccountSettings = {
  full_name: string;
  email: string;
  public_id: string | null;
  contact_number: string | null;
  birthday: string | null;
  address: string | null;
  location: string | null;
  highest_educational_attainment: string | null;
  degree_program: string | null;
  school_university: string | null;
  year_graduated: string | null;
};

export const loadCandidateAccountSettings = () =>
  authenticatedMessageRequest('/api/candidate/account-settings') as Promise<CandidateAccountSettings>;

export const saveCandidateAccountSettings = (input: Partial<CandidateAccountSettings>) =>
  authenticatedMessageRequest('/api/candidate/account-settings', {
    method: 'PATCH',
    body: JSON.stringify(input),
  }) as Promise<CandidateAccountSettings>;

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
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

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

async function waitForBackend(): Promise<boolean> {
  const deadline = Date.now() + BACKEND_WAKE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const response = await fetchWithTimeout(`${API_BASE_URL}/api/health`, { cache: 'no-store' }, 'Health check timed out.', REACHABILITY_PROBE_TIMEOUT_MS);
      if (response.ok) return true;
    } catch {
      // Still starting up.
    }
    await new Promise((resolve) => window.setTimeout(resolve, BACKEND_WAKE_POLL_MS));
  }
  return false;
}

/** The backend's /api/health/config payload, or null when it cannot be read. Never throws. */
export async function loadBackendHealthConfig(): Promise<unknown> {
  try {
    const response = await fetchWithTimeout(`${API_BASE_URL}/api/health/config`, { cache: 'no-store' }, 'Health check timed out.', REACHABILITY_PROBE_TIMEOUT_MS);
    // A backend too old to have the endpoint answers 404: reachable, but no version.
    if (response.status === 404) return {};
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

/** fetchWithTimeout for the hosted backend: waits out a cold start once, then explains the failure. */
async function fetchBackend(url: string, options: RequestInit, timeoutMessage: string, timeoutMs?: number): Promise<Response> {
  try {
    return await fetchWithTimeout(url, options, timeoutMessage, timeoutMs);
  } catch (error) {
    if (error instanceof Error && error.message === timeoutMessage) throw error;
    if (!isLocalBackend && await waitForBackend()) {
      try {
        return await fetchWithTimeout(url, options, timeoutMessage, timeoutMs);
      } catch (retryError) {
        if (retryError instanceof Error && retryError.message === timeoutMessage) throw retryError;
        throw await backendConnectionError(retryError);
      }
    }
    throw await backendConnectionError(error);
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

export type ExternalJobAnalysisRequest = {
  job_title?: string;
  company_name?: string;
  job_description: string;
};

export type ExternalJobAnalysisResponse = {
  job: { title: string; company_name: string; source: 'external_paste' };
  extracted_requirements: {
    summary: string;
    responsibilities: string[];
    required_skills: string[];
    preferred_skills: string[];
    normalized_required_skills: string[];
    normalized_preferred_skills: string[];
    experience_requirements: string[];
    education_requirements: string[];
    certifications: string[];
    job_level: string;
    industry: string;
    work_setup: string;
  };
  match: {
    match_percentage: number;
    semantic_similarity: number;
    skill_coverage: number;
    match_type: string;
    explanation: string;
    matched_skills: string[];
    missing_skills: string[];
    matched_skill_ids: string[];
    missing_skill_ids: string[];
    preference_alignment: number;
  };
  matched_skills: string[];
  missing_skills: string[];
  preference_alignment: number;
  learning_recommendations: Array<Record<string, unknown>>;
  warnings?: string[];
  metadata: { extraction_source: string; explanation_source: string; matching_source: string; model_used: string; external_job_is_persisted: boolean };
};

export async function analyzeExternalJob(payload: ExternalJobAnalysisRequest): Promise<ExternalJobAnalysisResponse> {
  const { data } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
  const token = data.session?.access_token;
  if (!token) throw new Error('Your session has expired. Please log in again.');

  const response = await fetchBackend(
    `${API_BASE_URL}/api/candidate/external-jobs/analyze`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    },
    'External job analysis timed out. Please try again.',
    MATCHING_TIMEOUT_MS,
  );
  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    throw new Error(getReadableMessage(errorBody?.detail || errorBody) || 'External job analysis failed.');
  }
  return response.json() as Promise<ExternalJobAnalysisResponse>;
}

export type SavedExternalJobMatch = {
  id: string;
  job_title: string;
  company_name: string | null;
  match_percentage: number;
  analysis: ExternalJobAnalysisResponse;
  created_at: string;
};

export async function listSavedExternalJobs(): Promise<SavedExternalJobMatch[]> {
  const payload = await authenticatedMessageRequest('/api/candidate/external-jobs/saved');
  return Array.isArray(payload) ? payload as SavedExternalJobMatch[] : [];
}

export async function saveExternalJobMatch(analysis: ExternalJobAnalysisResponse): Promise<SavedExternalJobMatch> {
  return authenticatedMessageRequest('/api/candidate/external-jobs/saved', {
    method: 'POST',
    body: JSON.stringify({ analysis }),
  }) as Promise<SavedExternalJobMatch>;
}

export async function deleteSavedExternalJobMatch(id: string): Promise<void> {
  await authenticatedMessageRequest(`/api/candidate/external-jobs/saved/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

function contentDispositionFilename(value: string | null): string | null {
  if (!value) return null;
  const utf8Match = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match) return decodeURIComponent(utf8Match[1].replace(/^"|"$/g, ''));
  const basicMatch = value.match(/filename="?([^";]+)"?/i);
  return basicMatch?.[1] || null;
}

export async function downloadExternalJobMatchReport(analysis: ExternalJobAnalysisResponse): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Your session has expired. Please log in again.');
  const response = await fetchBackend(
    `${API_BASE_URL}/api/candidate/external-jobs/report`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ analysis }),
    },
    'The match report took too long to generate. Please try again.',
  );
  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    throw new Error(getReadableMessage(errorBody?.detail || errorBody) || 'The match report could not be generated.');
  }
  const blob = await response.blob();
  const filename = contentDispositionFilename(response.headers.get('Content-Disposition')) || 'Kareerly_External_Job_Match_Report.docx';
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export type CandidateNotification = {
  id: string;
  event_type: 'application_status' | 'message_request' | string;
  application_id: string | null;
  title: string;
  message: string;
  created_at: string;
  read_at: string | null;
};

export async function listCandidateNotifications(): Promise<CandidateNotification[]> {
  const payload = await authenticatedMessageRequest('/api/candidate/notifications');
  return Array.isArray(payload) ? payload as CandidateNotification[] : [];
}

export async function markCandidateNotificationRead(id: string): Promise<void> {
  await authenticatedMessageRequest(`/api/candidate/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' });
}

export async function markAllCandidateNotificationsRead(): Promise<void> {
  await authenticatedMessageRequest('/api/candidate/notifications/read-all', { method: 'PATCH' });
}

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
    throw new Error('Cannot reach the FastAPI backend. Check the configured API URL and run npm run dev to start the local backend.');
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

async function adminRequest<T>(accessToken: string, path: string, method = 'GET', body?: object): Promise<T> {
  const response = await fetchWithTimeout(`${API_BASE_URL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }, 'Admin request timed out. Please try again.');
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(getReadableMessage(payload?.detail || payload) || 'Unable to complete admin action.');
  return payload as T;
}

export type RankingRun = {
  started_at: string;
  trigger: string;
  outcome: 'promoted' | 'kept_current' | 'insufficient_data' | 'failed' | 'rolled_back';
  reason?: string | null;
  candidate_version?: string | null;
  active_version_after?: string | null;
};

export type LearningStatus = {
  ranking: {
    active_model: { version: string; metrics?: Record<string, unknown>; activated_at?: string | null };
    recent_runs: RankingRun[];
    versions: Array<{ version: string; status: string; created_at?: string; notes?: string | null }>;
  };
  feedback_votes: number;
  pending_skill_proposals: number;
  ranker_override: string;
};

export type SkillCandidate = {
  id: string;
  display_label: string;
  status: 'pending' | 'approved' | 'rejected';
  suggested_action: 'new_skill' | 'alias' | 'review';
  suggested_skill_id?: string | null;
  suggestion_similarity?: number | null;
  confidence: number;
  job_source_count: number;
  profile_source_count: number;
  company_count: number;
  review_reasons: string[];
  evidence: Array<{ source_type: string; method: string; snippet?: string | null; job?: string | null }>;
};

export type SkillReviewInput = {
  action: 'approve_new' | 'approve_alias' | 'reject';
  skill_id?: string;
  label?: string;
  category_id?: string;
  note?: string;
};

export const fetchLearningStatus = (token: string) => adminRequest<LearningStatus>(token, '/api/admin/learning/status');
export const runLearningJobs = (token: string, input: { job: 'all' | 'ranking' | 'skills'; dry_run: boolean }) =>
  adminRequest<Record<string, unknown>>(token, '/api/admin/learning/run', 'POST', input);
export const rollbackRankingModel = (token: string, targetVersion?: string) =>
  adminRequest<{ previous_version: string; active_version: string }>(token, '/api/admin/learning/rollback', 'POST', { target_version: targetVersion || null });
export const fetchSkillCandidates = (token: string, status: 'pending' | 'approved' | 'rejected' = 'pending') =>
  adminRequest<{ candidates: SkillCandidate[] }>(token, `/api/admin/skill-candidates?status=${status}`);
export const reviewSkillCandidate = (token: string, id: string, input: SkillReviewInput) =>
  adminRequest<{ status: string; skill_id?: string; kind?: string }>(token, `/api/admin/skill-candidates/${encodeURIComponent(id)}/review`, 'POST', input);

export const updateAdminUser = (token: string, input: { user_id: string; email?: string; password?: string }) => adminMutation(token, '/api/admin/users', 'PATCH', input);
export const updateAdminJob = (token: string, input: { job_id: string; job_title?: string; company_name?: string; posting_status?: string }) => adminMutation(token, '/api/admin/jobs', 'PATCH', input);
export const deleteAdminJob = (token: string, jobId: string) => adminMutation(token, `/api/admin/jobs/${encodeURIComponent(jobId)}`, 'DELETE');
export const updateAdminApplication = (token: string, input: { application_id: string; status: string }) => adminMutation(token, '/api/admin/applications', 'PATCH', input);

/**
 * The resume reader version the backend runs: null when it predates version
 * reporting, undefined when the backend could not be reached.
 */
export async function fetchLiveResumeParserVersion(): Promise<string | null | undefined> {
  try {
    const response = await fetchWithTimeout(`${API_BASE_URL}/api/health/config`, {}, 'Backend check timed out.', 10000);
    if (!response.ok) return undefined;
    const data = await response.json() as { resume_readers?: { parser_version?: string } };
    return data.resume_readers?.parser_version || null;
  } catch {
    return undefined;
  }
}

export async function analyzeResume(resumeFile: File, _legacySurveyAnswers?: Partial<SurveyAnswers>): Promise<ResumeAnalysisResult> {
  const formData = new FormData();
  formData.append('resume', resumeFile);


  const response = await fetchBackend(
    `${API_BASE_URL}/api/resume/analyze`,
    {
      method: 'POST',
      body: formData,
    },
    'Resume analysis timed out. Please try again with a smaller or simpler PDF/DOCX file.',
  );

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    throw new Error(getReadableMessage(errorBody?.detail || errorBody) || 'Resume analysis failed.');
  }

  const data = (await response.json()) as ResumeAnalysisResult;

  const resumeTextForMatching = data.normalized_for_matching?.resume_text_for_matching || '';

  const parsedResume = data.parsedResume || {
    skills: (data.candidate_profile?.skills || []).map((skill) => ({ name: skill.skill_name })),
    education: (data.candidate_profile?.education || []).map((item) => ({
      institution: item.school_university,
      degree: item.degree_program,
      field: item.degree_program,
      graduationYear: Number(item.year_graduated) || 0,
    })),
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
  confirmed_skills?: SelectedSkill[];
  /** Step 2 skills the candidate removed; the backend never credits them from the resume text. */
  removed_skill_ids?: string[];
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
  resumeTextForMatching?: string;
  userMode?: UserMode;
  viewMode?: ViewMode;
  confirmedSkills?: SelectedSkill[];
  removedSkillIds?: string[];
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
  closest_matches?: MatchResultItem[];
  all_closest_matches?: MatchResultItem[];
  catalog_status?: JobMatchRunResults['catalog_status'];
  recommendation_notice?: string;
  total_qualifying_matches?: number | string;
  total_skill_gap_count?: number;
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

function normalizeSkillIds(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => String(value || '').trim().toUpperCase()).filter(Boolean)));
}

/**
 * Skill IDs shown in Step 2 (the analysis' first twenty) that are not among the
 * confirmed skills: the candidate removed them. Skills beyond the twenty shown
 * are never listed here, so the list size cannot turn resume evidence into a gap.
 */
export function removedSkillIds(shownSkillIds: Array<string | null | undefined>, confirmed: SelectedSkill[]): string[] {
  const kept = new Set(confirmed.map((skill) => String(skill.skill_id || '').trim().toUpperCase()).filter(Boolean));
  return normalizeSkillIds(shownSkillIds.map((value) => String(value || ''))).filter((skillId) => !kept.has(skillId));
}

export async function runJobMatches(payload: RunJobMatchesPayload): Promise<JobMatchRunResults> {
  const candidateSkillIds = (payload.candidate_skill_ids || payload.skill_names || [])
    .map((skillId) => String(skillId || '').trim().toUpperCase())
    .filter(Boolean);
  const uniqueCandidateSkillIds = Array.from(new Set(candidateSkillIds));
  const confirmedSkills = (payload.confirmed_skills || []).slice(0, CONFIRMED_SKILL_LIMIT);
  const resumeText = (payload.resume_text_for_matching || '').trim();

  if (!resumeText) {
    throw new Error('No resume text available for matching.');
  }

  if ((payload.confirmed_skills || []).length > CONFIRMED_SKILL_LIMIT || uniqueCandidateSkillIds.length > CONFIRMED_SKILL_LIMIT) {
    throw new Error(`You can confirm up to ${CONFIRMED_SKILL_LIMIT} skills.`);
  }

  const normalizedPayload = {
    user_mode: payload.user_mode || 'guest',
    view_mode: payload.view_mode || 'initial',
    resume_text_for_matching: resumeText,
    candidate_skill_ids: uniqueCandidateSkillIds,
    confirmed_skills: confirmedSkills,
    // Omitted (not an empty list) when unknown, so the backend removes nothing.
    ...(payload.removed_skill_ids ? { removed_skill_ids: normalizeSkillIds(payload.removed_skill_ids) } : {}),
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


  // Multipart without custom headers is a CORS simple request. It avoids an
  // OPTIONS preflight that an upstream challenge can block before FastAPI.
  const formData = new FormData();
  formData.append('payload', JSON.stringify(normalizedPayload));
  const response = await fetchBackend(
    `${API_BASE_URL}/api/matches/run-form`,
    {
      method: 'POST',
      body: formData,
    },
    'Job matching timed out. The backend may still be starting up — please try generating the report again.',
    MATCHING_TIMEOUT_MS,
  );

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
  // Closest matches carry their own score; 'fit_now' only picks which percentage key is read first.
  const normalizedClosestMatches = normalizeMatchList(rawResults.closest_matches, 'fit_now');
  const normalizedAllClosestMatches = normalizeMatchList(rawResults.all_closest_matches || rawResults.closest_matches, 'fit_now');
  // Gaps are counted over the returned matches, never over every job scored.
  const topLevelTotalMatches = resolveTotalMatchCount([normalizedFitNowMatches, normalizedClosestMatches, normalizedAspirationMatches]);

  const normalizedPrioritizedSkillGaps = normalizeSkillGapList(rawResults.prioritized_skill_gaps, topLevelTotalMatches);
  const normalizedSkillGaps = normalizeSkillGapList(
    rawResults.skill_gaps || rawResults.prioritized_skill_gaps,
    topLevelTotalMatches,
  );

  const normalizedLimitedFitNowMatches = normalizeMatchList(rawResults.limited_report?.fit_now_matches, 'fit_now');
  const normalizedLimitedAspirationMatches = normalizeMatchList(rawResults.limited_report?.aspiration_matches, 'aspiration');
  const normalizedLimitedClosestMatches = normalizeMatchList(rawResults.limited_report?.closest_matches, 'fit_now');
  const limitedTotalMatches = resolveTotalMatchCount([normalizedLimitedFitNowMatches, normalizedLimitedClosestMatches, normalizedLimitedAspirationMatches]);
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
    closest_matches: normalizedClosestMatches,
    all_closest_matches: normalizedAllClosestMatches,
    skill_gaps: normalizedSkillGaps,
    prioritized_skill_gaps: normalizedPrioritizedSkillGaps,
    learning_recommendations: normalizedLearning,
    limited_report: {
      fit_now_matches: normalizedLimitedFitNowMatches,
      aspiration_matches: normalizedLimitedAspirationMatches,
      closest_matches: normalizedLimitedClosestMatches,
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
  if (payload.resumeTextForMatching?.trim()) {
    formData.append('resume_text_for_matching', payload.resumeTextForMatching.trim());
  }
  formData.append('confirmed_skills', JSON.stringify(confirmedSkills));
  if (payload.removedSkillIds) {
    formData.append('removed_skill_ids', JSON.stringify(normalizeSkillIds(payload.removedSkillIds)));
  }
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

  const { data: sessionData } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
  const accessToken = sessionData.session?.access_token;
  const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined;

  const response = await fetchBackend(
    `${API_BASE_URL}/api/matches/from-resume`,
    {
      method: 'POST',
      headers,
      body: formData,
    },
    'Analyzing resume and generating job matches timed out. The backend may still be starting up — please try again.',
    MATCHING_TIMEOUT_MS,
  );

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    const detail = getReadableMessage(errorBody?.detail || errorBody) || 'Job matching failed.';
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
  const normalizedClosestMatches = Array.isArray(rawResults.closest_matches)
    ? rawResults.closest_matches.map((item) => normalizeMatchItemPercentages(item, 'fit_now'))
    : [];
  const normalizedAllClosestMatches = Array.isArray(rawResults.all_closest_matches)
    ? rawResults.all_closest_matches.map((item) => normalizeMatchItemPercentages(item, 'fit_now'))
    : normalizedClosestMatches;
  const totalMatches = resolveTotalMatchCount([normalizedFitNowMatches, normalizedClosestMatches, normalizedAspirationMatches]);
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
  const normalizedLimitedClosestMatches = normalizeMatchList(rawResults.limited_report?.closest_matches, 'fit_now');
  const limitedClosestMatches = normalizedLimitedClosestMatches.length > 0
    ? normalizedLimitedClosestMatches
    : normalizedClosestMatches.slice(0, perTypeLimit);
  const limitedTotalMatches = resolveTotalMatchCount([limitedFitNowMatches, limitedClosestMatches, limitedAspirationMatches]);
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
    closest_matches: normalizedClosestMatches,
    all_closest_matches: normalizedAllClosestMatches,
    catalog_status: rawResults.catalog_status,
    recommendation_notice: rawResults.recommendation_notice,
    total_qualifying_matches: rawResults.total_qualifying_matches,
    total_skill_gap_count: rawResults.total_skill_gap_count,
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
      closest_matches: limitedClosestMatches,
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
      model_version: rawResults.metadata?.model_version || rawResults.model_used || 'fine-tuned MiniLM bi-encoder cosine similarity',
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
  } catch (error) {
    if (error instanceof Error && error.message.includes('timed out')) throw error;
    throw new Error('Cannot reach skill search backend. Check the configured API URL and run npm run dev to start the local backend.');
  }

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    throw new Error(getReadableMessage(errorBody?.detail || errorBody) || 'Skill search failed.');
  }

  const data = (await response.json()) as { results?: SkillSearchItem[] };
  return { results: Array.isArray(data.results) ? data.results : [] };
}

export async function fetchAvailableJobs(limit = 5000): Promise<{ results: AvailableJobItem[] }> {
  let response: Response;
  const safeLimit = Math.max(1, Math.min(limit, 5000));

  try {
    response = await fetchWithTimeout(
      `${API_BASE_URL}/api/jobs/list?limit=${safeLimit}`,
      {
        method: 'GET',
        cache: 'no-store',
      },
      'Job listing request timed out. Please try again.',
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes('timed out')) throw error;
    throw new Error('Cannot reach jobs listing backend. Check the configured API URL and run npm run dev to start the local backend.');
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
  } catch (error) {
    if (error instanceof Error && error.message.includes('timed out')) throw error;
    throw new Error('Cannot reach jobs detail backend. Check the configured API URL and run npm run dev to start the local backend.');
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
  } catch (error) {
    if (error instanceof Error && error.message.includes('timed out')) throw error;
    throw new Error('Cannot reach certificate validation backend. Check the configured API URL and run npm run dev to start the local backend.');
  }

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    throw new Error(getReadableMessage(errorBody?.detail || errorBody) || 'Certificate validation failed.');
  }

  const data = (await response.json()) as { status?: string; message?: string };
  return {
    status: data.status || 'invalid',
    message: data.message || 'PDF file checks passed. Credential verification is pending.',
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

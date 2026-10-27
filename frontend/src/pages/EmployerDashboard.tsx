import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { faBriefcase, faBuilding, faChartColumn, faComments, faHouse, faLayerGroup, faStar, faUsers } from '@fortawesome/free-solid-svg-icons';
import { AppShell, ConfirmDialog, DESKTOP_QUERY, EmptyState, FormField, SkeletonRows, ToastRegion, useMediaQuery, type NextStep, type ToastState } from '../components/ui';
import { loadApplicationMessages, loadEmployerAccountSettings, loadMessageModeration, requestAccountDeletion, saveEmployerAccountSettings, sendApplicationMessage, submitMessageModeration, updateEmployerApplicationStatus, type MessageModerationState, type MessageReportReason } from '../lib/api';
import { ReportConversationModal } from '../components/ReportConversationModal';
import { supabase } from '../lib/supabase';
import { normalizeEmployerIndustry } from '../lib/employerOptions';
import { joinLocation, splitLocation } from '../lib/phProvinces';
import { joinJobContent, toListItems } from '../lib/jobDescription';
import { applyAssessmentTemplate, deleteAssessmentTemplates, isEvaluationUnavailable, isTemplatesUnavailable, loadAssessmentTemplates, loadJobEvaluationSummaries, loadRubrics, rubricHasScorecards, saveAssessmentTemplate, saveRubric, type EvaluationSummary } from '../lib/evaluationApi';
import { loadAssessments, sendAssessment, type CandidateAssessment } from '../lib/assessmentApi';
import { ApplicantReviewModal } from './employer/ApplicantReviewModal';
import { AssessmentTemplatesPage, type JobsSection } from './employer/AssessmentTemplatesPage';
import { EmployerAccountPage, type EmployerAccountForm } from './employer/EmployerAccountPage';
import { EmployerCandidatesPage } from './employer/EmployerCandidatesPage';
import { RubricEditorModal } from './employer/RubricEditorModal';
import { candidateActionBlocker, combineTemplates, DEFAULT_CANDIDATE_FILTERS, validateRubricDraft, type AssessmentTemplate, HIGH_MATCH_PERCENT, profileMatch, visibleApplicants, type CandidateBulkAction, type CandidateFilters, type Rubric, type RubricCriterionDraft } from './employer/evaluation';
import { EmployerHomePage } from './employer/EmployerHomePage';
import { InsightsPage } from './employer/insights/InsightsPage';
import { EmployerJobsPage, type JobBulkAction } from './employer/EmployerJobsPage';
import type { BulkImportItem } from './employer/BulkJobUploadModal';
import { EmployerMessagesPage } from './employer/EmployerMessagesPage';
import { JobEditorPage } from './employer/JobEditorPage';
import { clearJobDraft, hasJobDraftContent, jobDraftKey, useStoredJobDraft, validateDraftSave, validateJobDraft, type JobEditorDraft } from './employer/jobDraft';
import {
  applicantTitle,
  daysUntil,
  EMPLOYER_PAGE_PATHS,
  employerJobEditorIdFromPath,
  employerJobEditorPath,
  employerJobIdFromPath,
  employerJobPath,
  employerPageFromPath,
  employerTemplateIdFromPath,
  employerTemplatePath,
  getCategoryCode,
  getInitials,
  parseSalaryInput,
  initialApplications,
  initialJobs,
  initialNotifications,
  JOB_POSTING_STATUS,
  REJECTION_REASONS,
  statusActionLabel,
  statusActionMessage,
  toCandidateApplication,
  toEmployerJob,
  toMessageEntry,
  todayIso,
  type ApplicationMessageRow,
  type CandidateApplication,
  type CandidateStatus,
  type EmployerJob,
  type EmployerJobPostRow,
  type EmployerPage,
  type JobApplicationRow,
  type JobStats,
  type JobStatus,
  type MessageEntry,
  type NotificationItem,
  type ReviewAction,
  type ToastType,
} from './employer/model';

type EmployerDashboardProps = {
  employer: { id?: string; name: string; email: string; company: string } | null;
  onHome: () => void;
  onLogin: () => void;
  onSignUp: () => void;
  onLogout?: () => void;
};

export default function EmployerDashboard({ employer, onHome, onLogin, onSignUp, onLogout }: EmployerDashboardProps) {
  if (!employer) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg px-4 py-16">
        <div className="k-card w-full max-w-md text-center">
          <h1 className="k-section-title">For employer accounts</h1>
          <p className="k-secondary mt-2">Sign in with an employer account to manage jobs and applicants.</p>
          <div className="k-button-row mt-5 justify-center">
            <button className="k-btn k-btn-primary" type="button" onClick={onLogin}>Sign in</button>
            <button className="k-btn k-btn-secondary" type="button" onClick={onSignUp}>Create an account</button>
          </div>
        </div>
      </main>
    );
  }

  return <EmployerWorkspace employer={employer} onHome={onHome} onLogout={onLogout} />;
}

const notificationIcon: Record<NotificationItem['type'], typeof faStar> = {
  match: faStar,
  app: faLayerGroup,
  msg: faComments,
  warn: faLayerGroup,
  job: faBriefcase,
};

function EmployerWorkspace({ employer, onHome, onLogout }: Pick<EmployerDashboardProps, 'onHome' | 'onLogout'> & { employer: NonNullable<EmployerDashboardProps['employer']> }) {
  const location = useLocation();
  const navigate = useNavigate();
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const activePage = employerPageFromPath(location.pathname);
  const [companyName, setCompanyName] = useState(employer.company || 'Employer Workspace');
  const contactName = employer.name || '';
  const [jobs, setJobs] = useState<EmployerJob[]>(initialJobs);
  const [jobsLoadStatus, setJobsLoadStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [applicationsLoadStatus, setApplicationsLoadStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [currentDate, setCurrentDate] = useState(todayIso);
  const [employerProfileId, setEmployerProfileId] = useState('');
  const [applications, setApplications] = useState<CandidateApplication[]>(initialApplications);
  const [notifications, setNotifications] = useState<NotificationItem[]>(initialNotifications);
  const [toast, setToast] = useState<ToastState>(null);
  const detailJobId = employerJobIdFromPath(location.pathname);
  // null outside the templates section, '' on its list, else a template id or 'new'.
  const templateRouteId = employerTemplateIdFromPath(location.pathname);
  const [templates, setTemplates] = useState<AssessmentTemplate[]>([]);
  const [templatesStatus, setTemplatesStatus] = useState<'loading' | 'ready' | 'error' | 'unavailable'>('loading');
  // null outside the job editor, '' for a new posting, else the job being edited.
  const jobEditorId = employerJobEditorIdFromPath(location.pathname);
  const editorJob = jobEditorId ? jobs.find((job) => job.id === jobEditorId) || null : null;
  // An unposted new job kept on this device, so the Jobs page can offer to continue it.
  const newJobDraftKey = jobDraftKey(employer.id || '');
  const storedNewJobDraft = useStoredJobDraft(newJobDraftKey);
  const newJobDraft = storedNewJobDraft && hasJobDraftContent(storedNewJobDraft) ? { title: storedNewJobDraft.form.title.trim(), savedAt: storedNewJobDraft.savedAt } : null;
  const [rawCandidateFilters, setCandidateFilters] = useState<CandidateFilters>(DEFAULT_CANDIDATE_FILTERS);
  const [rubrics, setRubrics] = useState<Rubric[]>([]);
  const [evaluationUnavailable, setEvaluationUnavailable] = useState(false);
  const [summaryState, setSummaryState] = useState<{ jobPostId: string; rows: Map<string, EvaluationSummary> }>({ jobPostId: '', rows: new Map() });
  const [summaryVersion, setSummaryVersion] = useState(0);
  const [assessments, setAssessments] = useState<Map<string, CandidateAssessment>>(new Map());
  const [assessmentVersion, setAssessmentVersion] = useState(0);
  // afterPosting: opened right after a job was posted, so closing it means the employer skipped the step.
  const [rubricEditor, setRubricEditor] = useState<{ jobId: string; inUse: boolean; afterPosting?: boolean } | null>(null);
  const [isSavingRubric, setIsSavingRubric] = useState(false);
  const [selectedThreadId, setSelectedThreadId] = useState<string>('');
  const [messageDraft, setMessageDraft] = useState('');
  const [draftRequestCandidateId, setDraftRequestCandidateId] = useState<string>('');
  // Report and block state per application thread, as the backend returns it.
  const [messageModeration, setMessageModeration] = useState<Record<string, MessageModerationState>>({});
  const [messageLoadError, setMessageLoadError] = useState('');
  const [reportTarget, setReportTarget] = useState<CandidateApplication | null>(null);
  const [blockTarget, setBlockTarget] = useState<CandidateApplication | null>(null);
  const [reviewModalId, setReviewModalId] = useState<string | null>(null);
  const [confirmModal, setConfirmModal] = useState<{ open: boolean; action: ReviewAction | null; candidateId: string | null }>({
    open: false,
    action: null,
    candidateId: null,
  });
  const [rejectionReason, setRejectionReason] = useState('');
  const [deleteProfileModalOpen, setDeleteProfileModalOpen] = useState(false);
  const [accountProfile, setAccountProfile] = useState<EmployerAccountForm>({
    company: companyName,
    industry: '',
    size: '',
    city: '',
    province: '',
    website: '',
    about: '',
    contactPerson: contactName,
    contactRole: '',
    contactEmail: employer.email,
    contactNumber: '',
  });
  const [isSavingAccount, setIsSavingAccount] = useState(false);
  // New postings start at the company's location, so the editor waits for the profile.
  const [accountLoaded, setAccountLoaded] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ current: '', next: '', confirm: '' });
  const toastTimerRef = useRef<number | null>(null);

  const unreadCount = useMemo(() => notifications.filter((item) => item.unread).length, [notifications]);

  useEffect(() => {
    if (!employer.id) return;
    let mounted = true;
    const refresh = async () => {
      const { data, error } = await supabase.from('candidate_notifications')
        .select('id,title,message,created_at,read_at')
        .eq('recipient_user_id', employer.id)
        .eq('event_type', 'candidate_assessment_submitted')
        .order('created_at', { ascending: false })
        .limit(30);
      if (error || !mounted) return;
      const assessmentNotices: NotificationItem[] = (data || []).map((row) => ({
        id: `assessment-${row.id}`, title: row.title, message: row.message,
        time: new Date(row.created_at).toLocaleString(), type: 'app', unread: !row.read_at,
      }));
      setNotifications((current) => [...assessmentNotices, ...current.filter((row) => !row.id.startsWith('assessment-'))]);
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10000);
    return () => { mounted = false; window.clearInterval(timer); };
  }, [employer.id]);


  const showToast = (message: string, type: ToastType = '', action?: { label: string; onClick: () => void }) => {
    if (!message) return;
    setToast({ message, type, action });
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 4000);
  };

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  const goPage = useCallback((page: EmployerPage) => {
    if (EMPLOYER_PAGE_PATHS[page] !== location.pathname) navigate(EMPLOYER_PAGE_PATHS[page]);
    window.scrollTo({ top: 0 });
  }, [location.pathname, navigate]);

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentDate(todayIso()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let isMounted = true;
    const loadSettings = async () => {
      try {
        const saved = await loadEmployerAccountSettings();
        if (!isMounted) return;
        setAccountProfile({
          company: saved.company_name || companyName,
          industry: normalizeEmployerIndustry(saved.industry),
          size: saved.company_size || '',
          ...splitLocation(saved.company_location),
          website: saved.company_website || '',
          about: saved.company_description || '',
          contactPerson: saved.contact_person_name || contactName,
          contactRole: saved.contact_role || '',
          contactEmail: saved.account_email || saved.business_email || employer.email,
          contactNumber: saved.contact_number || '',
        });
        if (saved.company_name) setCompanyName(saved.company_name);
      } catch (error) {
        if (isMounted) showToast(error instanceof Error ? error.message : 'Unable to load account settings.', 'warn');
      } finally {
        if (isMounted) setAccountLoaded(true);
      }
    };
    void loadSettings();
    return () => { isMounted = false; };
  }, [employer.id]);

  // Company and contact details save together; the API accepts both in one PATCH.
  const saveAccountProfile = async () => {
    if (!accountProfile.company.trim()) {
      showToast('Company name is required.', 'warn');
      return;
    }
    setIsSavingAccount(true);
    try {
      const saved = await saveEmployerAccountSettings({
        company_name: accountProfile.company,
        industry: accountProfile.industry,
        company_size: accountProfile.size,
        company_location: joinLocation(accountProfile.city, accountProfile.province),
        company_website: accountProfile.website,
        company_description: accountProfile.about,
        contact_person_name: accountProfile.contactPerson,
        contact_role: accountProfile.contactRole,
        business_email: accountProfile.contactEmail,
        account_email: accountProfile.contactEmail,
        first_name: accountProfile.contactPerson.trim().split(/\s+/)[0] || '',
        last_name: accountProfile.contactPerson.trim().split(/\s+/).slice(1).join(' '),
        contact_number: accountProfile.contactNumber,
      });
      setCompanyName(saved.company_name || accountProfile.company.trim());
      showToast('Company profile saved.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to save company profile.', 'danger');
    } finally {
      setIsSavingAccount(false);
    }
  };

  const updatePassword = async () => {
    if (!passwordForm.current || !passwordForm.next || passwordForm.next !== passwordForm.confirm) {
      showToast(passwordForm.next !== passwordForm.confirm ? 'New passwords do not match.' : 'Complete all password fields.', 'warn');
      return;
    }
    if (passwordForm.next.length < 8) {
      showToast('New password must be at least 8 characters.', 'warn');
      return;
    }
    setIsSavingAccount(true);
    try {
      const { error: verifyError } = await supabase.auth.signInWithPassword({ email: employer.email, password: passwordForm.current });
      if (verifyError) throw new Error('Current password is incorrect.');
      const { error } = await supabase.auth.updateUser({ password: passwordForm.next });
      if (error) throw error;
      setPasswordForm({ current: '', next: '', confirm: '' });
      showToast('Password updated.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to update password.', 'danger');
    } finally {
      setIsSavingAccount(false);
    }
  };

  const jobMap = useMemo(() => new Map(jobs.map((job) => [job.id, job])), [jobs]);

  const jobStats = useMemo(() => {
    return new Map<string, JobStats>(
      jobs.map((job) => {
        const candidates = applications.filter((candidate) => candidate.jobId === job.id);
        const count = (statuses: CandidateStatus[]) => candidates.filter((candidate) => statuses.includes(candidate.status)).length;
        return [job.id, {
          applications: candidates.length,
          pending: count(['Pending']),
          inReview: count(['Shortlisted', 'Interviewing']),
          closed: count(['Hired', 'Rejected', 'Withdrawn']),
        }];
      }),
    );
  }, [applications, jobs]);

  const messageThreads = useMemo(() => {
    return applications.filter(
      (candidate) =>
        (candidate.status === 'Interviewing' || candidate.status === 'Hired') &&
        (
          candidate.messageRequestState === 'accepted'
          || candidate.messageRequestState === 'pending'
          || candidate.id === draftRequestCandidateId
        ),
    );
  }, [applications, draftRequestCandidateId]);

  // Desktop shows the first conversation until another is picked.
  const selectedThreadCandidate = messageThreads.find((candidate) => candidate.id === selectedThreadId) || (isDesktop ? messageThreads[0] || null : null);
  const isDraftRequestThread = Boolean(selectedThreadCandidate && selectedThreadCandidate.id === draftRequestCandidateId && selectedThreadCandidate.messageRequestState === 'none');
  // A draft request has no thread yet, so there is nothing to report or block.
  const selectedThreadHasThread = Boolean(selectedThreadCandidate && !isDraftRequestThread);
  const selectedModeration = selectedThreadCandidate ? messageModeration[selectedThreadCandidate.id] : undefined;
  const canSendMessage = (selectedThreadCandidate?.messageRequestState === 'accepted' || isDraftRequestThread) && !selectedModeration?.blocked;

  const reviewCandidate = applications.find((candidate) => candidate.id === reviewModalId) || null;
  const reviewJob = reviewCandidate ? jobMap.get(reviewCandidate.jobId) || null : null;

  // Rubric versions per job (newest first), keyed by the public job id.
  const rubricsByJob = useMemo(() => {
    const byPostId = new Map(jobs.map((job) => [job.databaseId || '', job.id]));
    const result = new Map<string, Rubric[]>();
    rubrics.forEach((rubric) => {
      const jobId = byPostId.get(rubric.jobPostId);
      if (!jobId) return;
      result.set(jobId, [...(result.get(jobId) || []), rubric].sort((left, right) => right.version - left.version));
    });
    return result;
  }, [jobs, rubrics]);
  const latestRubrics = useMemo(() => new Map(Array.from(rubricsByJob.entries()).map(([jobId, list]) => [jobId, list[0]])), [rubricsByJob]);
  const templateUsage = useMemo(() => {
    const usage = new Map<string, number>();
    latestRubrics.forEach((rubric) => { if (rubric.templateId) usage.set(rubric.templateId, (usage.get(rubric.templateId) || 0) + 1); });
    return usage;
  }, [latestRubrics]);
  const describeJobAssessment = (job: EmployerJob) => {
    const rubric = latestRubrics.get(job.id);
    if (!rubric) return 'No assessment yet';
    const template = templates.find((item) => item.id === rubric.templateId);
    return template ? `Uses ${template.name}` : 'Own assessment';
  };

  const refreshTemplates = useCallback(() => loadAssessmentTemplates()
    .then((rows) => { setTemplates(rows); setTemplatesStatus('ready'); })
    .catch((error: unknown) => {
      console.warn('Unable to load assessment templates:', error);
      setTemplatesStatus(isTemplatesUnavailable(error) ? 'unavailable' : 'error');
    }), []);
  useEffect(() => {
    if (!employerProfileId) return;
    let isMounted = true;
    loadAssessmentTemplates()
      .then((rows) => { if (isMounted) { setTemplates(rows); setTemplatesStatus('ready'); } })
      .catch((error: unknown) => {
        console.warn('Unable to load assessment templates:', error);
        if (isMounted) setTemplatesStatus(isTemplatesUnavailable(error) ? 'unavailable' : 'error');
      });
    return () => { isMounted = false; };
  }, [employerProfileId]);

  // Templates load once the employer profile is known; an account without one has none.
  const effectiveTemplatesStatus = templatesStatus === 'loading' && !employerProfileId && jobsLoadStatus !== 'loading'
    ? (jobsLoadStatus === 'error' ? 'error' : 'ready')
    : templatesStatus;

  const rubricVersions = useMemo(() => new Map(Array.from(rubricsByJob.entries()).map(([jobId, list]) => [jobId, list[0].version])), [rubricsByJob]);

  // The Candidates page always shows one job; start with the one with the most waiting applicants.
  const defaultCandidateJobId = useMemo(() => {
    const pendingCount = (jobId: string) => applications.filter((candidate) => candidate.jobId === jobId && candidate.status === 'Pending').length;
    const total = (jobId: string) => applications.filter((candidate) => candidate.jobId === jobId).length;
    return [...jobs].sort((left, right) => pendingCount(right.id) - pendingCount(left.id) || total(right.id) - total(left.id))[0]?.id || '';
  }, [jobs, applications]);
  const candidateFilters = useMemo<CandidateFilters>(() => (
    rawCandidateFilters.jobId && jobMap.has(rawCandidateFilters.jobId) ? rawCandidateFilters : { ...rawCandidateFilters, jobId: defaultCandidateJobId }
  ), [rawCandidateFilters, jobMap, defaultCandidateJobId]);

  useEffect(() => {
    let isMounted = true;
    const postIds = jobs.map((job) => job.databaseId).filter((id): id is string => Boolean(id));
    if (postIds.length === 0) return;
    loadRubrics(postIds)
      .then((rows) => { if (isMounted) { setRubrics(rows); setEvaluationUnavailable(false); } })
      .catch((error) => {
        console.warn('Unable to load evaluation rubrics:', error);
        if (isMounted && isEvaluationUnavailable(error)) setEvaluationUnavailable(true);
      });
    return () => { isMounted = false; };
  }, [jobs]);

  const filterJobPostId = jobMap.get(candidateFilters.jobId)?.databaseId || '';
  useEffect(() => {
    let isMounted = true;
    if (!filterJobPostId || evaluationUnavailable) return;
    loadJobEvaluationSummaries(filterJobPostId)
      .then((rows) => { if (isMounted) setSummaryState({ jobPostId: filterJobPostId, rows }); })
      .catch((error) => {
        console.warn('Unable to load evaluation summaries:', error);
        if (isMounted && isEvaluationUnavailable(error)) setEvaluationUnavailable(true);
      });
    return () => { isMounted = false; };
  }, [filterJobPostId, evaluationUnavailable, summaryVersion, rubrics]);

  const summaries = useMemo(() => (summaryState.jobPostId === filterJobPostId && !evaluationUnavailable ? summaryState.rows : new Map<string, EvaluationSummary>()), [summaryState, filterJobPostId, evaluationUnavailable]);
  const reviewList = useMemo(() => visibleApplicants(applications, jobs, candidateFilters, summaries), [applications, jobs, candidateFilters, summaries]);
  const reviewIndex = reviewCandidate ? reviewList.findIndex((candidate) => candidate.id === reviewCandidate.id) : -1;

  useEffect(() => {
    let isMounted = true;

    const loadEmployerJobs = async () => {
      if (!employer.id) return;

      const { data: profile, error: profileError } = await supabase
        .from('employer_profiles')
        .select('id')
        .eq('user_id', employer.id)
        .maybeSingle();

      if (profileError) {
        console.warn('Unable to load employer profile:', profileError);
        if (isMounted) { setJobsLoadStatus('error'); showToast('Unable to load your employer profile.', 'warn'); }
        return;
      }

      const profileId = profile?.id ? String(profile.id) : '';
      if (!profileId) { if (isMounted) setJobsLoadStatus('ready'); return; }
      if (isMounted) setEmployerProfileId(profileId);

      const { data, error } = await supabase
        .from('employer_job_posts')
        .select('*')
        .eq('employer_id', profileId)
        .order('created_at', { ascending: false });

      if (error) {
        console.warn('Unable to load employer job posts:', error);
        if (isMounted) { setJobsLoadStatus('error'); showToast('Unable to load your saved jobs.', 'warn'); }
        return;
      }

      if (!isMounted) return;
      const expiredJobIds = (data || [])
        .filter((row) => row.application_deadline && row.application_deadline <= currentDate && ['active', 'open'].includes(String(row.posting_status)))
        .map((row) => row.job_id);
      if (expiredJobIds.length > 0) {
        const { error: closeError } = await supabase
          .from('employer_job_posts')
          .update({ posting_status: 'closed', updated_at: new Date().toISOString() })
          .in('job_id', expiredJobIds);
        if (closeError) console.warn('Unable to persist expired job statuses:', closeError);
      }
      if (!isMounted) return;
      const savedJobs = Array.isArray(data) ? (data as EmployerJobPostRow[]).map(toEmployerJob) : [];
      setJobs(savedJobs);
      setJobsLoadStatus('ready');
    };

    void loadEmployerJobs();

    return () => {
      isMounted = false;
    };
  }, [employer.id, currentDate]);

  useEffect(() => {
    const expiredOpenJobs = jobs.filter((job) => job.status === 'open' && job.deadline && job.deadline <= currentDate);
    if (expiredOpenJobs.length === 0) return;
    setJobs((current) => current.map((job) => expiredOpenJobs.some((expired) => expired.id === job.id) ? { ...job, status: 'closed' } : job));
    void Promise.all(expiredOpenJobs.map((job) => supabase
      .from('employer_job_posts')
      .update({ posting_status: 'closed', updated_at: new Date().toISOString() })
      .eq('job_id', job.id)));
  }, [jobs, currentDate]);

  useEffect(() => {
    let isMounted = true;

    const loadJobApplications = async () => {
      const jobIds = Array.from(new Set(jobs.map((job) => job.id).filter(Boolean)));
      if (jobIds.length === 0) {
        setApplications([]);
        setApplicationsLoadStatus(jobsLoadStatus);
        return;
      }

      const { data, error } = await supabase
        .from('job_applications')
        .select('*')
        .in('job_id', jobIds)
        .order('applied_at', { ascending: false });

      if (error) {
        console.warn('Unable to load job applications:', error);
        if (isMounted) { setApplicationsLoadStatus('error'); showToast('Unable to load applicants.', 'warn'); }
        return;
      }

      if (!isMounted) return;
      const rows = Array.isArray(data) ? (data as JobApplicationRow[]) : [];
      const applicationIds = rows.map((row) => row.id).filter(Boolean);
      const { data: publicIdData, error: publicIdError } = await supabase.rpc('get_employer_applicant_public_ids');
      if (publicIdError) console.warn('Unable to load candidate public IDs:', publicIdError);
      const publicIdsByApplication = new Map<string, string>(
        (Array.isArray(publicIdData) ? publicIdData : []).map((row) => [String(row.application_id), String(row.public_id || '')]),
      );
      // Only conversations the Messages page lists have an open thread to read:
      // a message request was sent, and the applicant is Interviewing or Hired.
      const threadApplicationIds = new Set(rows
        .filter((row) => ['interviewing', 'hired'].includes(String(row.status || '').toLowerCase()))
        .filter((row) => row.message_request_state === 'pending' || row.message_request_state === 'accepted')
        .map((row) => row.id));
      const messageResults = await Promise.all(applicationIds.filter((id) => threadApplicationIds.has(id)).map(async (applicationId) => {
        try {
          return { applicationId, messages: await loadApplicationMessages(applicationId), failed: false };
        } catch (error) {
          console.warn('Unable to load messages:', error);
          return { applicationId, messages: [], failed: true };
        }
      }));
      const failedMessageIds = new Set(messageResults.filter((result) => result.failed).map((result) => result.applicationId));
      const messagesByApplication = new Map<string, ApplicationMessageRow[]>(messageResults.filter((result) => !result.failed).map(({ applicationId, messages }) => [
        applicationId,
        messages.map((message) => ({
          id: message.id || `${applicationId}-${message.created_at || ''}`,
          application_id: applicationId,
          sender_user_id: '',
          sender_role: message.sender_role,
          message_kind: message.message_kind,
          message_text: message.message_text,
          created_at: message.created_at || null,
        })),
      ]));

      if (!isMounted) return;
      setApplications((current) => rows.map((row) => {
        const next = toCandidateApplication(row, jobs, messagesByApplication.get(row.id) || [], publicIdsByApplication.get(row.id) || '');
        // A failed refresh keeps this conversation as last loaded instead of emptying it.
        const previous = failedMessageIds.has(row.id) ? current.find((candidate) => candidate.id === row.id) : undefined;
        return previous ? { ...next, messages: previous.messages } : next;
      }));
      setMessageLoadError(failedMessageIds.size > 0 ? 'Some messages could not be loaded. Showing what loaded last; Kareerly keeps retrying.' : '');
      setApplicationsLoadStatus('ready');
    };

    void loadJobApplications();
    const refreshTimer = window.setInterval(() => void loadJobApplications(), 5000);

    return () => {
      isMounted = false;
      window.clearInterval(refreshTimer);
    };
  }, [jobs, jobsLoadStatus]);

  // Candidate Assessments for every applicant: the Candidates list, Home and
  // bulk actions all read the same copy. Candidates answer on their side, so poll.
  const applicationIdsKey = useMemo(() => applications.map((candidate) => candidate.id).sort().join(','), [applications]);
  useEffect(() => {
    let isMounted = true;
    const ids = applicationIdsKey ? applicationIdsKey.split(',') : [];
    const refresh = () => void loadAssessments(ids)
      .then((rows) => { if (isMounted) setAssessments(rows); })
      .catch((error) => console.warn('Unable to load candidate assessments:', error));
    refresh();
    const timer = window.setInterval(refresh, 10000);
    return () => { isMounted = false; window.clearInterval(timer); };
  }, [applicationIdsKey, assessmentVersion]);

  const markNotificationsRead = () => {
    const ids = notifications.filter((item) => item.id.startsWith('assessment-') && item.unread).map((item) => item.id.slice('assessment-'.length));
    if (ids.length) void supabase.from('candidate_notifications').update({ read_at: new Date().toISOString() }).in('id', ids);
    setNotifications((current) => current.map((item) => ({ ...item, unread: false })));
  };

  const startEditJobForm = (job: EmployerJob) => {
    navigate(employerJobEditorPath(job.id));
    window.scrollTo({ top: 0 });
  };

  const leaveJobEditor = () => {
    navigate(jobEditorId ? employerJobPath(jobEditorId) : EMPLOYER_PAGE_PATHS.jobs);
    window.scrollTo({ top: 0 });
  };

  /** The employer_job_posts row for a job draft. */
  const jobPostPayload = (draft: JobEditorDraft, status: JobStatus, jobId: string) => {
    const { form: jobForm } = draft;
    const location = joinLocation(jobForm.city, jobForm.province);
    const { minimum: salaryMinPhp, maximum: salaryMaxPhp } = parseSalaryInput(jobForm.salaryRange);
    const postingStatus = status === 'open' ? 'active' : status;
    return {
      job_id: jobId,
      employer_id: employerProfileId,
      category_code: getCategoryCode(jobForm.category),
      category_name: jobForm.category,
      job_subcategory: jobForm.subcategory,
      job_title: jobForm.title.trim(),
      company_name: accountProfile.company.trim() || companyName,
      location,
      work_setup: jobForm.workSetup,
      employment_type: jobForm.employmentType.trim() || null,
      job_level: jobForm.experienceLevel,
      // A draft can leave these empty.
      salary_min_php: salaryMinPhp || null,
      salary_max_php: salaryMaxPhp || null,
      job_description: joinJobContent(jobForm.description, jobForm.responsibilities, jobForm.qualifications),
      responsibilities: toListItems(jobForm.responsibilities).join('\n'),
      qualifications: toListItems(jobForm.qualifications).join('\n'),
      required_skills: draft.requiredSkills.join(', '),
      preferred_skills: draft.niceSkills.join(', '),
      must_have_skill_ids: '',
      application_deadline: jobForm.deadline || null,
      posting_status: postingStatus,
      updated_at: new Date().toISOString(),
    };
  };

  /**
   * Saves job rows. Columns added by later migrations are dropped while a
   * database is still missing one: the description text carries the same content.
   */
  const upsertJobPosts = async (payloads: Array<ReturnType<typeof jobPostPayload>>) => {
    const optionalColumns = ['responsibilities', 'qualifications', 'job_subcategory'] as const;
    let attempt: Array<Partial<ReturnType<typeof jobPostPayload>>> = payloads;
    let result = await supabase.from('employer_job_posts').upsert(attempt, { onConflict: 'job_id' }).select('*');
    for (let retries = 0; result.error && retries < optionalColumns.length; retries += 1) {
      const message = String(result.error.message || '');
      const missing = optionalColumns.find((column) => column in (attempt[0] || {}) && message.includes(column));
      if (!missing) break;
      attempt = attempt.map((row) => {
        const next = { ...row };
        delete next[missing];
        return next;
      });
      result = await supabase.from('employer_job_posts').upsert(attempt, { onConflict: 'job_id' }).select('*');
    }
    return { data: (result.data || []) as EmployerJobPostRow[], error: result.error as { message: string } | null };
  };

  /** Saves the editor's job; resolves with what blocked it, or null once saved. */
  const saveJobForm = async (mode: 'draft' | 'post', draft: JobEditorDraft): Promise<string | null> => {
    const error = mode === 'draft' ? validateDraftSave(draft) : validateJobDraft(draft);
    if (error) return error;
    if (!employerProfileId) return 'Your employer profile is still loading. Try again in a moment.';
    const { form: jobForm } = draft;
    const status: JobStatus = mode === 'draft' ? 'draft' : jobForm.status === 'closed' ? 'closed' : 'open';
    const currentJob = editorJob;
    const jobId = currentJob?.id || `EMP-${Date.now()}`;
    const payload = jobPostPayload(draft, status, jobId);

    const { data: savedPost, error: upsertError } = await upsertJobPosts([payload]);
    const saveError = upsertError || (savedPost.length === 0 ? { message: 'No row returned' } : null);

    if (saveError) {
      console.warn('Unable to save job post:', saveError);
      return "The job couldn't be saved. Please try again.";
    }

    const savedJob = toEmployerJob(savedPost[0]);

    if (currentJob) {
      setJobs((current) =>
        current.map((job) =>
          job.id === currentJob.id
            ? {
                ...savedJob,
                deadline: jobForm.deadline,
              }
            : job,
        ),
      );
      showToast(mode === 'draft' ? 'Draft saved.' : 'Job updated.', 'success');
      navigate(employerJobPath(currentJob.id), { replace: true });
    } else {
      const newJob: EmployerJob = { ...savedJob, deadline: jobForm.deadline };
      setJobs((current) => [newJob, ...current]);
      showToast(mode === 'draft' ? 'Saved as a draft.' : 'Job posted.', 'success');
      navigate(employerJobPath(newJob.id), { replace: true });
      if (newJob.databaseId) setRubricEditor({ jobId: newJob.id, inUse: false, afterPosting: true });
    }
    window.scrollTo({ top: 0 });
    return null;
  };

  /** Saves jobs from an uploaded file in one go; resolves true once saved. */
  const importJobs = async (items: BulkImportItem[]): Promise<boolean> => {
    if (items.length === 0) return false;
    if (!employerProfileId) {
      showToast('Your employer profile is still loading. Try again in a moment.', 'warn');
      return false;
    }
    // Checked again here so nothing incomplete is ever posted.
    const prepared = items.map((item) => ({
      draft: item.draft,
      status: (item.mode === 'post' && !validateJobDraft(item.draft) ? 'open' : 'draft') as JobStatus,
    })).filter((item) => !validateDraftSave(item.draft));
    if (prepared.length === 0) return false;
    const stamp = Date.now();
    const payloads = prepared.map((item, index) => jobPostPayload(item.draft, item.status, `EMP-${stamp}-${index + 1}`));
    const { data, error } = await upsertJobPosts(payloads);
    if (error) {
      console.warn('Unable to import jobs:', error);
      showToast("The jobs couldn't be saved. Nothing was added. Please try again.", 'danger');
      return false;
    }
    const order = new Map(payloads.map((payload, index) => [payload.job_id, index]));
    const saved = data.map(toEmployerJob).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    setJobs((current) => [...saved, ...current.filter((job) => !order.has(job.id))]);
    const posted = saved.filter((job) => job.status === 'open').length;
    const drafts = saved.length - posted;
    const parts = [posted > 0 ? `${posted} job${posted === 1 ? '' : 's'} posted` : '', drafts > 0 ? `${drafts} saved as draft${drafts === 1 ? '' : 's'}` : ''].filter(Boolean);
    showToast(`${parts.join(', ')}.`.replace(/^./, (letter) => letter.toUpperCase()), saved.length === payloads.length ? 'success' : 'warn');
    return true;
  };

  const bulkJobAction = async (action: JobBulkAction, jobIds: string[]) => {
    if (jobIds.length === 0) return;
    const now = new Date().toISOString();
    if (action === 'delete') {
      const { data, error } = await supabase.from('employer_job_posts').delete().in('job_id', jobIds).select('job_id');
      if (error) {
        console.warn('Unable to delete jobs:', error);
        showToast('Unable to delete the selected jobs. Please try again.', 'danger');
        return;
      }
      const deleted = new Set((data || []).map((row) => String(row.job_id)));
      setJobs((current) => current.filter((job) => !deleted.has(job.id)));
      showToast(`${deleted.size} job${deleted.size === 1 ? '' : 's'} deleted.`, deleted.size === jobIds.length ? 'success' : 'warn');
      return;
    }
    const nextStatus: JobStatus = action === 'open' ? 'open' : action === 'close' ? 'closed' : 'archived';
    const { data, error } = await supabase
      .from('employer_job_posts')
      .update({ posting_status: JOB_POSTING_STATUS[nextStatus], updated_at: now })
      .in('job_id', jobIds)
      .select('job_id');
    if (error) {
      console.warn('Unable to update job status:', error);
      showToast('Unable to update the selected jobs. Please try again.', 'danger');
      return;
    }
    const updated = new Set((data || []).map((row) => String(row.job_id)));
    setJobs((current) => current.map((job) => (updated.has(job.id) ? { ...job, status: nextStatus } : job)));
    const verb = { open: 'opened', close: 'closed', archive: 'archived' }[action];
    const detail = action === 'close' ? ' They no longer take applications.' : action === 'archive' ? ' They are hidden from candidates.' : '';
    showToast(`${updated.size} job${updated.size === 1 ? '' : 's'} ${verb}.${detail}`, updated.size === jobIds.length ? 'success' : 'warn');
  };

  const reloadRubrics = async () => {
    const postIds = jobs.map((item) => item.databaseId).filter((id): id is string => Boolean(id));
    setRubrics(await loadRubrics(postIds));
    setSummaryVersion((value) => value + 1);
  };

  const saveTemplate = async (draft: { id?: string; name: string; description: string; criteria: RubricCriterionDraft[] }): Promise<string | null> => {
    try {
      const id = await saveAssessmentTemplate({ ...draft, employerProfileId });
      await refreshTemplates();
      showToast(draft.id ? 'Template saved. Jobs already using it keep their questions until you apply it again.' : 'Template saved.', 'success');
      if (!draft.id) navigate(employerTemplatePath(id), { replace: true });
      return id;
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to save the template.', 'danger');
      return null;
    }
  };

  const deleteTemplates = async (ids: string[]) => {
    try {
      const count = await deleteAssessmentTemplates(ids);
      await refreshTemplates();
      showToast(`${count} template${count === 1 ? '' : 's'} deleted. Jobs keep their questions.`, 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to delete the templates.', 'danger');
    }
  };

  /** One template is applied as itself; several are combined into one assessment first. */
  const applyTemplates = async (templateIds: string[], jobIds: string[]): Promise<boolean> => {
    const chosen = templateIds.map((id) => templates.find((item) => item.id === id)).filter((item): item is AssessmentTemplate => Boolean(item));
    const postIds = jobIds.map((id) => jobMap.get(id)?.databaseId).filter((id): id is string => Boolean(id));
    if (chosen.length === 0 || postIds.length === 0) {
      showToast('Choose at least one template and one saved job.', 'warn');
      return false;
    }
    try {
      if (chosen.length === 1) {
        await applyAssessmentTemplate(chosen[0].id, postIds);
      } else {
        const combined = combineTemplates(chosen);
        const problem = validateRubricDraft(combined);
        if (problem) throw new Error(problem);
        for (const postId of postIds) await saveRubric(postId, combined);
      }
      await reloadRubrics();
      const what = chosen.length === 1 ? chosen[0].name : `${chosen.length} combined templates`;
      showToast(`${what} applied to ${postIds.length} job${postIds.length === 1 ? '' : 's'}. Shortlisted applicants will receive these questions.`, 'success');
      return true;
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to apply the assessment.', 'danger');
      await reloadRubrics().catch(() => undefined);
      return false;
    }
  };

  const openJobsSection = (section: JobsSection) => {
    navigate(section === 'templates' ? employerTemplatePath() : EMPLOYER_PAGE_PATHS.jobs);
    window.scrollTo({ top: 0 });
  };

  const openReview = (candidateId: string) => {
    const candidate = applications.find((item) => item.id === candidateId);
    // Reviews always happen inside one job's list, so moving between applicants stays within that job.
    if (candidate && candidate.jobId !== candidateFilters.jobId) {
      setCandidateFilters((current) => ({ ...current, jobId: candidate.jobId, status: 'all', search: '', highMatch: false }));
    }
    setReviewModalId(candidateId);
  };

  const openRubricEditor = async (jobId: string) => {
    const latest = rubricsByJob.get(jobId)?.[0] || null;
    let inUse = false;
    if (latest) {
      try {
        inUse = await rubricHasScorecards(latest.id);
      } catch (error) {
        showToast(error instanceof Error ? error.message : 'Unable to open the rubric.', 'danger');
        return;
      }
    }
    setRubricEditor({ jobId, inUse });
  };

  const saveRubricDraft = async (criteria: RubricCriterionDraft[], templateName: string) => {
    const job = rubricEditor ? jobMap.get(rubricEditor.jobId) : null;
    if (!job?.databaseId) return;
    setIsSavingRubric(true);
    try {
      await saveRubric(job.databaseId, criteria);
      if (templateName) {
        try {
          await saveAssessmentTemplate({ employerProfileId, name: templateName, description: `Saved from ${job.title}.`, criteria });
          await refreshTemplates();
        } catch (error) {
          showToast(`Assessment saved, but not as a template: ${error instanceof Error ? error.message : 'try again from Assessment templates.'}`, 'warn');
        }
      }
      const postIds = jobs.map((item) => item.databaseId).filter((id): id is string => Boolean(id));
      setRubrics(await loadRubrics(postIds));
      setSummaryVersion((value) => value + 1);
      showToast(rubricEditor?.inUse ? 'Saved as a new rubric version. Earlier scorecards keep their version.' : 'Rubric saved.', 'success');
      setRubricEditor(null);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to save the rubric.', 'danger');
    } finally {
      setIsSavingRubric(false);
    }
  };

  const closeReview = () => {
    setReviewModalId(null);
  };

  const openConfirmStatus = (action: ReviewAction, candidateId: string) => {
    setRejectionReason('');
    setConfirmModal({ open: true, action, candidateId });
  };

  const closeConfirm = () => {
    setRejectionReason('');
    setConfirmModal({ open: false, action: null, candidateId: null });
  };

  const applyStatusChange = async () => {
    if (!confirmModal.action || !confirmModal.candidateId) return;
    const nextStatus: CandidateStatus =
      confirmModal.action === 'shortlisted'
        ? 'Shortlisted'
        : confirmModal.action === 'interviewing'
          ? 'Interviewing'
          : confirmModal.action === 'hired'
            ? 'Hired'
            : 'Rejected';
    const dbStatus = nextStatus.toLowerCase();
    if (nextStatus === 'Rejected' && !rejectionReason) {
      showToast('Please select a short rejection reason.', 'warn');
      return;
    }
    try {
      await updateEmployerApplicationStatus({ applicationId: confirmModal.candidateId, status: dbStatus, rejectionReason });
    } catch (error) {
      console.warn('Unable to update application status:', error);
      showToast(error instanceof Error ? error.message : 'Unable to update applicant status.', 'danger');
      return;
    }

    const target = applications.find((candidate) => candidate.id === confirmModal.candidateId);
    const label = target?.publicId || 'Applicant';
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
    closeConfirm();
    setSummaryVersion((value) => value + 1);
    if (nextStatus === 'Interviewing') {
      showToast(`${label} moved to Interviewing. You can now send a message request.`, 'success');
    } else if (nextStatus === 'Shortlisted' && target && rubricsByJob.has(target.jobId)) {
      // Shortlisting is when the Candidate Assessment goes out.
      const { sent, errors } = await sendAssessments([target.id]);
      if (sent > 0) showToast(`${label} shortlisted and sent the Candidate Assessment.`, 'success');
      else showToast(`${label} shortlisted, but the assessment wasn't sent: ${errors[0] || 'try Send Assessment again.'}`, 'warn');
    } else if (nextStatus === 'Shortlisted') {
      showToast(`${label} shortlisted. Set up this job's assessment to send it to them.`, 'warn');
    } else {
      showToast(`${label} moved to ${nextStatus}.`, 'success');
    }
  };

  /** Sends the Candidate Assessment to each applicant; returns how many went out and why others didn't. */
  const sendAssessments = async (candidateIds: string[]) => {
    const results = await Promise.all(candidateIds.map((id) => sendAssessment(id)
      .then(() => null)
      .catch((error: unknown) => (error instanceof Error ? error.message : 'Unable to send the assessment.'))));
    setAssessmentVersion((value) => value + 1);
    setSummaryVersion((value) => value + 1);
    const errors = results.filter((result): result is string => result !== null);
    return { sent: results.length - errors.length, errors };
  };

  /** Moves each applicant to the stage; returns the ids that moved and the first error. */
  const moveApplicants = async (candidateIds: string[], status: CandidateStatus, reason = '') => {
    const results = await Promise.all(candidateIds.map((id) => updateEmployerApplicationStatus({ applicationId: id, status: status.toLowerCase(), rejectionReason: reason })
      .then(() => id)
      .catch((error: unknown) => {
        console.warn('Unable to update application status:', error);
        return error instanceof Error ? new Error(error.message) : new Error('Unable to update applicant status.');
      })));
    const moved = new Set(results.filter((result): result is string => typeof result === 'string'));
    const firstError = results.find((result): result is Error => result instanceof Error)?.message || '';
    if (moved.size > 0) {
      setApplications((current) => current.map((candidate) => (moved.has(candidate.id) ? { ...candidate, status } : candidate)));
      setSummaryVersion((value) => value + 1);
    }
    return { moved, firstError };
  };

  const bulkCandidateAction = async (action: CandidateBulkAction, candidateIds: string[], reason: string) => {
    // Re-check against the latest data; the list may have refreshed since selecting.
    const eligible = candidateIds.filter((id) => {
      const candidate = applications.find((item) => item.id === id);
      return candidate && !candidateActionBlocker(action, candidate, assessments.get(id) || null, rubricsByJob.has(candidate.jobId));
    });
    if (eligible.length === 0) {
      showToast('None of the selected applicants can take this step any more.', 'warn');
      return;
    }
    const people = (count: number) => `${count} applicant${count === 1 ? '' : 's'}`;
    if (action === 'shortlisted' || action === 'send-assessment') {
      const pendingIds = eligible.filter((id) => applications.find((item) => item.id === id)?.status === 'Pending');
      const { moved, firstError } = pendingIds.length > 0 ? await moveApplicants(pendingIds, 'Shortlisted') : { moved: new Set<string>(), firstError: '' };
      const readyIds = eligible.filter((id) => !pendingIds.includes(id) || moved.has(id));
      const withRubric = readyIds.filter((id) => rubricsByJob.has(applications.find((item) => item.id === id)?.jobId || ''));
      const { sent, errors } = withRubric.length > 0 ? await sendAssessments(withRubric) : { sent: 0, errors: [] as string[] };
      const parts = [
        moved.size > 0 ? `${people(moved.size)} shortlisted` : '',
        sent > 0 ? `Candidate Assessment sent to ${people(sent)}` : '',
      ].filter(Boolean);
      const problem = firstError || errors[0] || (withRubric.length < readyIds.length ? "Set up this job's assessment to send it." : '');
      showToast(`${parts.join('; ') || 'Nothing changed'}.${problem ? ` ${problem}` : ''}`, problem ? 'warn' : 'success');
      return;
    }
    const status: CandidateStatus = action === 'interviewing' ? 'Interviewing' : action === 'hired' ? 'Hired' : 'Rejected';
    const { moved, firstError } = await moveApplicants(eligible, status, reason);
    const failed = eligible.length - moved.size;
    showToast(
      `${people(moved.size)} moved to ${status}.${failed > 0 ? ` ${people(failed)} couldn't be moved: ${firstError}` : ''}`,
      failed > 0 ? 'warn' : 'success',
    );
  };

  const sendMessageRequest = (candidateId: string) => {
    const candidate = applications.find((item) => item.id === candidateId);
    if (!candidate || candidate.status !== 'Interviewing' || candidate.messageRequestState !== 'none') {
      showToast('Message request is not available for this applicant.', 'warn');
      return;
    }
    setDraftRequestCandidateId(candidateId);
    setMessageDraft(`Hi ${candidate.fullName}, we'd like to coordinate next steps for your ${candidate.role} application.`);
    setSelectedThreadId(candidateId);
    closeReview();
    goPage('messages');
  };

  const selectThreadFromCandidates = (candidateId: string) => {
    const threadExists = messageThreads.some((candidate) => candidate.id === candidateId);
    closeReview();
    goPage('messages');
    if (threadExists) {
      setSelectedThreadId(candidateId);
      return;
    }
    showToast('No active message thread for this candidate yet.', 'warn');
  };

  const selectedThreadKey = selectedThreadHasThread ? selectedThreadCandidate?.id || '' : '';
  useEffect(() => {
    if (!selectedThreadKey) return undefined;
    let isMounted = true;
    loadMessageModeration(selectedThreadKey)
      .then((moderation) => { if (isMounted) setMessageModeration((current) => ({ ...current, [selectedThreadKey]: moderation })); })
      .catch((error: unknown) => {
        console.warn('Unable to load message moderation state:', error);
        if (isMounted) showToast(error instanceof Error ? error.message : 'Unable to check whether this conversation is blocked.', 'warn');
      });
    return () => { isMounted = false; };
  }, [selectedThreadKey]);

  const applyMessageModeration = async (
    candidate: CandidateApplication,
    input: { action: 'report' | 'block' | 'unblock'; reason?: MessageReportReason; details?: string },
  ): Promise<boolean> => {
    try {
      const moderation = await submitMessageModeration({ applicationId: candidate.id, ...input });
      setMessageModeration((current) => ({ ...current, [candidate.id]: moderation }));
      return true;
    } catch (error) {
      console.warn('Unable to update message moderation:', error);
      showToast(error instanceof Error ? error.message : 'Unable to complete this action. Please try again.', 'danger');
      return false;
    }
  };

  const submitMessageReport = async (reason: MessageReportReason, details: string, alsoBlock: boolean) => {
    if (!reportTarget) return;
    const candidate = reportTarget;
    const label = applicantTitle(candidate);
    if (!(await applyMessageModeration(candidate, { action: 'report', reason, details }))) return;
    if (alsoBlock && !(await applyMessageModeration(candidate, { action: 'block' }))) return;
    setReportTarget(null);
    showToast(alsoBlock ? `${label} was reported and blocked.` : `Thanks — ${label} was reported for review.`, 'success');
  };

  const confirmBlockCandidate = async () => {
    if (!blockTarget) return;
    const candidate = blockTarget;
    if (!(await applyMessageModeration(candidate, { action: 'block' }))) return;
    setBlockTarget(null);
    setMessageDraft('');
    showToast(`${applicantTitle(candidate)} is blocked. They can no longer message you here.`, 'warn');
  };

  const unblockCandidate = async (candidate: CandidateApplication) => {
    if (await applyMessageModeration(candidate, { action: 'unblock' })) showToast(`${applicantTitle(candidate)} is unblocked.`, 'success');
  };

  const sendMessage = async () => {
    if (!selectedThreadCandidate || !canSendMessage) return;
    const text = messageDraft.trim();
    if (!text) return;
    const isRequest = selectedThreadCandidate.id === draftRequestCandidateId && selectedThreadCandidate.messageRequestState === 'none';
    let savedMessage;
    try {
      savedMessage = await sendApplicationMessage({ applicationId: selectedThreadCandidate.id, text, kind: isRequest ? 'request' : 'message' });
    } catch (messageError) {
      console.warn('Unable to save message:', messageError);
      showToast(messageError instanceof Error ? messageError.message : 'Unable to send the message request. Please try again.', 'danger');
      return;
    }

    if (isRequest) {
      const { error: applicationError } = await supabase
        .from('job_applications')
        .update({
          message_request_state: 'pending',
          updated_at: new Date().toISOString(),
        })
        .eq('id', selectedThreadCandidate.id);

      if (applicationError) {
        console.warn('Unable to update message request state:', applicationError);
        showToast('Message saved, but request status could not be updated.', 'warn');
      }
    }

    const entry: MessageEntry = savedMessage ? toMessageEntry(savedMessage as ApplicationMessageRow) : { from: 'employer', text, time: 'Just now' };
    setApplications((current) =>
      current.map((candidate) =>
        candidate.id === selectedThreadCandidate.id
          ? {
              ...candidate,
              messageRequestState: isRequest ? 'pending' : candidate.messageRequestState,
              messages: [...candidate.messages, entry],
            }
          : candidate,
      ),
    );
    if (isRequest) {
      setDraftRequestCandidateId('');
      setNotifications((current) => [
        {
          id: `notif-${Date.now()}`,
          type: 'msg',
          title: 'Message request sent',
          message: `${selectedThreadCandidate.publicId || 'Candidate'} message request is now pending candidate acceptance.`,
          time: 'Just now',
          unread: true,
        },
        ...current,
      ]);
      showToast('Message request sent.', 'success');
    }
    setMessageDraft('');
  };

  const requestDeleteEmployerProfile = () => {
    setDeleteProfileModalOpen(false);
    requestAccountDeletion()
      .then(() => showToast('Profile deletion request sent. An administrator will review it.', 'success'))
      .catch((error) => showToast(error instanceof Error ? error.message : 'Unable to submit your deletion request.', 'danger'));
  };

  const handleLogout = () => {
    setReviewModalId(null);
    setConfirmModal({ open: false, action: null, candidateId: null });
    if (onLogout) {
      onLogout();
      return;
    }
    onHome();
  };

  const openJob = (jobId: string) => {
    navigate(employerJobPath(jobId));
    window.scrollTo({ top: 0 });
  };

  const postJob = () => {
    navigate(employerJobEditorPath());
    window.scrollTo({ top: 0 });
  };

  const viewApplicants = (jobId: string) => {
    setCandidateFilters((current) => ({ ...current, jobId, status: 'all', search: '', highMatch: false }));
    goPage('candidates');
  };

  // Home: the few things worth doing next, most urgent first.
  const isLoadingJobs = jobsLoadStatus === 'loading';
  const isLoadingApplicants = applicationsLoadStatus === 'loading';
  const pendingApplicants = applications.filter((candidate) => candidate.status === 'Pending');
  const awaitingRequest = applications.find((candidate) => candidate.status === 'Interviewing' && candidate.messageRequestState === 'none');
  const closingSoon = jobs.find((job) => {
    const days = job.status === 'open' ? daysUntil(job.deadline, currentDate) : null;
    return days !== null && days >= 0 && days <= 3;
  });
  const draftJob = jobs.find((job) => job.status === 'draft');
  const openJobsList = jobs
    .filter((job) => job.status === 'open')
    .map((job) => ({ ...job, applicantCount: jobStats.get(job.id)?.applications || 0 }));
  const closingDays = closingSoon ? daysUntil(closingSoon.deadline, currentDate) : null;
  const activeApplicants = applications.filter((candidate) => ['Pending', 'Shortlisted', 'Interviewing'].includes(candidate.status));
  const submittedAssessments = activeApplicants.filter((candidate) => assessments.get(candidate.id)?.status === 'submitted');
  const shortlistedWithoutAssessment = activeApplicants.filter((candidate) => candidate.status === 'Shortlisted' && !assessments.has(candidate.id) && rubricsByJob.has(candidate.jobId));
  const openJobWithoutRubric = !evaluationUnavailable ? jobs.find((job) => job.status === 'open' && !rubricsByJob.has(job.id)) : undefined;
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
  const nextSteps: NextStep[] = [
    ...(!isLoadingJobs && jobs.length === 0 ? [{ id: 'first-job', title: 'Post your first job', detail: 'Kareerly matches applicants to your required skills as soon as it is live.', actionLabel: 'Post a job', onAction: postJob }] : []),
    ...(submittedAssessments.length > 0 ? [{ id: 'assessments', title: `Review ${plural(submittedAssessments.length, 'submitted assessment')}`, detail: 'Candidates answered your questions. Rate their answers on your scorecard, then decide on an interview.', actionLabel: 'Open applicant', onAction: () => openReview(submittedAssessments[0].id) }] : []),
    ...(pendingApplicants.length > 0 ? [{ id: 'pending', title: `Review ${pendingApplicants.length} new applicant${pendingApplicants.length === 1 ? '' : 's'}`, detail: 'Shortlisting sends the Candidate Assessment. Use the Match ≥ 70% filter to start with the strongest matches.', actionLabel: 'Review applicants', onAction: () => goPage('candidates') }] : []),
    ...(shortlistedWithoutAssessment.length > 0 ? [{ id: 'send-assessments', title: `Send the assessment to ${plural(shortlistedWithoutAssessment.length, 'shortlisted applicant')}`, detail: "They're shortlisted but haven't received the Candidate Assessment yet.", actionLabel: 'Open applicants', onAction: () => { setCandidateFilters((current) => ({ ...current, jobId: shortlistedWithoutAssessment[0].jobId, status: 'Shortlisted', search: '', highMatch: false })); goPage('candidates'); } }] : []),
    ...(awaitingRequest ? [{ id: 'request', title: `Message ${awaitingRequest.publicId || 'your interviewing candidate'}`, detail: `Interviewing for ${awaitingRequest.role}. Send a message request to set up next steps.`, actionLabel: 'Open applicant', onAction: () => openReview(awaitingRequest.id) }] : []),
    ...(closingSoon ? [{ id: 'closing', title: `${closingSoon.title} ${closingDays === 0 ? 'closes today' : `closes in ${closingDays} day${closingDays === 1 ? '' : 's'}`}`, detail: 'Extend the deadline if you need more applicants.', actionLabel: 'Edit job', onAction: () => startEditJobForm(closingSoon) }] : []),
    ...(openJobWithoutRubric ? [{ id: 'rubric', title: `Set up the assessment for ${openJobWithoutRubric.title}`, detail: 'Shortlisted applicants receive its questions automatically once it is set up.', actionLabel: 'Set up assessment', onAction: () => void openRubricEditor(openJobWithoutRubric.id) }] : []),
    ...(draftJob ? [{ id: 'draft', title: `Finish your draft: ${draftJob.title}`, detail: 'Drafts are hidden from candidates until you post them.', actionLabel: 'Continue editing', onAction: () => startEditJobForm(draftJob) }] : []),
  ];
  const reviewQueue = jobs
    .map((job) => {
      const waiting = pendingApplicants.filter((candidate) => candidate.jobId === job.id);
      return { job, pending: waiting.length, oldestApplied: waiting.map((candidate) => candidate.appliedDate).filter(Boolean).sort()[0] || '' };
    })
    .filter((row) => row.pending > 0)
    .sort((left, right) => right.pending - left.pending)
    .slice(0, 5);
  const pipeline = (['Pending', 'Shortlisted', 'Interviewing', 'Hired'] as CandidateStatus[]).map((status) => ({
    label: status,
    count: applications.filter((candidate) => candidate.status === status).length,
  }));
  const strongMatches = activeApplicants
    .filter((candidate) => candidate.status !== 'Interviewing')
    .map((candidate) => ({ candidate, percent: profileMatch(candidate, jobMap.get(candidate.jobId) || null).percent }))
    .filter((row): row is { candidate: CandidateApplication; percent: number } => row.percent !== null && row.percent >= HIGH_MATCH_PERCENT)
    .sort((left, right) => right.percent - left.percent)
    .slice(0, 5)
    .map(({ candidate, percent }) => {
      const assessment = assessments.get(candidate.id);
      return {
        id: candidate.id,
        label: candidate.publicId || 'Applicant',
        jobTitle: candidate.role,
        percent,
        assessment: candidate.status === 'Pending' ? 'Not shortlisted yet'
          : !assessment ? 'Assessment not sent'
            : assessment.status === 'pending' ? 'Assessment awaiting response'
              : assessment.status === 'submitted' ? 'Assessment ready to review' : 'Assessment reviewed',
      };
    });
  const assessmentList = Array.from(assessments.values());
  const homeAssessments = {
    awaitingCandidate: assessmentList.filter((item) => item.status === 'pending').length,
    toReview: assessmentList.filter((item) => item.status === 'submitted').length,
    reviewed: assessmentList.filter((item) => item.status === 'reviewed').length,
  };
  const weekAgo = new Date(`${currentDate}T00:00:00`);
  weekAgo.setDate(weekAgo.getDate() - 7);
  const weekAgoIso = weekAgo.toISOString().slice(0, 10);
  const snapshot = {
    newThisWeek: applications.filter((candidate) => candidate.appliedDate && candidate.appliedDate > weekAgoIso).length,
    openJobs: openJobsList.length,
    interviewing: applications.filter((candidate) => candidate.status === 'Interviewing').length,
    hired: applications.filter((candidate) => candidate.status === 'Hired').length,
  };
  const requestAwaiting = messageThreads.filter((candidate) => candidate.messageRequestState === 'pending').length;

  const confirmCandidate = confirmModal.candidateId ? applications.find((candidate) => candidate.id === confirmModal.candidateId) : null;

  return (
    <AppShell
      onHome={() => goPage('dashboard')}
      workspaceLabel="Employer"
      layout="topnav"
      nav={[
        { id: 'dashboard', href: EMPLOYER_PAGE_PATHS.dashboard, label: 'Home', icon: faHouse, current: activePage === 'dashboard', onSelect: () => goPage('dashboard') },
        { id: 'jobs', href: EMPLOYER_PAGE_PATHS.jobs, label: 'Jobs', icon: faBriefcase, current: activePage === 'jobs', onSelect: () => goPage('jobs') },
        {
          id: 'candidates',
          href: EMPLOYER_PAGE_PATHS.candidates,
          label: 'Candidates',
          icon: faUsers,
          current: activePage === 'candidates',
          onSelect: () => goPage('candidates'),
          badge: pendingApplicants.length,
          badgeLabel: (count) => `${count} new applicant${count === 1 ? '' : 's'}`,
        },
        { id: 'insights', href: EMPLOYER_PAGE_PATHS.insights, label: 'Insights', icon: faChartColumn, current: activePage === 'insights', onSelect: () => goPage('insights') },
        {
          id: 'messages',
          href: EMPLOYER_PAGE_PATHS.messages,
          label: 'Messages',
          icon: faComments,
          current: activePage === 'messages',
          onSelect: () => goPage('messages'),
          badge: requestAwaiting,
          badgeLabel: (count) => `${count} request${count === 1 ? '' : 's'} awaiting a reply`,
        },
      ]}
      notifications={{
        items: notifications.map((item) => ({
          id: item.id,
          title: item.title,
          message: item.message,
          time: item.time,
          unread: item.unread,
          icon: notificationIcon[item.type],
          onOpen: () => goPage(item.type === 'msg' ? 'messages' : item.type === 'job' ? 'jobs' : 'candidates'),
          onMarkRead: () => {
            if (item.id.startsWith('assessment-')) void supabase.from('candidate_notifications').update({ read_at: new Date().toISOString() }).eq('id', item.id.slice('assessment-'.length));
            setNotifications((current) => current.map((row) => (row.id === item.id ? { ...row, unread: false } : row)));
          },
        })),
        status: 'ready',
        unreadCount,
        onMarkAllRead: markNotificationsRead,
      }}
      account={{
        name: companyName,
        email: employer.email,
        initials: getInitials(companyName),
        items: [{ label: 'Company profile', icon: faBuilding, onSelect: () => goPage('account') }],
        onLogout: handleLogout,
      }}
    >
      {activePage === 'dashboard' && (
        <EmployerHomePage
          isLoading={isLoadingJobs || isLoadingApplicants}
          nextSteps={nextSteps}
          pipeline={pipeline}
          reviewQueue={reviewQueue}
          openJobs={openJobsList}
          strongMatches={strongMatches}
          highMatchPercent={HIGH_MATCH_PERCENT}
          assessments={homeAssessments}
          snapshot={snapshot}
          onOpenApplicant={openReview}
          onOpenCandidates={() => goPage('candidates')}
          onOpenJobApplicants={viewApplicants}
          onOpenJobs={() => goPage('jobs')}
          onOpenJob={openJob}
          onPostJob={postJob}
        />
      )}

      {activePage === 'jobs' && templateRouteId !== null && (
        <AssessmentTemplatesPage
          templates={templates}
          status={effectiveTemplatesStatus}
          jobs={jobs}
          latestRubrics={latestRubrics}
          usage={templateUsage}
          describeJob={describeJobAssessment}
          templateId={templateRouteId}
          onOpen={(id) => { navigate(employerTemplatePath(id)); window.scrollTo({ top: 0 }); }}
          onBackToList={() => openJobsSection('templates')}
          onSection={openJobsSection}
          onSave={saveTemplate}
          onDelete={deleteTemplates}
          onApply={applyTemplates}
        />
      )}

      {activePage === 'jobs' && jobEditorId !== null && (
        (jobEditorId && !editorJob) || (!jobEditorId && !accountLoaded) ? (
          <div className="k-page k-page-narrow">
            {isLoadingJobs || !jobEditorId ? <SkeletonRows count={4} label="Loading job" /> : (
              <EmptyState
                icon={faBriefcase}
                title="Job not found"
                text="It may have been deleted."
                actions={<button className="k-btn k-btn-secondary" type="button" onClick={() => goPage('jobs')}>All jobs</button>}
              />
            )}
          </div>
        ) : (
          <JobEditorPage
            key={jobDraftKey(employer.id || '', jobEditorId)}
            job={editorJob}
            draftKey={jobDraftKey(employer.id || '', jobEditorId)}
            companyLocation={{ city: accountProfile.city, province: accountProfile.province }}
            backLabel={editorJob ? editorJob.title : 'All jobs'}
            onBack={leaveJobEditor}
            onSave={saveJobForm}
            onConfigureAssessment={() => { if (editorJob) { leaveJobEditor(); void openRubricEditor(editorJob.id); } }}
          />
        )
      )}

      {activePage === 'jobs' && templateRouteId === null && jobEditorId === null && (
        <EmployerJobsPage
          jobs={jobs}
          jobStats={jobStats}
          rubricVersions={rubricVersions}
          latestRubrics={latestRubrics}
          templates={templates}
          onApplyTemplates={applyTemplates}
          onSection={openJobsSection}
          isLoading={isLoadingJobs}
          detailJobId={detailJobId}
          onOpenJob={openJob}
          onBackToList={() => goPage('jobs')}
          onPostJob={postJob}
          onImportJobs={importJobs}
          newJobDraft={newJobDraft}
          onDiscardNewJobDraft={() => clearJobDraft(newJobDraftKey)}
          onEdit={startEditJobForm}
          onEditRubric={(jobId) => void openRubricEditor(jobId)}
          onViewApplicants={viewApplicants}
          onBulkAction={bulkJobAction}
        />
      )}

      {activePage === 'candidates' && (
        <EmployerCandidatesPage
          applications={applications}
          jobs={jobs}
          isLoading={isLoadingJobs || isLoadingApplicants}
          loadFailed={applicationsLoadStatus === 'error'}
          filters={candidateFilters}
          onFilters={setCandidateFilters}
          summaries={summaries}
          assessments={assessments}
          onBulkAction={bulkCandidateAction}
          hasRubric={rubricsByJob.has(candidateFilters.jobId)}
          evaluationUnavailable={evaluationUnavailable}
          onReview={openReview}
          onOpenJobs={() => goPage('jobs')}
          onEditRubric={(jobId) => void openRubricEditor(jobId)}
        />
      )}

      {activePage === 'insights' && (
        <InsightsPage
          applications={applications}
          jobs={jobs}
          employerName={companyName}
          isLoading={isLoadingJobs || isLoadingApplicants}
          loadFailed={applicationsLoadStatus === 'error'}
          onViewApplicants={viewApplicants}
          onPostJob={postJob}
          onToast={showToast}
        />
      )}

      {activePage === 'messages' && (
        <EmployerMessagesPage
          threads={messageThreads}
          selected={selectedThreadCandidate}
          draftRequestId={draftRequestCandidateId}
          companyName={companyName}
          draft={messageDraft}
          canSend={canSendMessage}
          isDesktop={isDesktop}
          onSelect={setSelectedThreadId}
          onDraftChange={setMessageDraft}
          onSend={() => void sendMessage()}
          moderation={selectedModeration}
          canModerate={selectedThreadHasThread}
          onBlock={setBlockTarget}
          onUnblock={(candidate) => void unblockCandidate(candidate)}
          onReport={setReportTarget}
          onOpenCandidates={() => goPage('candidates')}
          loadError={messageLoadError}
        />
      )}

      {activePage === 'account' && (
        <EmployerAccountPage
          profile={accountProfile}
          password={passwordForm}
          isSaving={isSavingAccount}
          onProfileChange={setAccountProfile}
          onSave={() => void saveAccountProfile()}
          onPasswordChange={setPasswordForm}
          onUpdatePassword={() => void updatePassword()}
          onRequestDelete={() => setDeleteProfileModalOpen(true)}
        />
      )}

      {reviewCandidate && (
        <ApplicantReviewModal
          candidate={reviewCandidate}
          job={reviewJob}
          rubrics={rubricsByJob.get(reviewCandidate.jobId) || []}
          currentUserId={employer.id || ''}
          position={reviewIndex >= 0 ? { index: reviewIndex, total: reviewList.length } : null}
          evaluationUnavailable={evaluationUnavailable}
          onPrevious={reviewIndex > 0 ? () => setReviewModalId(reviewList[reviewIndex - 1].id) : null}
          onNext={reviewIndex >= 0 && reviewIndex < reviewList.length - 1 ? () => setReviewModalId(reviewList[reviewIndex + 1].id) : null}
          onEditRubric={(jobId) => void openRubricEditor(jobId)}
          onEvaluationChanged={() => { setSummaryVersion((value) => value + 1); setAssessmentVersion((value) => value + 1); }}
          onToast={showToast}
          onClose={closeReview}
          onAction={openConfirmStatus}
          onSendRequest={sendMessageRequest}
          onOpenMessages={selectThreadFromCandidates}
        />
      )}

      {rubricEditor && jobMap.get(rubricEditor.jobId) && (
        <RubricEditorModal
          job={jobMap.get(rubricEditor.jobId)!}
          rubric={rubricsByJob.get(rubricEditor.jobId)?.[0] || null}
          inUse={rubricEditor.inUse}
          saving={isSavingRubric}
          templates={templates}
          onCancel={() => {
            if (rubricEditor.afterPosting) showToast('Assessment skipped. You can set it up anytime from the job page.');
            setRubricEditor(null);
          }}
          onSave={(criteria, templateName) => void saveRubricDraft(criteria, templateName)}
        />
      )}

      {confirmModal.open && confirmModal.action && confirmModal.candidateId && (
        <ConfirmDialog
          title={`${statusActionLabel(confirmModal.action)}?`}
          message={statusActionMessage(confirmModal.action, confirmCandidate?.publicId || 'this candidate')}
          confirmLabel={confirmModal.action === 'rejected' ? 'Reject' : 'Confirm'}
          danger={confirmModal.action === 'rejected'}
          confirmDisabled={confirmModal.action === 'rejected' && !rejectionReason}
          onCancel={closeConfirm}
          onConfirm={applyStatusChange}
        >
          {confirmModal.action === 'rejected' && (
            <FormField label="Reason *" help="Use an objective, job-related reason. It is saved with the application." className="mt-4">
              <select className="k-select" value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)} required>
                <option value="">Select a reason</option>
                {REJECTION_REASONS.map((reason) => <option key={reason.value} value={reason.value}>{reason.label}</option>)}
              </select>
            </FormField>
          )}
        </ConfirmDialog>
      )}

      {deleteProfileModalOpen && (
        <ConfirmDialog
          title="Delete your employer profile?"
          message="This asks the Kareerly administrators to remove your account, job posts, applicant records and messages. Your account stays active until an administrator approves the request."
          confirmLabel="Request deletion"
          danger
          onCancel={() => setDeleteProfileModalOpen(false)}
          onConfirm={requestDeleteEmployerProfile}
        />
      )}

      {reportTarget && (
        <ReportConversationModal
          name={applicantTitle(reportTarget)}
          alreadyBlocked={Boolean(messageModeration[reportTarget.id]?.blocked_by_me)}
          onCancel={() => setReportTarget(null)}
          onSubmit={submitMessageReport}
        />
      )}

      {blockTarget && (
        <ConfirmDialog
          title={`Block ${applicantTitle(blockTarget)}?`}
          message="They won't be able to message you here, and you won't be able to send them messages. Their application isn't affected. You can unblock them later."
          danger
          confirmLabel="Block"
          onCancel={() => setBlockTarget(null)}
          onConfirm={() => void confirmBlockCandidate()}
        />
      )}

      <ToastRegion toast={toast} onClose={() => setToast(null)} />
    </AppShell>
  );
}

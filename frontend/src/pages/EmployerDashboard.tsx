import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { faBriefcase, faBuilding, faComments, faHouse, faLayerGroup, faPlus, faStar, faUsers } from '@fortawesome/free-solid-svg-icons';
import { AppShell, ConfirmDialog, DESKTOP_QUERY, FormField, ToastRegion, useMediaQuery, type NextStep, type ToastState } from '../components/ui';
import { loadApplicationMessages, loadEmployerAccountSettings, saveEmployerAccountSettings, sendApplicationMessage, updateEmployerApplicationStatus } from '../lib/api';
import { supabase } from '../lib/supabase';
import { joinJobContent } from '../lib/jobDescription';
import { ApplicantReviewModal } from './employer/ApplicantReviewModal';
import { EmployerAccountPage, type EmployerAccountForm } from './employer/EmployerAccountPage';
import { EmployerCandidatesPage } from './employer/EmployerCandidatesPage';
import { EmployerHomePage } from './employer/EmployerHomePage';
import { EmployerJobsPage } from './employer/EmployerJobsPage';
import { EmployerMessagesPage } from './employer/EmployerMessagesPage';
import { JobEditorModal } from './employer/JobEditorModal';
import {
  daysUntil,
  EMPLOYER_PAGE_PATHS,
  employerPageFromPath,
  emptyJobForm,
  getCategoryCode,
  getInitials,
  getMatchBucket,
  getSalaryAmounts,
  initialApplications,
  initialJobs,
  initialNotifications,
  MIN_EMPLOYER_SALARY,
  REJECTION_REASONS,
  statusActionLabel,
  statusActionMessage,
  toCandidateApplication,
  toEmployerJob,
  toMessageEntry,
  toSalaryInputValue,
  todayIso,
  type ApplicationMessageRow,
  type CandidateApplication,
  type CandidateStatus,
  type EmployerJob,
  type EmployerJobPostRow,
  type EmployerPage,
  type JobApplicationRow,
  type JobFormState,
  type JobStats,
  type JobStatus,
  type JobsPanelMode,
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
  const [isSavingJob, setIsSavingJob] = useState(false);
  const [applications, setApplications] = useState<CandidateApplication[]>(initialApplications);
  const [notifications, setNotifications] = useState<NotificationItem[]>(initialNotifications);
  const [toast, setToast] = useState<ToastState>(null);
  const [selectedJobId, setSelectedJobId] = useState<string>(initialJobs[0]?.id || '');
  const [jobDetailOpen, setJobDetailOpen] = useState(false);
  const [jobsPanelMode, setJobsPanelMode] = useState<JobsPanelMode>('detail');
  const [jobForm, setJobForm] = useState<JobFormState>(emptyJobForm);
  const [jobFormError, setJobFormError] = useState('');
  const [requiredSkillsDraft, setRequiredSkillsDraft] = useState<string[]>([]);
  const [niceSkillsDraft, setNiceSkillsDraft] = useState<string[]>([]);
  const [requiredSkillInput, setRequiredSkillInput] = useState('');
  const [niceSkillInput, setNiceSkillInput] = useState('');
  const [closeJobTarget, setCloseJobTarget] = useState<EmployerJob | null>(null);
  const [candidateJobFilter, setCandidateJobFilter] = useState<string>('');
  const [selectedThreadId, setSelectedThreadId] = useState<string>('');
  const [messageDraft, setMessageDraft] = useState('');
  const [draftRequestCandidateId, setDraftRequestCandidateId] = useState<string>('');
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
    location: '',
    website: '',
    about: '',
    contactPerson: contactName,
    contactRole: '',
    contactEmail: employer.email,
    contactNumber: '',
  });
  const [isSavingAccount, setIsSavingAccount] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ current: '', next: '', confirm: '' });
  const toastTimerRef = useRef<number | null>(null);

  const unreadCount = useMemo(() => notifications.filter((item) => item.unread).length, [notifications]);

  const showToast = (message: string, type: ToastType = '') => {
    if (!message) return;
    setToast({ message, type });
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
          industry: saved.industry || '',
          size: saved.company_size || '',
          location: saved.company_location || '',
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
        company_location: accountProfile.location,
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
        const top = candidates.filter((candidate) => candidate.matchPercent >= 90).length;
        const good = candidates.filter(
          (candidate) => candidate.matchPercent >= 75 && candidate.matchPercent < 90,
        ).length;
        const partial = candidates.filter((candidate) => candidate.hasMatchScore && candidate.matchPercent < 75).length;
        return [job.id, { applications: candidates.length, top, good, partial }];
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
  const canSendMessage = selectedThreadCandidate?.messageRequestState === 'accepted' || isDraftRequestThread;

  const reviewCandidate = applications.find((candidate) => candidate.id === reviewModalId) || null;
  const reviewJob = reviewCandidate ? jobMap.get(reviewCandidate.jobId) || null : null;

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
      const messageResults = await Promise.all(applicationIds.map(async (applicationId) => ({
        applicationId,
        messages: await loadApplicationMessages(applicationId).catch(() => []),
      })));
      const messagesByApplication = new Map<string, ApplicationMessageRow[]>(messageResults.map(({ applicationId, messages }) => [
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
      setApplications(rows.map((row) => toCandidateApplication(row, jobs, messagesByApplication.get(row.id) || [], publicIdsByApplication.get(row.id) || '')));
      setApplicationsLoadStatus('ready');
    };

    void loadJobApplications();
    const refreshTimer = window.setInterval(() => void loadJobApplications(), 5000);

    return () => {
      isMounted = false;
      window.clearInterval(refreshTimer);
    };
  }, [jobs, jobsLoadStatus]);

  const markNotificationsRead = () => {
    setNotifications((current) => current.map((item) => ({ ...item, unread: false })));
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
    setJobFormError('');
    setRequiredSkillsDraft([]);
    setNiceSkillsDraft([]);
    setRequiredSkillInput('');
    setNiceSkillInput('');
  };

  const startEditJobForm = (job: EmployerJob) => {
    setSelectedJobId(job.id);
    setJobsPanelMode('edit');
    setJobFormError('');
    setJobForm({
      title: job.title,
      category: job.category,
      subcategory: job.subcategory,
      experienceLevel: job.experienceLevel,
      description: job.description,
      responsibilities: job.responsibilities.join('\n'),
      workSetup: job.workSetup,
      employmentType: job.employmentType,
      location: toFormLocation(job),
      salaryRange: toSalaryInputValue(job.salaryRange),
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
    setJobFormError('');
  };

  const updateJobForm = <K extends keyof JobFormState>(field: K, value: JobFormState[K]) => {
    if (field === 'category') {
      setJobForm((current) => ({ ...current, category: String(value), subcategory: '' }));
      return;
    }
    setJobForm((current) => ({ ...current, [field]: value }));
  };

  const setSkillInput = (kind: 'required' | 'nice', value: string) => {
    if (kind === 'required') setRequiredSkillInput(value);
    else setNiceSkillInput(value);
  };

  const addSkillDraft = (kind: 'required' | 'nice') => {
    const raw = kind === 'required' ? requiredSkillInput : niceSkillInput;
    const values = raw
      .split(',')
      .map((skill) => skill.trim())
      .filter(Boolean);
    if (values.length === 0) return;

    const uniqueValues = values.filter((skill, index, list) => {
      const normalized = skill.toLowerCase();
      return list.findIndex((item) => item.toLowerCase() === normalized) === index;
    });

    if (kind === 'required') {
      const existing = new Set(requiredSkillsDraft.map((skill) => skill.toLowerCase()));
      const nextSkills = uniqueValues.filter((skill) => !existing.has(skill.toLowerCase()));
      if (nextSkills.length === 0) {
        setJobFormError('That required skill is already added.');
        return;
      }
      setRequiredSkillsDraft((current) => [...current, ...nextSkills]);
      setRequiredSkillInput('');
      return;
    }

    const existing = new Set(niceSkillsDraft.map((skill) => skill.toLowerCase()));
    const nextSkills = uniqueValues.filter((skill) => !existing.has(skill.toLowerCase()));
    if (nextSkills.length === 0) {
      setJobFormError('That nice-to-have skill is already added.');
      return;
    }
    setNiceSkillsDraft((current) => [...current, ...nextSkills]);
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
    if (!jobForm.title.trim()) return 'Add a job title.';
    if (!jobForm.category.trim()) return 'Choose a category.';
    if (!jobForm.subcategory.trim()) return 'Choose a sub-category.';
    if (!jobForm.experienceLevel.trim()) return 'Choose an experience level.';
    if (!jobForm.workSetup.trim()) return 'Choose a work setup.';
    if (!jobForm.location.trim()) return 'Add a location.';
    if (!jobForm.deadline.trim()) return 'Set an application deadline.';
    if (!jobForm.salaryRange.trim()) return 'Add a salary range.';
    const { minimum: minimumSalary, maximum: maximumSalary } = getSalaryAmounts(jobForm.salaryRange);
    if (!minimumSalary || !maximumSalary) return 'Enter both a minimum and a maximum salary.';
    if (minimumSalary < MIN_EMPLOYER_SALARY) return `The minimum salary must be at least ₱${MIN_EMPLOYER_SALARY.toLocaleString('en-PH')}.`;
    if (maximumSalary < minimumSalary) return 'The maximum salary must be at least the minimum.';
    if (!jobForm.description.trim()) return 'Add a short description of the role.';
    if (!jobForm.responsibilities.trim()) return 'Add at least one responsibility.';
    if (requiredSkillsDraft.length === 0) return 'Add at least one required skill.';
    return null;
  };

  const saveJobForm = async (mode: 'draft' | 'post') => {
    const error = validateJobForm();
    if (error) {
      setJobFormError(error);
      return;
    }
    if (!employerProfileId) {
      setJobFormError('Your employer profile is still loading. Try again in a moment.');
      return;
    }
    setJobFormError('');
    setIsSavingJob(true);
    const status: JobStatus = mode === 'draft' ? 'draft' : jobForm.status === 'closed' ? 'closed' : 'open';
    const { city, province } = parseFormLocation(jobForm.location);
    const location = `${city}${province ? `, ${province}` : ''}`.trim();
    const { minimum: salaryMinPhp, maximum: salaryMaxPhp } = getSalaryAmounts(jobForm.salaryRange);
    const currentJob = jobsPanelMode === 'edit' && selectedJobId ? jobs.find((job) => job.id === selectedJobId) || null : null;
    const jobId = currentJob?.id || `EMP-${Date.now()}`;
    const postingStatus = status === 'open' ? 'active' : status;
    const payload = {
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
      salary_min_php: salaryMinPhp,
      salary_max_php: salaryMaxPhp,
      job_description: joinJobContent(jobForm.description, jobForm.responsibilities),
      responsibilities: jobForm.responsibilities
        .split(/\r?\n/)
        .map((item) => item.replace(/^\s*[-–—•*]\s*/, '').trim())
        .filter(Boolean)
        .join('\n'),
      required_skills: requiredSkillsDraft.join(', '),
      preferred_skills: niceSkillsDraft.join(', '),
      must_have_skill_ids: '',
      application_deadline: jobForm.deadline,
      posting_status: postingStatus,
      updated_at: new Date().toISOString(),
    };

    let { data: savedPost, error: saveError } = await supabase
      .from('employer_job_posts')
      .upsert(payload, { onConflict: 'job_id' })
      .select('*')
      .single();

    if (saveError && String(saveError.message || '').includes('responsibilities')) {
      const { responsibilities: _responsibilities, ...payloadWithoutResponsibilities } = payload;
      const retryResult = await supabase
        .from('employer_job_posts')
        .upsert(payloadWithoutResponsibilities, { onConflict: 'job_id' })
        .select('*')
        .single();
      savedPost = retryResult.data;
      saveError = retryResult.error;
    }

    if (saveError && String(saveError.message || '').includes('job_subcategory')) {
      const { job_subcategory: _jobSubcategory, ...payloadWithoutSubcategory } = payload;
      const retryResult = await supabase
        .from('employer_job_posts')
        .upsert(payloadWithoutSubcategory, { onConflict: 'job_id' })
        .select('*')
        .single();
      savedPost = retryResult.data;
      saveError = retryResult.error;
    }

    if (saveError) {
      console.warn('Unable to save job post:', saveError);
      setJobFormError("The job couldn't be saved. Please try again.");
      setIsSavingJob(false);
      return;
    }

    const savedJob = toEmployerJob(savedPost as EmployerJobPostRow);

    if (jobsPanelMode === 'edit' && selectedJobId) {
      setJobs((current) =>
        current.map((job) =>
          job.id === selectedJobId
            ? {
                ...savedJob,
                deadline: jobForm.deadline,
              }
            : job,
        ),
      );
      showToast(mode === 'draft' ? 'Draft saved.' : 'Job updated.', 'success');
    } else {
      const newJob: EmployerJob = { ...savedJob, deadline: jobForm.deadline };
      setJobs((current) => [newJob, ...current]);
      setSelectedJobId(newJob.id);
      showToast(mode === 'draft' ? 'Saved as a draft.' : 'Job posted.', 'success');
      goPage('jobs');
    }
    setIsSavingJob(false);
    setJobsPanelMode('detail');
  };

  const closeJobPosting = async (jobId: string) => {
    const job = jobs.find((item) => item.id === jobId);
    if (!job) return;
    const { error } = await supabase.from('employer_job_posts').update({ posting_status: 'closed', updated_at: new Date().toISOString() }).eq('job_id', jobId);
    if (error) {
      showToast('Unable to close this job. Please try again.', 'danger');
      return;
    }
    setJobs((current) => current.map((job) => (job.id === jobId ? { ...job, status: 'closed' } : job)));
    showToast('Job closed. It no longer takes applications.', 'success');
  };

  const openReview = (candidateId: string) => {
    setReviewModalId(candidateId);
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

    const label = applications.find((candidate) => candidate.id === confirmModal.candidateId)?.publicId || 'Applicant';
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
      showToast(`${label} moved to Interviewing. You can now send a message request.`, 'success');
    } else {
      showToast(`${label} moved to ${nextStatus}.`, 'success');
    }
    closeConfirm();
    // Keep the review open after Interviewing so the message request is one tap away.
    if (nextStatus !== 'Interviewing') closeReview();
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
    showToast('Deletion request sent. Check your email to confirm.', 'success');
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
    setSelectedJobId(jobId);
    setJobDetailOpen(true);
    goPage('jobs');
  };

  const postJob = () => {
    startNewJobForm();
  };

  const viewApplicants = (jobId: string) => {
    setCandidateJobFilter(jobId);
    setJobDetailOpen(false);
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
  const nextSteps: NextStep[] = [
    ...(!isLoadingJobs && jobs.length === 0 ? [{ id: 'first-job', title: 'Post your first job', detail: 'Kareerly matches applicants to your required skills as soon as it is live.', actionLabel: 'Post a job', onAction: postJob }] : []),
    ...(pendingApplicants.length > 0 ? [{ id: 'pending', title: `Review ${pendingApplicants.length} new applicant${pendingApplicants.length === 1 ? '' : 's'}`, detail: 'Shortlist, interview or decline to keep candidates informed.', actionLabel: 'Review applicants', onAction: () => goPage('candidates') }] : []),
    ...(awaitingRequest ? [{ id: 'request', title: `Message ${awaitingRequest.publicId || 'your interviewing candidate'}`, detail: `Interviewing for ${awaitingRequest.role}. Send a message request to set up next steps.`, actionLabel: 'Open applicant', onAction: () => openReview(awaitingRequest.id) }] : []),
    ...(closingSoon ? [{ id: 'closing', title: `${closingSoon.title} ${closingDays === 0 ? 'closes today' : `closes in ${closingDays} day${closingDays === 1 ? '' : 's'}`}`, detail: 'Extend the deadline if you need more applicants.', actionLabel: 'Edit job', onAction: () => startEditJobForm(closingSoon) }] : []),
    ...(draftJob ? [{ id: 'draft', title: `Finish your draft: ${draftJob.title}`, detail: 'Drafts are hidden from candidates until you post them.', actionLabel: 'Continue editing', onAction: () => startEditJobForm(draftJob) }] : []),
  ];
  const topApplicants = applications
    .filter((candidate) => candidate.status === 'Pending' || candidate.status === 'Shortlisted' || candidate.status === 'Interviewing')
    .filter((candidate) => getMatchBucket(candidate.matchPercent, candidate.hasMatchScore) !== 'unknown')
    .sort((left, right) => right.matchPercent - left.matchPercent)
    .slice(0, 4);
  const pipeline = (['Pending', 'Shortlisted', 'Interviewing', 'Hired'] as CandidateStatus[]).map((status) => ({
    label: status,
    count: applications.filter((candidate) => candidate.status === status).length,
  }));
  const requestAwaiting = messageThreads.filter((candidate) => candidate.messageRequestState === 'pending').length;

  const confirmCandidate = confirmModal.candidateId ? applications.find((candidate) => candidate.id === confirmModal.candidateId) : null;

  return (
    <AppShell
      onHome={() => goPage('dashboard')}
      workspaceLabel="Employer"
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
      sidebarAction={{ label: 'Post a job', icon: faPlus, href: EMPLOYER_PAGE_PATHS.jobs, current: jobsPanelMode === 'new', onSelect: postJob }}
      notifications={{
        items: notifications.map((item) => ({
          id: item.id,
          title: item.title,
          message: item.message,
          time: item.time,
          unread: item.unread,
          icon: notificationIcon[item.type],
          onOpen: () => goPage(item.type === 'msg' ? 'messages' : item.type === 'job' ? 'jobs' : 'candidates'),
          onMarkRead: () => setNotifications((current) => current.map((row) => (row.id === item.id ? { ...row, unread: false } : row))),
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
          topApplicants={topApplicants}
          openJobs={openJobsList}
          onReview={openReview}
          onOpenCandidates={() => goPage('candidates')}
          onOpenJobs={() => goPage('jobs')}
          onOpenJob={openJob}
          onPostJob={postJob}
        />
      )}

      {activePage === 'jobs' && (
        <EmployerJobsPage
          jobs={jobs}
          jobStats={jobStats}
          isLoading={isLoadingJobs}
          isDesktop={isDesktop}
          selectedJobId={selectedJobId}
          detailOpen={jobDetailOpen}
          onSelect={(jobId) => { setSelectedJobId(jobId); setJobDetailOpen(true); }}
          onCloseDetail={() => setJobDetailOpen(false)}
          onPostJob={postJob}
          onEdit={startEditJobForm}
          onViewApplicants={viewApplicants}
          onCloseJob={setCloseJobTarget}
        />
      )}

      {activePage === 'candidates' && (
        <EmployerCandidatesPage
          applications={applications}
          jobs={jobs}
          isLoading={isLoadingJobs || isLoadingApplicants}
          loadFailed={applicationsLoadStatus === 'error'}
          jobFilter={candidateJobFilter}
          onJobFilter={setCandidateJobFilter}
          onReview={openReview}
          onOpenJobs={() => goPage('jobs')}
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
          onBlock={() => showToast('Block action recorded.', 'warn')}
          onReport={() => showToast('Report submitted.', 'warn')}
          onOpenCandidates={() => goPage('candidates')}
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

      {(jobsPanelMode === 'new' || jobsPanelMode === 'edit') && (
        <JobEditorModal
          editing={jobsPanelMode === 'edit'}
          form={jobForm}
          error={jobFormError}
          requiredSkills={requiredSkillsDraft}
          niceSkills={niceSkillsDraft}
          requiredSkillInput={requiredSkillInput}
          niceSkillInput={niceSkillInput}
          saving={isSavingJob}
          onUpdateForm={updateJobForm}
          onSkillInput={setSkillInput}
          onAddSkill={addSkillDraft}
          onRemoveSkill={removeSkillDraft}
          onCancel={cancelJobPanel}
          onSaveDraft={() => void saveJobForm('draft')}
          onPost={() => void saveJobForm('post')}
        />
      )}

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
            <FormField label="Reason *" help="Use an objective, job-related reason. The candidate sees it." className="mt-4">
              <select className="k-select" value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)} required>
                <option value="">Select a reason</option>
                {REJECTION_REASONS.map((reason) => <option key={reason.value} value={reason.value}>{reason.label}</option>)}
              </select>
            </FormField>
          )}
        </ConfirmDialog>
      )}

      {closeJobTarget && (
        <ConfirmDialog
          title="Close this job?"
          message={`${closeJobTarget.title} will stop taking applications. Current applicants stay in Candidates.`}
          confirmLabel="Close job"
          onCancel={() => setCloseJobTarget(null)}
          onConfirm={async () => {
            await closeJobPosting(closeJobTarget.id);
            setCloseJobTarget(null);
          }}
        />
      )}

      {deleteProfileModalOpen && (
        <ConfirmDialog
          title="Delete your employer profile?"
          message="This sends a deletion request. We email you to confirm before removing your account, job posts, applicant records and messages."
          confirmLabel="Request deletion"
          danger
          onCancel={() => setDeleteProfileModalOpen(false)}
          onConfirm={requestDeleteEmployerProfile}
        />
      )}

      <ToastRegion toast={toast} onClose={() => setToast(null)} />
    </AppShell>
  );
}

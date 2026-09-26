import { scoreLabel } from '../lib/uiData';
import { useEffect, useMemo, useRef, useState } from 'react';
import Logo from '../components/Logo';
import { loadApplicationMessages, loadEmployerAccountSettings, saveEmployerAccountSettings, sendApplicationMessage, updateEmployerApplicationStatus } from '../lib/api';
import { supabase } from '../lib/supabase';
import { formatJobDescription, joinJobContent } from '../lib/jobDescription';
import { MIN_EMPLOYER_SALARY, emptyJobForm, formatDateLabel, getCategoryCode, getInitials, getMatchBucket, getMatchColor, getSalaryAmounts, getStatusBadgeClass, initialApplications, initialJobs, initialNotifications, maskedName, matchBucketLabel, shouldRevealIdentity, statusActionLabel, statusActionMessage, statusToFilter, toCandidateApplication, toEmployerJob, toMessageEntry, toSalaryInputValue, todayIso, type ApplicationMessageRow, type CandidateApplication, type CandidateFilter, type CandidateStatus, type CandidateView, type EmployerJob, type EmployerJobPostRow, type EmployerPage, type JobApplicationRow, type JobFormState, type JobStatus, type JobsPanelMode, type MessageEntry, type NotificationItem, type ReviewAction, type ToastType } from './employer/model';
import { ApplicantReviewModal, CandidateFilterTab, CandidateGroup, ConfirmActionModal, DeleteProfileModal, FinalCandidateCard, JobEditorPanel, MetricCard, SidebarItem, UIIcon } from './employer/legacy';
import './employer-dashboard-v5.css';

type EmployerDashboardProps = {
  employer: { id?: string; name: string; email: string; company: string } | null;
  onHome: () => void;
  onLogin: () => void;
  onSignUp: () => void;
  onLogout?: () => void;
};

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

  return <EmployerWorkspace employer={employer} onHome={onHome} onLogout={onLogout} />;
}

function EmployerWorkspace({ employer, onHome, onLogout }: Pick<EmployerDashboardProps, 'onHome' | 'onLogout'> & { employer: NonNullable<EmployerDashboardProps['employer']> }) {
  const [companyName, setCompanyName] = useState(employer.company || 'Employer Workspace');
  const companyInitials = getInitials(companyName);
  const contactName = employer.name || 'Employer Manager';
  const [activePage, setActivePage] = useState<EmployerPage>('dashboard');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => (typeof window !== 'undefined' ? window.innerWidth < 900 : false));
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [jobs, setJobs] = useState<EmployerJob[]>(initialJobs);
  const [jobsLoadStatus, setJobsLoadStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [applicationsLoadStatus, setApplicationsLoadStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [currentDate, setCurrentDate] = useState(todayIso);
  const [employerProfileId, setEmployerProfileId] = useState('');
  const [isSavingJob, setIsSavingJob] = useState(false);
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
  const [draftRequestCandidateId, setDraftRequestCandidateId] = useState<string>('');
  const [reviewModalId, setReviewModalId] = useState<string | null>(null);
  const [confirmModal, setConfirmModal] = useState<{ open: boolean; action: ReviewAction | null; candidateId: string | null }>({
    open: false,
    action: null,
    candidateId: null,
  });
  const [rejectionReason, setRejectionReason] = useState('');
  const [deleteProfileModalOpen, setDeleteProfileModalOpen] = useState(false);
  const [accountProfile, setAccountProfile] = useState({
    company: companyName,
    industry: 'Enter industry',
    size: 'Enter company size',
    location: 'Enter company location',
    website: 'Enter website',
    about: 'Enter a short company description',
    contactPerson: contactName,
    contactRole: 'Enter contact role',
    contactEmail: employer.email,
    contactNumber: 'Enter contact number',
  });
  const [isSavingAccount, setIsSavingAccount] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ current: '', next: '', confirm: '' });
  const toastTimerRef = useRef<number | null>(null);

  const unreadCount = useMemo(() => notifications.filter((item) => item.unread).length, [notifications]);

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

  const saveCompanyProfile = async () => {
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
      });
      setCompanyName(saved.company_name || accountProfile.company.trim());
      showToast('Company profile saved to Supabase.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to save company profile.', 'danger');
    } finally {
      setIsSavingAccount(false);
    }
  };

  const saveContactDetails = async () => {
    setIsSavingAccount(true);
    try {
      await saveEmployerAccountSettings({
        contact_person_name: accountProfile.contactPerson,
        contact_role: accountProfile.contactRole,
        business_email: accountProfile.contactEmail,
        account_email: accountProfile.contactEmail,
        first_name: accountProfile.contactPerson.trim().split(/\s+/)[0] || '',
        last_name: accountProfile.contactPerson.trim().split(/\s+/).slice(1).join(' '),
        contact_number: accountProfile.contactNumber,
      });
      showToast('Contact details saved to Supabase.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to save contact details.', 'danger');
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
      showToast('Password updated in Supabase Auth.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to update password.', 'danger');
    } finally {
      setIsSavingAccount(false);
    }
  };

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
      title: `${candidate.publicId || 'Candidate'} - ${scoreLabel(candidate.hasMatchScore ? candidate.matchPercent : null)} match for ${candidate.role}`,
      desc: candidate.matchSummary,
      meta: `Applied ${formatDateLabel(candidate.appliedDate)} · Top Match category`,
    }));
    if (withdrawn) {
      rows.push({
        id: `${withdrawn.id}-withdrawn`,
        type: 'warn',
        title: `${withdrawn.publicId || 'Candidate'} withdrew their application`,
        desc: `The candidate withdrew from ${withdrawn.role}. This record is now closed and read-only.`,
        meta: `Applied ${formatDateLabel(withdrawn.appliedDate)} · Currently withdrawn`,
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
        const partial = candidates.filter((candidate) => candidate.hasMatchScore && candidate.matchPercent < 75).length;
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
        matchBucketLabel(getMatchBucket(candidate.matchPercent, candidate.hasMatchScore)),
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
    const top = activeCandidates.filter((candidate) => getMatchBucket(candidate.matchPercent, candidate.hasMatchScore) === 'top');
    const good = activeCandidates.filter((candidate) => getMatchBucket(candidate.matchPercent, candidate.hasMatchScore) === 'good');
    const partial = activeCandidates.filter((candidate) => getMatchBucket(candidate.matchPercent, candidate.hasMatchScore) === 'partial');
    const unknown = activeCandidates.filter((candidate) => !candidate.hasMatchScore);
    return { top, good, partial, unknown };
  }, [activeCandidates]);

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
  const isDraftRequestThread = Boolean(selectedThreadCandidate && selectedThreadCandidate.id === draftRequestCandidateId && selectedThreadCandidate.messageRequestState === 'none');
  const canSendMessage = selectedThreadCandidate?.messageRequestState === 'accepted' || isDraftRequestThread;

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
        if (isMounted) { setJobsLoadStatus('error'); showToast('Unable to load employer profile from Supabase.', 'warn'); }
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
        if (isMounted) { setJobsLoadStatus('error'); showToast('Unable to load saved job posts from Supabase.', 'warn'); }
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
      setSelectedJobId(savedJobs[0]?.id || '');
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
        if (isMounted) { setApplicationsLoadStatus('error'); showToast('Unable to load applicants from Supabase.', 'warn'); }
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
        showToast('Required skill already added.', 'warn');
        return;
      }
      setRequiredSkillsDraft((current) => [...current, ...nextSkills]);
      setRequiredSkillInput('');
      return;
    }

    const existing = new Set(niceSkillsDraft.map((skill) => skill.toLowerCase()));
    const nextSkills = uniqueValues.filter((skill) => !existing.has(skill.toLowerCase()));
    if (nextSkills.length === 0) {
      showToast('Nice-to-have skill already added.', 'warn');
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
    if (!jobForm.title.trim()) return 'Job Title is required.';
    if (!jobForm.category.trim()) return 'Job Category is required.';
    if (!jobForm.subcategory.trim()) return 'Subcategory is required.';
    if (!jobForm.experienceLevel.trim()) return 'Experience Level is required.';
    if (!jobForm.description.trim()) return 'Job Description is required.';
    if (!jobForm.responsibilities.trim()) return 'Add at least one responsibility.';
    if (requiredSkillsDraft.length === 0) return 'Add at least one required skill.';
    if (!jobForm.workSetup.trim()) return 'Work Setup is required.';
    if (!jobForm.location.trim()) return 'Location is required.';
    if (!jobForm.salaryRange.trim()) return 'Salary Range is required.';
    const { minimum: minimumSalary, maximum: maximumSalary } = getSalaryAmounts(jobForm.salaryRange);
    if (!minimumSalary || !maximumSalary) return 'Enter a complete salary range.';
    if (minimumSalary < MIN_EMPLOYER_SALARY) return 'Minimum salary must be at least ₱10,000.';
    if (maximumSalary < minimumSalary) return 'Maximum salary must be greater than or equal to the minimum salary.';
    if (!jobForm.deadline.trim()) return 'Application Deadline is required.';
    return null;
  };

  const saveJobForm = async (mode: 'draft' | 'post') => {
    const error = validateJobForm();
    if (error) {
      showToast(error, 'warn');
      return;
    }
    if (!employerProfileId) {
      showToast('Employer profile is still loading. Please try again in a moment.', 'warn');
      return;
    }
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
      showToast('Unable to save job post to Supabase. Please try again.', 'danger');
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
      showToast(mode === 'draft' ? 'Job draft saved.' : 'Job posting updated.', 'success');
    } else {
      const newJob: EmployerJob = { ...savedJob, deadline: jobForm.deadline };
      setJobs((current) => [newJob, ...current]);
      setSelectedJobId(newJob.id);
      showToast(mode === 'draft' ? 'Job saved as draft.' : 'Job posted successfully.', 'success');
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
    showToast('Job closed.', 'warn');
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
    const candidate = applications.find((item) => item.id === candidateId);
    if (!candidate || candidate.status !== 'Interviewing' || candidate.messageRequestState !== 'none') {
      showToast('Message request is not available for this applicant.', 'warn');
      return;
    }
    setDraftRequestCandidateId(candidateId);
    setMessageDraft(`Hi ${candidate.fullName}, we'd like to coordinate next steps for your ${candidate.role} application.`);
    goPage('messages');
    setSelectedThreadId(candidateId);
    closeReview();
    showToast('Customize your message request, then press Send.', 'success');
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
      showToast(messageError instanceof Error ? messageError.message : 'Unable to save message request. Please try again.', 'danger');
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
    }
    setMessageDraft('');
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
                <MetricCard icon="layers" iconClass="rust" number={applicationsLoadStatus === 'ready' ? allApplicationsCount : '—'} label="Total Applications" numberClass="rust" />
                <MetricCard icon="briefcase" iconClass="forest" number={jobsLoadStatus === 'ready' ? openJobsCount : '—'} label="Open Jobs" numberClass="forest" />
                <MetricCard icon="star" iconClass="green" number={applicationsLoadStatus === 'ready' ? topMatchesCount : '—'} label="Top Matches (90%+)" numberClass="green" />
                <MetricCard icon="calendar-check" iconClass="mauve" number={applicationsLoadStatus === 'ready' ? interviewingCount : '—'} label="Interviewing" numberClass="mauve" />
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
                          <button
                            className="emp-btn-secondary"
                            type="button"
                            onClick={() => closeJobPosting(selectedJob.id)}
                            disabled={selectedJob.status === 'closed'}
                            title={selectedJob.status === 'closed' ? 'This job is already closed.' : 'Close this job'}
                          >
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
                      <div className="emp-job-detail-box emp-job-description">{formatJobDescription(selectedJob.description)}</div>

                      <div className="emp-job-detail-section-label">Responsibilities</div>
                      <div className="emp-job-detail-box emp-job-description">
                        {selectedJob.responsibilities.length > 0
                          ? selectedJob.responsibilities.map((item) => `• ${item}`).join('\n')
                          : 'Responsibilities have not yet been provided.'}
                      </div>

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
                      saving={isSavingJob}
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
                    {groupedCandidates.unknown.length > 0 && <CandidateGroup title="Match not available" type="unknown" candidates={groupedCandidates.unknown} onReview={openReview} />}
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
                          const bucket = getMatchBucket(candidate.matchPercent, candidate.hasMatchScore);
                          const bucketColor = bucket === 'top' ? 'text-green' : bucket === 'good' ? 'text-amber' : bucket === 'unknown' ? 'text-soft' : 'text-rust';
                          return (
                            <tr key={candidate.id} className={candidate.status === 'Withdrawn' ? 'withdrawn-row' : ''}>
                              <td>
                                <span className={`font-bold ${candidate.status === 'Withdrawn' ? 'text-soft' : 'text-dark'}`}>{candidate.publicId || 'Not available'}</span>
                                <div className="text-[11px] text-soft">
                                  {shouldRevealIdentity(candidate.status) ? candidate.fullName : maskedName(candidate.fullName)}
                                </div>
                              </td>
                              <td>{candidate.role}</td>
                              <td>
                                <span className="font-display font-extrabold" style={{ color: getMatchColor(candidate.matchPercent) }}>
                                  {scoreLabel(candidate.hasMatchScore ? candidate.matchPercent : null)}
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
                            {candidate.publicId || 'Not available'} · {shouldRevealIdentity(candidate.status) ? candidate.fullName : maskedName(candidate.fullName)}
                          </div>
                          <div className="emp-msg-thread-job">
                            {candidate.role} · <span className={getStatusBadgeClass(candidate.status)}>{candidate.status}</span>
                          </div>
                          <span className={`emp-msg-req ${candidate.messageRequestState}`}>
                            {candidate.id === draftRequestCandidateId && candidate.messageRequestState === 'none'
                              ? 'Draft Request'
                              : candidate.messageRequestState === 'accepted'
                                ? 'Accepted'
                                : 'Request Pending'}
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
                            {selectedThreadCandidate.publicId || 'Not available'} — {selectedThreadCandidate.role}
                          </h4>
                          <p className="text-xs text-soft">
                            {selectedThreadCandidate.status} · {scoreLabel(selectedThreadCandidate.hasMatchScore ? selectedThreadCandidate.matchPercent : null)} match · Message request{' '}
                            {isDraftRequestThread ? 'draft' : selectedThreadCandidate.messageRequestState === 'accepted' ? 'accepted' : 'pending'}
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
                        {isDraftRequestThread && (
                          <div className="emp-msg-status-box pending">
                            <div className="mb-1 font-bold">
                              <UIIcon name="paper-plane" className="mr-1" />
                              Customize Message Request
                            </div>
                            <div className="text-xs">
                              Type the message you want the candidate to receive. The request will be saved when you press Send.
                            </div>
                          </div>
                        )}
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
                        {selectedThreadCandidate.messageRequestState !== 'accepted' && selectedThreadCandidate.messages.map((entry, index) => (
                          <div key={`${selectedThreadCandidate.id}-${index}`} className="flex flex-col">
                            <div className={`emp-msg-bubble-sender ${entry.from === 'employer' ? 'text-right' : ''}`}>
                              {entry.from === 'employer' ? `${companyName} (You)` : selectedThreadCandidate.publicId || 'Candidate'}
                            </div>
                            <div className={entry.from === 'employer' ? 'emp-msg-bubble-employer' : 'emp-msg-bubble-candidate'}>
                              {entry.text}
                            </div>
                            <div className={`emp-msg-bubble-time ${entry.from === 'employer' ? 'text-right' : ''}`}>{entry.time}</div>
                          </div>
                        ))}
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
                                  {entry.from === 'employer' ? `${companyName} (You)` : selectedThreadCandidate.publicId || 'Candidate'}
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
                              ? isDraftRequestThread ? 'Write your message request...' : 'Type your message...'
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
                  <button className="emp-btn-primary" type="button" disabled={isSavingAccount} onClick={() => void saveCompanyProfile()}>
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
                      <label className="emp-form-label">Account &amp; Contact Email</label>
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
                    <button className="emp-btn-primary" type="button" disabled={isSavingAccount} onClick={() => void saveContactDetails()}>
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
                      <input className="emp-input" type="password" value={passwordForm.current} onChange={(event) => setPasswordForm((current) => ({ ...current, current: event.target.value }))} placeholder="Enter current password" />
                    </div>
                    <div className="emp-form-group mb-4">
                      <label className="emp-form-label">New Password</label>
                      <input className="emp-input" type="password" value={passwordForm.next} onChange={(event) => setPasswordForm((current) => ({ ...current, next: event.target.value }))} placeholder="Enter new password" />
                    </div>
                    <div className="emp-form-group mb-4">
                      <label className="emp-form-label">Confirm New Password</label>
                      <input className="emp-input" type="password" value={passwordForm.confirm} onChange={(event) => setPasswordForm((current) => ({ ...current, confirm: event.target.value }))} placeholder="Confirm new password" />
                    </div>
                    <button className="emp-btn-primary" type="button" disabled={isSavingAccount} onClick={() => void updatePassword()}>
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
          description={statusActionMessage(confirmModal.action, applications.find((candidate) => candidate.id === confirmModal.candidateId)?.publicId || 'this candidate')}
          rejectionReason={confirmModal.action === 'rejected' ? rejectionReason : undefined}
          onRejectionReason={confirmModal.action === 'rejected' ? setRejectionReason : undefined}
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

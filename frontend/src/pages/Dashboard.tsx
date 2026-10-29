import { inferRelatedSkills, prepareEvidenceUpload, type EvidenceUploadRecord, type EvidenceType } from '../lib/evidence';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import { validateResumeFile } from '../lib/fileUtils';
import { normalizeEducationLevel } from '../lib/education';
import { deleteEvidence, loadEvidence, saveEvidence } from '../lib/evidenceStore';
import { checkCredentialLink } from '../lib/credentialLinks';
import type { CredentialLinkCheck } from '../lib/evidence';
import { assessmentDueState, formatAssessmentDue, loadAssessments, type CandidateAssessment } from '../lib/assessmentApi';
import { useOnboarding } from '../hooks/useOnboarding';
import { analyzeResume, CONFIRMED_SKILL_LIMIT, fetchAvailableJobs, fetchResumeSummary, fetchSkillGaps, fetchLiveResumeParserVersion, fetchJobDetails, listCandidateNotifications, loadApplicationMessages, loadCandidateAccountSettings, loadMatchFeedback, loadMessageModeration, markAllCandidateNotificationsRead, markCandidateNotificationRead, removedSkillIds, requestAccountDeletion, runJobMatches, saveCandidateAccountSettings, sendApplicationMessage, submitMessageModeration, validateCertificateFile, type MessageModerationState, type MessageReportReason, type AvailableJobItem, type CandidateNotification } from '../lib/api';
import { feedbackErrorMessage, feedbackMapFromRows, matchFeedbackKey, nextMatchVote, type MatchFeedbackStatus, type MatchVote } from '../lib/matchFeedback';
import { getCareerAreaLabel, normalizeCareerAreaValue } from '../lib/careerAreas';
import { supabase } from '../lib/supabase';
import { applyProgressChanges, clearLegacyProgress, diffProgressPart, hasLegacyProgress, hasProgressChanges, loadCandidateProgress, mergeLoadedProgress, PROGRESS_PARTS, readLegacyProgress, saveProgressChanges, type CandidateProgress, type ProgressHelpers } from '../lib/candidateProgress';
import { updateCandidateProfile } from '../lib/auth';
import { loadLatestMatchRun, loadLatestResume, saveMatchHistory, saveResumeAnalysis, type ExistingResumeFile, type SavedResumeRecord } from '../lib/userData';
import { assessSavedResume, extractionWarnings, staleResumeMessage, type SavedResumeFreshness } from '../lib/resumeFreshness';
import type { GapGroupBy, GapScope, ParsedResume, ResumeSummary, SelectedSkill, SkillGapReport, SurveyAnswers } from '../types';
import ExternalJobAnalysisPage from './ExternalJobAnalysisPage';
import { isLocationPreferenceComplete, locationPreferencePayload, normalizeLocationScope } from '../lib/regionPreference';
import { FIT_NOW_MATCH_PERCENT, classifySkillCategory, cleanSkillDisplayName, skillRecordKey, type ClaimedSkill, externalJobUrl, knownValue, type MatchView, SKILL_PROGRESS_PERCENT, defaultSurveyAnswers, deriveEvidenceCategory, extractResumeText, extractSkillsFromResume, getCourseSkillLabels, getInitials, getPreferenceLabel, legacySalaryLabels, loadProfilePreferences, mapApplicationRow, mapAvailableJob, mapCourse, mapModelGap, mapModelMatch, mapRunGap, mapRunLearningRecommendation, mapRunMatch, mergeSupabaseJobDetails, normalizeSavedResumeAnalysis, normalizeSkill, orderByBackendRank, persistMatchVote, salaryLabels, setupLabels, type ApplicationStatus, type CourseCompletion, type DashboardApplication, type DashboardCourse, type DashboardGap, type DashboardJob, type DashboardPage, type EvidencePrefill, type JobApplicationRow, type MessageRequestState, type ResumeAnalyzeResponse, type SkillProgressRecord, type SkillProgressStatus, type ToastType, type UiLanguage, withExtractedEducation, withMatchVote } from './candidate/model';
import { useLocation, useNavigate } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faDownload } from '@fortawesome/free-solid-svg-icons';
import { Banner, ConfirmDialog, DESKTOP_QUERY, Modal, ToastRegion, useMediaQuery, type ToastState } from '../components/ui';
import { CandidateShell } from './candidate/Shell';
import { PAGE_PATHS, pageFromPath } from './candidate/routes';
import { HomePage, type HomeGap, type NextStep, type ProfileTask } from './candidate/HomePage';
import { JobMatchesPage } from './candidate/MatchesPage';
import { SkillGapsPage, type GapLoadStatus } from './candidate/SkillGapsPage';
import { appliedJobRefs, gapJobInputs, gapRecordKey, openAndCompleted, requirementSummary, savedJobRefs, taxonomyIdOf } from './candidate/skillGaps';
import { ResumeSummaryCard, type ResumeSummaryVote } from './candidate/ResumeSummaryCard';
import { ApplicationsPage } from './candidate/ApplicationsPage';
import { PreferencesPage } from './candidate/PreferencesPage';
import { AccountSettingsPage } from './candidate/AccountSettingsPage';
import { KareersPage } from './candidate/KareersPage';
import { UpskillingPage } from './candidate/LearningPage';
import { MessagesPage } from './candidate/MessagesPage';
import { JobDetailModal } from './candidate/JobDetailModal';
import { EvidenceFormModal, ResumeUpdateModal } from './candidate/modals';
import { ReportConversationModal } from '../components/ReportConversationModal';
import './candidate-dashboard-v5.css';

type DashboardProps = {
  currentUser: { id?: string; name: string; email: string } | null;
  onHome: () => void;
  onLogin: () => void;
  onSignUp: () => void;
  onUpdateResume: () => void;
  onLogout: () => void;
};

const PROGRESS_HELPERS: ProgressHelpers = { keyOf: skillRecordKey, categoryOf: classifySkillCategory };

function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The skill list with every claimed skill in it (claims count as the candidate's skills). */
function withClaimedSkillNames(names: string[], claimed: Record<string, ClaimedSkill>): string[] {
  const merged = [...names];
  Object.values(claimed).forEach((item) => {
    if (!merged.some((name) => normalizeSkill(name) === normalizeSkill(item.skillName))) merged.push(item.skillName);
  });
  return merged;
}

export default function Dashboard({ currentUser, onHome, onLogin, onSignUp, onUpdateResume, onLogout }: DashboardProps) {
  void onLogin;
  void onSignUp;

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-bg px-6 py-16">
        <div className="mx-auto max-w-lg rounded-xl border border-bdr bg-card p-6 text-center">
          <h2 className="font-display text-2xl font-bold text-dark">Candidate Dashboard is for registered users only</h2>
          <p className="mt-2 text-sm text-soft-text">Please sign in to access your dashboard, matches, applications, and progress records.</p>
        </div>
      </div>
    );
  }

  // Keyed by account, so another sign-in never starts from the previous user's state.
  return <CandidateWorkspace key={currentUser.id || currentUser.email} currentUser={currentUser} onHome={onHome} onUpdateResume={onUpdateResume} onLogout={onLogout} />;
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

  const location = useLocation();
  const navigate = useNavigate();
  // Each page has its own URL, so Back, refresh and shared links work.
  const activePage = pageFromPath(location.pathname);
  const setActivePage = useCallback((page: DashboardPage) => {
    if (PAGE_PATHS[page] !== location.pathname) navigate(PAGE_PATHS[page]);
  }, [location.pathname, navigate]);
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [activePage]);
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const [jobSearch, setJobSearch] = useState('');
  const [matchView, setMatchView] = useState<MatchView>('fit-now');
  const [learningFocus, setLearningFocus] = useState<{ skill?: string }>({});
  const [applyTarget, setApplyTarget] = useState<DashboardJob | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  const [savedJobs, setSavedJobs] = useState<Set<string>>(() => new Set());
  const [applications, setApplications] = useState<DashboardApplication[]>([]);
  const [applicationLoadStatus, setApplicationLoadStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [notifications, setNotifications] = useState<CandidateNotification[]>([]);
  const [notificationLoadStatus, setNotificationLoadStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [toast, setToast] = useState<ToastState>(null);
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
  // The application "View application" should bring into view on the Applications page.
  const [focusedApplicationId, setFocusedApplicationId] = useState<string | null>(null);
  const clearFocusedApplication = useCallback(() => setFocusedApplicationId(null), []);
  const [selectedJob, setSelectedJob] = useState<DashboardJob | null>(null);
  const [withdrawModalOpen, setWithdrawModalOpen] = useState(false);
  const [withdrawTarget, setWithdrawTarget] = useState<DashboardApplication | null>(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [resumeModalOpen, setResumeModalOpen] = useState(false);
  const [evidenceModalOpen, setEvidenceModalOpen] = useState(false);
  const [evidenceMode, setEvidenceMode] = useState<'file' | 'link' | undefined>(undefined);
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
  // An analysis restored from an earlier session, and whether its original file
  // is still stored, so an analysis made by an older reader is never shown as new.
  const [savedResumeFreshness, setSavedResumeFreshness] = useState<SavedResumeFreshness | null>(null);
  const [savedResumeFile, setSavedResumeFile] = useState<ExistingResumeFile | null>(null);
  // Set while the modal re-scans the stored original, so saving reuses that file.
  const reusedResumeFile = useRef<ExistingResumeFile | null>(null);
  const [resumePreview, setResumePreview] = useState<{ url: string; name: string; mimeType: string; local: boolean } | null>(null);
  // What loading the previewed file produced, keyed by its URL: rendered HTML for
  // Word, an in-memory blob for PDF (also the source of the Download link), or why it failed.
  const [docxPreviewResult, setDocxPreviewResult] = useState<{ url: string; html: string; blobUrl: string; error: string } | null>(null);
  const [resumePreviewAttempt, setResumePreviewAttempt] = useState(0);
  const [candidatePublicId, setCandidatePublicId] = useState('');
  // Gap skills the candidate says they already have. Saved to the account
  // (with skill progress and course completions, below) so they stay in the
  // skill list and out of learning suggestions on every device.
  const [claimedSkills, setClaimedSkills] = useState<Record<string, ClaimedSkill>>({});
  const withClaimedSkills = (names: string[]) => withClaimedSkillNames(names, claimedSkills);
  // The latest claims, for actions that run later (a toast's Undo).
  const claimedSkillsRef = useRef(claimedSkills);
  useEffect(() => {
    claimedSkillsRef.current = claimedSkills;
  }, [claimedSkills]);
  const [skillNames, setSkillNames] = useState<string[]>(() => withClaimedSkills(extractSkillsFromResume(state.resume)));
  const [selectedThreadJobId, setSelectedThreadJobId] = useState<string>('');
  const [messageRequests, setMessageRequests] = useState<Record<string, string>>({});
  const [messageDraft, setMessageDraft] = useState('');
  const [messageModeration, setMessageModeration] = useState<Record<string, MessageModerationState>>({});
  const [messageLoadError, setMessageLoadError] = useState('');
  const [reportTarget, setReportTarget] = useState<DashboardApplication | null>(null);
  const [blockTarget, setBlockTarget] = useState<DashboardApplication | null>(null);
  const [messageReplies, setMessageReplies] = useState<Record<string, Array<{ from: 'employer' | 'candidate'; text: string; time: string }>>>({});
  const [extraPreferences, setExtraPreferences] = useState({ jobLevel: '', preferredLocation: '' });
  const [availableJobs, setAvailableJobs] = useState<AvailableJobItem[]>([]);
  const [isLoadingKareers, setIsLoadingKareers] = useState(true);
  const [kareersError, setKareersError] = useState<string | null>(null);
  // Only explicit evidence uploads belong here; resume mentions are not uploaded or verified evidence.
  const [evidenceRecords, setEvidenceRecords] = useState<EvidenceUploadRecord[]>([]);
  // Saved to the account, like course completions, so Done and In progress
  // (and the Completed section) survive a reload and match on every device.
  const [skillProgressRecords, setSkillProgressRecords] = useState<Record<string, SkillProgressRecord>>({});
  const [courseCompletions, setCourseCompletions] = useState<Record<string, CourseCompletion>>({});
  // Loading and saving those three (lib/candidateProgress). Nothing is saved
  // until the account's copy has loaded, so a slow or failed load never
  // overwrites it.
  const [progressLoad, setProgressLoad] = useState<{ status: 'loading' | 'ready' | 'error'; error: string }>(() => (
    currentUser.id ? { status: 'loading', error: '' } : { status: 'error', error: 'Sign in again to load your saved skills and progress.' }
  ));
  const [progressLoadAttempt, setProgressLoadAttempt] = useState(0);
  const [progressSaveError, setProgressSaveError] = useState('');
  // Bumped after each save, and by Retry, so changes made meanwhile are saved too.
  const [progressSaveTick, setProgressSaveTick] = useState(0);
  // The copy the account holds, as far as this page knows: what changed since is saved.
  const savedProgressRef = useRef<CandidateProgress>({ claimedSkills: {}, skillProgress: {}, courseCompletions: {} });
  const progressSavingRef = useRef(false);
  // This browser still holds data from before progress was saved to the account.
  const legacyProgressPendingRef = useRef(false);
  const [evidenceCourseTarget, setEvidenceCourseTarget] = useState<DashboardCourse | null>(null);
  // A skill marked done without a course: its proof updates that skill's progress.
  const [evidenceSkillTarget, setEvidenceSkillTarget] = useState<{ key: string; gap: DashboardGap } | null>(null);
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
  // The profile location decides the current region; wait for it before saying there is none.
  const [accountSettingsLoaded, setAccountSettingsLoaded] = useState(false);
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

  useEffect(() => {
    const extracted = extractSkillsFromResume(state.resume);
    if (extracted.length > 0) setSkillNames(withClaimedSkills(extracted));
    // Claimed skills are read from storage, not a dependency: they only matter when the resume changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.resume?.skills]);

  useEffect(() => {
    if (!resumePreview) return;
    const name = resumePreview.name.toLowerCase();
    const isPdf = resumePreview.mimeType.includes('pdf') || name.endsWith('.pdf');
    const isDocx = resumePreview.mimeType.includes('wordprocessingml') || name.endsWith('.docx');
    if (!isPdf && !isDocx) return;

    let cancelled = false;
    let blobUrl = '';
    const failed = (message: string) => {
      if (!cancelled) setDocxPreviewResult({ url: resumePreview.url, html: '', blobUrl: '', error: message });
    };

    const loadPreview = async () => {
      try {
        const response = await fetch(resumePreview.url);
        if (!response.ok) {
          failed(response.status === 400 || response.status === 404
            ? 'This resume file could not be found. It may have been moved or deleted; upload it again.'
            : `The resume could not be loaded (error ${response.status}). Please try again.`);
          return;
        }
        if (isPdf) {
          const blob = await response.blob();
          blobUrl = URL.createObjectURL(blob.type === 'application/pdf' ? blob : new Blob([blob], { type: 'application/pdf' }));
          if (cancelled) { URL.revokeObjectURL(blobUrl); return; }
          setDocxPreviewResult({ url: resumePreview.url, html: '', blobUrl, error: '' });
          return;
        }
        // Loaded only when a Word resume is previewed; it is large.
        const mammoth = await import('mammoth');
        const result = await mammoth.convertToHtml({ arrayBuffer: await response.arrayBuffer() });
        if (!cancelled) setDocxPreviewResult({ url: resumePreview.url, html: DOMPurify.sanitize(result.value), blobUrl: '', error: '' });
      } catch (error) {
        console.warn('Unable to load resume preview:', error);
        failed('Unable to preview this resume. Please try again, download it, or upload a new copy.');
      }
    };

    void loadPreview();
    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [resumePreview, resumePreviewAttempt]);

  // Load the account's claimed skills, skill progress and course completions.
  // Data an older version kept in this browser is imported once: it fills in
  // what the account lacks and is removed from the browser once saved.
  const progressUserKey = currentUser.id || currentUser.email;
  useEffect(() => {
    const userId = currentUser.id;
    if (!userId) return;
    let cancelled = false;
    loadCandidateProgress(userId, PROGRESS_HELPERS).then((saved) => {
      if (cancelled) return;
      const legacy = readLegacyProgress(browserStorage(), progressUserKey);
      legacyProgressPendingRef.current = hasLegacyProgress(legacy);
      savedProgressRef.current = saved;
      setClaimedSkills((current) => mergeLoadedProgress(current, legacy.claimedSkills, saved.claimedSkills));
      setSkillProgressRecords((current) => mergeLoadedProgress(current, legacy.skillProgress, saved.skillProgress));
      setCourseCompletions((current) => mergeLoadedProgress(current, legacy.courseCompletions, saved.courseCompletions));
      // Claimed skills join the skill list used for matching.
      setSkillNames((current) => withClaimedSkillNames(current, { ...legacy.claimedSkills, ...saved.claimedSkills }));
      setProgressLoad({ status: 'ready', error: '' });
    }, (error: unknown) => {
      if (cancelled) return;
      console.warn('Unable to load candidate progress:', error);
      setProgressLoad({ status: 'error', error: error instanceof Error ? error.message : 'Unable to load your saved skills and progress.' });
    });
    return () => { cancelled = true; };
  }, [currentUser.id, progressUserKey, progressLoadAttempt]);

  // Save what changed since the last save, shortly after the change, so a burst
  // of updates (a course moving several skills) is one write per table.
  useEffect(() => {
    const userId = currentUser.id;
    if (progressLoad.status !== 'ready' || !userId || progressSavingRef.current) return;
    const current: CandidateProgress = { claimedSkills, skillProgress: skillProgressRecords, courseCompletions };
    const changes = PROGRESS_PARTS
      .map((part) => ({ part, change: diffProgressPart(part, savedProgressRef.current, current) }))
      .filter(({ change }) => hasProgressChanges(change));
    if (changes.length === 0) {
      if (legacyProgressPendingRef.current) {
        clearLegacyProgress(browserStorage(), progressUserKey);
        legacyProgressPendingRef.current = false;
      }
      return;
    }
    const timer = window.setTimeout(() => {
      progressSavingRef.current = true;
      void (async () => {
        let failure = '';
        for (const { part, change } of changes) {
          try {
            await saveProgressChanges(userId, part, change);
            savedProgressRef.current = applyProgressChanges(savedProgressRef.current, part, change);
          } catch (error) {
            console.warn('Unable to save candidate progress:', error);
            failure ||= error instanceof Error ? error.message : 'Unable to save your progress.';
          }
        }
        progressSavingRef.current = false;
        setProgressSaveError(failure);
        // After a failure, the next change or Retry tries again; no retry loop.
        // The page banner shows the full error with Try again.
        if (failure) showToast("Your change wasn't saved to your account.", 'danger');
        else setProgressSaveTick((tick) => tick + 1);
      })();
    }, 400);
    return () => window.clearTimeout(timer);
  }, [claimedSkills, courseCompletions, currentUser.id, progressLoad.status, progressSaveTick, progressUserKey, skillProgressRecords]);

  const retryProgressSync = () => {
    if (progressLoad.status === 'error') {
      if (!currentUser.id) return;
      setProgressLoad({ status: 'loading', error: '' });
      setProgressLoadAttempt((attempt) => attempt + 1);
      return;
    }
    setProgressSaveError('');
    setProgressSaveTick((tick) => tick + 1);
  };

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
      const data = await loadCandidateAccountSettings().catch((error) => {
        if (isMounted) setAccountSettingsLoaded(true);
        throw error;
      });
      if (!isMounted) return;
      setAccountSettingsLoaded(true);
      if (!data) return;
      setAccountIdentity({ name: data.full_name || currentUser.name, email: data.email || currentUser.email });
      setCandidatePublicId(String(data.public_id || ''));
      setProfileForm((current) => ({
        ...current,
        contactNumber: data.contact_number || current.contactNumber,
        address: data.address || current.address,
        birthday: data.birthday || current.birthday,
        location: data.location || current.location,
        highestEducationalAttainment: normalizeEducationLevel(data.highest_educational_attainment) || current.highestEducationalAttainment,
        degreeProgram: data.degree_program || current.degreeProgram,
        schoolUniversity: data.school_university || current.schoolUniversity,
        yearGraduated: data.year_graduated || current.yearGraduated,
      }));
    })().catch((error) => { if (isMounted) console.warn('Unable to load account settings:', error); });
    return () => {
      isMounted = false;
    };
  }, [currentUser.id]);

  const [matchFeedback, setMatchFeedback] = useState<Record<string, MatchVote>>({});
  const [matchFeedbackStatus, setMatchFeedbackStatus] = useState<Record<string, MatchFeedbackStatus>>({});

  useEffect(() => {
    let isMounted = true;
    if (!currentUser.id) return undefined;
    loadMatchFeedback()
      .then((rows) => { if (isMounted) setMatchFeedback(feedbackMapFromRows(rows)); })
      // Rating still works without the saved ratings; they just are not preselected.
      .catch((error) => { if (isMounted) console.warn('Unable to load match ratings:', error); });
    return () => { isMounted = false; };
  }, [currentUser.id]);

  // The buttons are disabled while a rating saves, so the state read here is current.
  const submitMatchFeedback = (job: DashboardJob, clicked: MatchVote) => {
    const key = matchFeedbackKey(job.id, job.jobSource);
    const previous = matchFeedback[key] ?? null;
    const next = nextMatchVote(previous, clicked);
    setMatchFeedback((current) => withMatchVote(current, key, next));
    setMatchFeedbackStatus((current) => ({ ...current, [key]: { state: 'saving', vote: next } }));
    persistMatchVote(job, next).then(
      () => setMatchFeedbackStatus((current) => ({ ...current, [key]: { state: 'idle' } })),
      (error: unknown) => {
        setMatchFeedback((current) => withMatchVote(current, key, previous));
        setMatchFeedbackStatus((current) => ({
          ...current,
          [key]: { state: 'error', message: feedbackErrorMessage(error), retryVote: clicked },
        }));
      },
    );
  };

  // A failed load must not read as "no saved jobs", so it is shown with a retry.
  const [savedJobsError, setSavedJobsError] = useState('');
  const [savedJobsAttempt, setSavedJobsAttempt] = useState(0);
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
          setSavedJobsError('Your saved jobs could not be loaded.');
          return;
        }
        setSavedJobsError('');
        setSavedJobs(new Set((data || []).map((row) => String(row.job_id)).filter(Boolean)));
      });
    return () => { isMounted = false; };
  }, [currentUser.id, savedJobsAttempt]);

  const locateSavedResumeFile = async (latestResume: SavedResumeRecord | null): Promise<ExistingResumeFile | null> => {
    if (!currentUser.id || !latestResume) return null;
    let storageBucket = latestResume.storage_bucket || 'resumes';
    let storagePath = latestResume.storage_path || '';
    let mimeType = latestResume.file_mime_type || '';
    let size = latestResume.file_size_bytes || null;

    // Older resume rows may not contain storage metadata even though the file was
    // successfully uploaded. Recover the newest file from this user's private folder.
    if (!storagePath) {
      const { data: storedFiles, error: listError } = await supabase.storage
        .from(storageBucket)
        .list(currentUser.id, { limit: 100, sortBy: { column: 'created_at', order: 'desc' } });
      const newestFile = storedFiles?.find((file) => file.name && file.name !== '.emptyFolderPlaceholder');
      if (listError || !newestFile) {
        if (listError) console.warn('Unable to locate saved resume file:', listError);
        return null;
      }
      storageBucket = 'resumes';
      storagePath = `${currentUser.id}/${newestFile.name}`;
      mimeType = mimeType || String(newestFile.metadata?.mimetype || '');
      size = size || Number(newestFile.metadata?.size) || null;
    }
    const name = latestResume.original_filename || storagePath.split('/').pop() || 'resume';
    return { bucket: storageBucket, path: storagePath, name, mimeType, size };
  };

  // Restore the saved resume, its latest matches and the preferences once per
  // sign-in. This must not re-run on the state it restores: each re-run cancelled
  // the one before it, so a fresh login never got its matches or preferences back.
  const restoredForUser = useRef<string | null>(null);
  // Set when the saved resume or matches could not be read, so the dashboard says
  // so instead of showing an empty "upload your resume" state.
  const [restoreError, setRestoreError] = useState('');
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  useEffect(() => {
    const userId = currentUser.id;
    const restoreKey = `${userId}:${restoreAttempt}`;
    if (!userId || restoredForUser.current === restoreKey) return;
    restoredForUser.current = restoreKey;
    let cancelled = false;
    const hasSessionResume = Boolean(state.resumeAnalysis || state.resumeFile || state.savedResumeId);
    const hasSessionPreferences = Boolean(state.surveyAnswers);
    void (async () => {
      setRestoreError('');
      const latestResume = await loadLatestResume({ userId });
      if (cancelled) return;
      let savedPreferences: SurveyAnswers | null = null;

      if (latestResume) {
        setSavedResumeFileName(latestResume.original_filename || 'Saved resume');
        let freshness = assessSavedResume(latestResume);
        if (freshness?.stale) {
          const liveVersion = await fetchLiveResumeParserVersion();
          if (cancelled) return;
          if (liveVersion !== undefined) freshness = assessSavedResume(latestResume, liveVersion);
        }
        setSavedResumeFreshness(freshness);
        if (freshness?.stale) {
          const located = await locateSavedResumeFile(latestResume);
          if (cancelled) return;
          setSavedResumeFile(located);
        }

        if (hasSessionResume) {
          if (!state.savedResumeId) setSavedResumeId(latestResume.id);
        } else {
          const analysis = normalizeSavedResumeAnalysis(latestResume);
          if (analysis) {
            applyAnalysisResult(analysis);
            setSavedResumeId(latestResume.id);
            const restoredSkills = extractSkillsFromResume(analysis.parsedResume);
            if (restoredSkills.length > 0) setSkillNames(restoredSkills);

            const savedRun = await loadLatestMatchRun({ userId, resumeId: latestResume.id });
            if (cancelled) return;
            if (savedRun) setMatchResults(savedRun.results);
            savedPreferences = savedRun?.preferences || null;
          }
        }
      }

      if (hasSessionPreferences) return;
      // Preferences saved without a match run (no resume yet, or a failed
      // refresh) only live on the candidate profile.
      if (!savedPreferences) savedPreferences = await loadProfilePreferences(userId);
      if (!cancelled && savedPreferences) setSurveyAnswers(savedPreferences);
    })().catch((error: unknown) => {
      if (cancelled) return;
      console.warn('Unable to restore the saved resume and matches:', error);
      setRestoreError(error instanceof Error ? error.message : 'Unable to load your saved resume and matches.');
    });

    return () => {
      cancelled = true;
      restoredForUser.current = null;
    };
  }, [currentUser.id, restoreAttempt]);

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
      const closest = (state.matchResults.all_closest_matches || state.matchResults.closest_matches || [])
        .map((match) => restoreCatalogIdentity(mapRunMatch(match, 'aspiration')))
        .filter((job) => !fitNowIds.has(job.id));
      const listedIds = new Set([...fitNowIds, ...closest.map((job) => job.id)]);
      const aspiration = (state.matchResults.all_aspiration_matches || state.matchResults.aspiration_matches || [])
        .map((match) => restoreCatalogIdentity(mapRunMatch(match, 'aspiration')))
        .filter((job) => !listedIds.has(job.id));
      return [...fitNow, ...closest, ...aspiration].sort((a, b) => b.matchScore - a.matchScore);
    }
    if (state.results?.jobMatches?.length) {
      return state.results.jobMatches.map((match) => restoreCatalogIdentity(mapModelMatch(match))).sort((a, b) => b.matchScore - a.matchScore);
    }
    return [];
  }, [availableJobs, state.matchResults, state.results?.jobMatches]);

  // Employers change application stages and send message requests, so the list
  // is re-read every 30 seconds and when the tab regains focus.
  useEffect(() => {
    let isMounted = true;
    let loadedOnce = false;
    const loadApplications = async () => {
      if (!currentUser.id) return;
      const { data, error } = await supabase
        .from('job_applications')
        .select('*')
        .eq('user_id', currentUser.id)
        .order('applied_at', { ascending: false });

      if (error) {
        console.warn('Unable to load applications:', error);
        // A failed background refresh keeps the list already shown.
        if (isMounted && !loadedOnce) setApplicationLoadStatus('error');
        return;
      }

      if (!isMounted) return;
      loadedOnce = true;
      const rows = Array.isArray(data) ? (data as JobApplicationRow[]) : [];
      setApplications(rows.map((row) => mapApplicationRow(row, jobs)));
      setApplicationLoadStatus('ready');
    };
    void loadApplications();
    const refresh = () => { if (document.visibilityState === 'visible') void loadApplications(); };
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener('focus', refresh);

    return () => {
      isMounted = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [currentUser.id, jobs]);

  const gaps = useMemo<DashboardGap[]>(() => {
    if (state.matchResults?.skill_gaps?.length) {
      return state.matchResults.skill_gaps.map(mapRunGap);
    }
    if (state.matchResults?.prioritized_skill_gaps?.length) {
      return state.matchResults.prioritized_skill_gaps.map(mapRunGap);
    }
    if (state.results?.skillGaps?.length) {
      return state.results.skillGaps.map((gap) => mapModelGap(gap, state.results?.jobMatches || []));
    }
    return [];
  }, [state.matchResults?.skill_gaps, state.matchResults?.prioritized_skill_gaps, state.results?.jobMatches, state.results?.skillGaps]);


  const courses = useMemo<DashboardCourse[]>(() => {
    if (state.matchResults?.learning_recommendations?.length) {
      return state.matchResults.learning_recommendations.map(mapRunLearningRecommendation).filter((course) => course.reviewed);
    }
    return (state.results?.courseRecommendations || []).map(mapCourse).filter((course) => course.reviewed);
  }, [state.matchResults?.learning_recommendations, state.results?.courseRecommendations]);

  // Which matches the Skills page's gaps come from, and how they are grouped.
  const gapScopeStorageKey = `kareerly.gapScope.${currentUser.id || currentUser.email}`;
  const [gapScope, setGapScopeState] = useState<GapScope>(() => {
    try {
      const saved = window.localStorage.getItem(gapScopeStorageKey);
      return saved === 'fit_now' || saved === 'saved' || saved === 'all' ? saved : 'default';
    } catch {
      return 'default';
    }
  });
  const setGapScope = (scope: GapScope) => {
    setGapScopeState(scope);
    try {
      window.localStorage.setItem(gapScopeStorageKey, scope);
    } catch {
      // Storage can be unavailable; the choice still applies for this session.
    }
  };
  const [gapGroupBy, setGapGroupBy] = useState<GapGroupBy>('skill');
  const [gapReload, setGapReload] = useState(0);
  // Each response is kept with the request it answers, so loading is derived, not set.
  type GapResult = { key: string; report: SkillGapReport | null; error: string };
  const [gapResult, setGapResult] = useState<GapResult>({ key: '', report: null, error: '' });
  const [jobGapResult, setJobGapResult] = useState<GapResult>({ key: '', report: null, error: '' });
  // Every match with its missing skills, plus the saved and applied jobs; the
  // backend regroups them by skill (skill_gap_config.py holds the rules).
  const gapRequest = useMemo(() => ({
    matches: gapJobInputs(jobs),
    savedJobs: savedJobRefs(savedJobs, jobs),
    appliedJobs: appliedJobRefs(applications),
  }), [applications, jobs, savedJobs]);
  const gapRequestKey = JSON.stringify(gapRequest);

  const hasGapMatches = gapRequest.matches.length > 0;
  const gapFetchKey = `${gapRequestKey}|${gapScope}|${gapReload}`;
  const jobGapFetchKey = `${gapFetchKey}|job`;
  useEffect(() => {
    if (!hasGapMatches) return undefined;
    let cancelled = false;
    fetchSkillGaps(gapRequest, { groupBy: 'skill', scope: gapScope, includeCourses: true }).then(
      (report) => { if (!cancelled) setGapResult({ key: gapFetchKey, report, error: '' }); },
      (error: unknown) => {
        if (!cancelled) setGapResult((current) => ({ ...current, key: gapFetchKey, error: error instanceof Error ? error.message : 'Your skill gaps could not be loaded.' }));
      },
    );
    return () => { cancelled = true; };
    // gapFetchKey stands for gapRequest, the scope and a retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gapFetchKey]);

  useEffect(() => {
    if (gapGroupBy !== 'job' || !hasGapMatches) return undefined;
    let cancelled = false;
    fetchSkillGaps(gapRequest, { groupBy: 'job', scope: gapScope }).then(
      (report) => { if (!cancelled) setJobGapResult({ key: jobGapFetchKey, report, error: '' }); },
      (error: unknown) => {
        if (!cancelled) setJobGapResult({ key: jobGapFetchKey, report: null, error: error instanceof Error ? error.message : 'Your skill gaps could not be loaded.' });
      },
    );
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobGapFetchKey, gapGroupBy]);

  // The last report stays on screen while a newer one loads (after a scope change or a claim).
  const gapReport = hasGapMatches ? gapResult.report : null;
  const jobGapReport = hasGapMatches && jobGapResult.key === jobGapFetchKey ? jobGapResult.report : null;
  const gapError = gapResult.key === gapFetchKey ? gapResult.error : jobGapResult.key === jobGapFetchKey ? jobGapResult.error : '';
  const gapStatus: GapLoadStatus = !hasGapMatches ? 'idle'
    : gapError ? 'error'
      : gapResult.key === gapFetchKey ? 'ready' : 'loading';

  // Open and completed skills as every view shows them.
  const { open: openGapSkills } = useMemo(
    () => openAndCompleted(gapReport, claimedSkills, skillProgressRecords),
    [claimedSkills, gapReport, skillProgressRecords],
  );

  // A progress record for every gap skill across all matches (not just the
  // chosen scope). A record whose skill is no longer a gap anywhere is covered.
  useEffect(() => {
    if (!gapReport) return;
    setSkillProgressRecords((current) => {
      const next = { ...current };
      const activeKeys = new Set<string>();

      gapReport.all_skills.forEach((skill) => {
        const skillId = taxonomyIdOf(skill.skill_id);
        const key = gapRecordKey({ taxonomy_skill_id: skillId, skill_name: skill.skill_name });
        activeKeys.add(key);
        const category = classifySkillCategory(skill.skill_name);
        const firstCourse = gapReport.courses_by_skill?.[skill.skill_id]?.courses?.[0]?.resource_id;
        if (!next[key]) {
          next[key] = {
            skillId: skillId || undefined,
            skillName: skill.skill_name,
            category,
            categoryName: category,
            status: 'missing',
            progressPercent: SKILL_PROGRESS_PERCENT.missing,
            selectedResourceId: firstCourse,
          };
        } else {
          next[key] = {
            ...next[key],
            skillId: skillId || next[key].skillId,
            skillName: skill.skill_name,
            // A skill that is a gap again starts over from Not started.
            ...(next[key].status === 'covered' ? { status: 'missing' as const, progressPercent: SKILL_PROGRESS_PERCENT.missing } : {}),
            selectedResourceId: next[key].selectedResourceId || firstCourse,
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
    // Runs again once saved progress has loaded, so saved records are checked
    // against the current gaps too.
  }, [gapReport, progressLoad.status]);

  // Candidate Assessments waiting for an answer, so the Home page can show what is due and when.
  const [pendingAssessments, setPendingAssessments] = useState<CandidateAssessment[]>([]);
  const assessmentApplicationKey = applications.map((application) => application.id).join(',');
  useEffect(() => {
    if (!assessmentApplicationKey) return undefined;
    let mounted = true;
    const refresh = () => void loadAssessments(assessmentApplicationKey.split(','))
      .then((rows) => { if (mounted) setPendingAssessments(Array.from(rows.values()).filter((item) => item.status === 'pending')); })
      .catch(() => { if (mounted) setPendingAssessments([]); });
    refresh();
    const timer = window.setInterval(refresh, 60000);
    return () => { mounted = false; window.clearInterval(timer); };
  }, [assessmentApplicationKey]);
  const assessmentsDue = useMemo(() => [...pendingAssessments]
    .sort((a, b) => Date.parse(a.dueAt || '9999') - Date.parse(b.dueAt || '9999'))
    .map((item) => ({
      applicationId: item.applicationId,
      jobTitle: applications.find((application) => application.id === item.applicationId)?.jobTitle || 'your application',
      dueText: item.dueAt ? formatAssessmentDue(item.dueAt) : 'soon',
      overdue: assessmentDueState(item) === 'overdue',
    })), [pendingAssessments, applications]);

  const recentApplications = useMemo(
    () =>
      applications
        .slice()
        .sort((a, b) => b.dateApplied.localeCompare(a.dateApplied))
        .slice(0, 3),
    [applications],
  );

  const topMissingSkills = useMemo<HomeGap[]>(() => openGapSkills.slice(0, 3).map((skill) => ({
    key: skill.skill_id, name: skill.skill_name, detail: requirementSummary(skill), tierLabel: skill.tier_label,
  })), [openGapSkills]);

  const unreadNotificationCount = useMemo(() => notifications.filter((row) => !row.read_at).length, [notifications]);
  const loadNotifications = useCallback(async (): Promise<CandidateNotification[] | null> => {
    if (!currentUser.id) return null;
    try {
      const rows = await listCandidateNotifications();
      setNotifications(rows);
      setNotificationLoadStatus('ready');
      return rows;
    } catch (notificationError) {
      console.warn('Unable to load notifications:', notificationError);
      setNotificationLoadStatus('error');
      return null;
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

  const fitNowJobs = useMemo(() => orderByBackendRank(jobs.filter((job) => job.matchCategory === 'fit-now')), [jobs]);
  const aspirationJobs = useMemo(() => orderByBackendRank(jobs.filter((job) => job.matchCategory === 'aspiration')), [jobs]);
  // "Your resume at a glance": template sentences from the backend, never free text.
  const [summaryResult, setSummaryResult] = useState<{ key: string; summary: ResumeSummary | null; failed: boolean }>({ key: '', summary: null, failed: false });
  // The answer is kept with the resume version it is about.
  const [summaryVote, setSummaryVote] = useState<{ version: string; vote: ResumeSummaryVote | null }>({ version: '', vote: null });
  const [resumeSummarySaving, setResumeSummarySaving] = useState(false);
  const summaryInput = useMemo(() => {
    const resume = state.resume || state.resumeAnalysis?.parsedResume;
    const resumeText = resume ? extractResumeText(resume) : '';
    const analysisSkills = (state.resumeAnalysis?.candidate_profile?.skills || [])
      .slice()
      .sort((a, b) => (b.skill_priority_score ?? 0) - (a.skill_priority_score ?? 0))
      .map((skill) => skill.skill_name);
    return {
      resumeText,
      skills: analysisSkills.length ? analysisSkills : extractSkillsFromResume(state.resume),
      roleLevel: surveyAnswers.role || '',
      fitNowTitles: fitNowJobs.map((job) => job.title),
      aspirationTitles: aspirationJobs.map((job) => job.title),
    };
  }, [aspirationJobs, fitNowJobs, state.resume, state.resumeAnalysis, surveyAnswers.role]);
  const summaryInputKey = JSON.stringify(summaryInput);

  useEffect(() => {
    if (!summaryInput.resumeText) return undefined;
    let cancelled = false;
    fetchResumeSummary(summaryInput).then(
      (summary) => { if (!cancelled) setSummaryResult({ key: summaryInputKey, summary, failed: false }); },
      (error: unknown) => {
        if (cancelled) return;
        console.warn('Unable to load the resume summary:', error);
        setSummaryResult({ key: summaryInputKey, summary: null, failed: true });
      },
    );
    return () => { cancelled = true; };
    // summaryInputKey stands for summaryInput.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summaryInputKey]);
  const resumeSummary = summaryInput.resumeText ? summaryResult.summary : null;
  const resumeSummaryStatus = !summaryInput.resumeText ? 'idle'
    : summaryResult.key !== summaryInputKey ? 'loading' : summaryResult.failed ? 'error' : 'ready';

  // The saved answer for this resume version only; an answer about an older resume never applies.
  const resumeVersion = resumeSummary?.resume_version || '';
  useEffect(() => {
    if (!currentUser.id || !resumeVersion) return undefined;
    let cancelled = false;
    void supabase
      .from('resume_summary_feedback')
      .select('rating, reasons, comment')
      .eq('user_id', currentUser.id)
      .eq('resume_version', resumeVersion)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.warn('Unable to load resume summary feedback:', error.message);
          return;
        }
        setSummaryVote({ version: resumeVersion, vote: data ? { rating: data.rating, reasons: data.reasons || [], comment: data.comment || '' } : null });
      });
    return () => { cancelled = true; };
  }, [currentUser.id, resumeVersion]);
  const resumeSummaryVote = summaryVote.version === resumeVersion ? summaryVote.vote : null;

  const saveResumeSummaryVote = async (vote: ResumeSummaryVote): Promise<boolean> => {
    if (!currentUser.id || !resumeSummary) return false;
    setResumeSummarySaving(true);
    const resumeId = state.savedResumeId && /^[0-9a-f-]{36}$/i.test(state.savedResumeId) ? state.savedResumeId : null;
    const { error } = await supabase.from('resume_summary_feedback').upsert({
      user_id: currentUser.id,
      resume_id: resumeId,
      resume_version: resumeSummary.resume_version,
      summary_version: resumeSummary.summary_version,
      rating: vote.rating,
      reasons: vote.rating === 'not_quite' ? vote.reasons : [],
      comment: vote.rating === 'not_quite' && vote.comment ? vote.comment : null,
    }, { onConflict: 'user_id,resume_version' });
    setResumeSummarySaving(false);
    if (error) {
      console.warn('Unable to save resume summary feedback:', error.message);
      showToast('Your feedback could not be saved. Please try again.', 'danger');
      return false;
    }
    setSummaryVote({ version: resumeSummary.resume_version, vote });
    return true;
  };

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
      const results = await Promise.all(eligibleMessageApps.map(async (app) => {
        try {
          return { app, rows: await loadApplicationMessages(app.id), failed: false };
        } catch (error) {
          console.warn('Unable to load messages:', error);
          return { app, rows: [], failed: true };
        }
      }));
      if (!isMounted) return;
      const requestUpdates: Record<string, string> = {};
      const replyUpdates: Record<string, Array<{ from: 'employer' | 'candidate'; text: string; time: string }>> = {};
      // A failed refresh keeps that conversation as last loaded instead of emptying it.
      const failedJobIds = results.filter((result) => result.failed).map((result) => result.app.jobId);
      results.forEach(({ app, rows, failed }) => {
        if (failed) return;
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
      setMessageRequests((current) => {
        const next = { ...requestUpdates };
        failedJobIds.forEach((jobId) => { if (current[jobId] !== undefined) next[jobId] = current[jobId]; });
        return next;
      });
      setMessageReplies((current) => {
        const next = { ...replyUpdates };
        failedJobIds.forEach((jobId) => { if (current[jobId] !== undefined) next[jobId] = current[jobId]; });
        return next;
      });
      setMessageLoadError(failedJobIds.length > 0 ? 'Some messages could not be loaded. Showing what loaded last; Kareerly keeps retrying.' : '');
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

  const showToast = (message: string, type: ToastType = '', action?: { label: string; onClick: () => void }) => {
    if (!message) return;
    setToast({ message, type, action });
    if (toastTimeoutRef.current) window.clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = window.setTimeout(() => setToast(null), action ? 6000 : 4000);
  };

  // Certificates and proof saved to the account. A record added while this loads is kept.
  useEffect(() => {
    const userId = currentUser.id;
    if (!userId) return;
    let cancelled = false;
    loadEvidence(userId).then((saved) => {
      if (cancelled) return;
      setEvidenceRecords((current) => [...current.filter((record) => !saved.some((item) => item.id === record.id)), ...saved]);
    }, (error: unknown) => {
      if (cancelled) return;
      console.warn('Unable to load certificates:', error);
      showToast(error instanceof Error ? error.message : 'Unable to load your saved certificates.', 'danger');
    });
    return () => { cancelled = true; };
  }, [currentUser.id]);

  const showInlineNotice = (message: string, type: ToastType = 'success') => {
    setInlineNotice({ message, type });
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

  const markAllNotificationsRead = async ({ quiet = false } = {}) => {
    const readAt = new Date().toISOString();
    setNotifications((current) => current.map((row) => row.read_at ? row : { ...row, read_at: readAt }));
    try {
      await markAllCandidateNotificationsRead();
      if (!quiet) showToast('All notifications marked as read.', 'success');
    } catch (notificationError) {
      console.warn('Unable to persist all notification read states:', notificationError);
      // Show the server's state again so the badge is honest.
      void loadNotifications();
      showToast('Unable to mark all notifications as read.', 'danger');
    }
  };

  // Opening the bell counts as reading: refresh first so newly arrived
  // notifications are included, then save them all as read.
  const openNotifications = async () => {
    const rows = await loadNotifications();
    if (rows?.some((row) => !row.read_at)) await markAllNotificationsRead({ quiet: true });
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
        highestEducationalAttainment: normalizeEducationLevel(extractedEducation.highest_educational_attainment) || current.highestEducationalAttainment,
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
    options?: { analysis?: ResumeAnalyzeResponse | null; resumeId?: string | null; extraKnownSkills?: SelectedSkill[]; claimedSkills?: Record<string, ClaimedSkill> },
  ) => {
    const resumeText = extractResumeText(resume);
    if (!resumeText) return null;
    // Claimed skills are the candidate's skills: they are matched on and saved
    // as confirmed skills even when the list passed in left them out. Callers
    // that just changed the claims pass the new ones (state updates later).
    const claimed = options?.claimedSkills || claimedSkills;
    skills = withClaimedSkillNames(skills, claimed);
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
    const claimedSkillRecords: SelectedSkill[] = Object.values(claimed).map((item) => ({
      skill_id: item.skillId || null,
      skill_name: item.skillName,
      source: 'confirmed_skill',
      is_standardized: Boolean(item.skillId),
    }));
    const knownSkills = [...(options?.extraKnownSkills || []), ...(state.selectedSkills || []), ...extractedSkillRecords, ...claimedSkillRecords];
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
      salary_expectation: getPreferenceLabel({ ...legacySalaryLabels, ...salaryLabels }, answers.salary),
      skill_to_develop: answers.skill,
    };

    const result = await runJobMatches({
      user_mode: 'logged_in',
      view_mode: 'full',
      resume_text_for_matching: resumeText,
      candidate_skill_ids: finalCandidateSkillIds,
      confirmed_skills: confirmedSkillRecords,
      // Only right after reviewing this analysis' skills is an unticked skill a
      // known removal; otherwise nothing is sent and no resume skill is dropped.
      removed_skill_ids: options?.analysis
        ? removedSkillIds(extractedSkillRecords.map((skill) => skill.skill_id), confirmedSkillRecords)
        : undefined,
      preferences: {
        industry: preferencePayload.industry,
        target_role: preferencePayload.target_role,
        role_level: preferencePayload.role_level,
        role: preferencePayload.target_role,
        work_setup: preferencePayload.work_setup,
        salary_expectation: preferencePayload.salary_expectation,
        skill_to_develop: preferencePayload.skill_to_develop,
        // The saved region choice; "current" also sends the profile location so
        // the backend resolves the region with the same mapping it uses for jobs.
        ...locationPreferencePayload(answers, profileForm.location),
      },
    });

    setMatchResults(result);
    if (currentUser?.id) {
      // The confirmed skills are what External Job Analysis and other features read.
      // The new set is written before the old one is removed, so a failed write
      // leaves the skills the candidate already had.
      const { data: previousSkills, error: readSkillsError } = await supabase.from('user_skills').select('id').eq('user_id', currentUser.id);
      const { data: insertedSkills, error: insertSkillsError } = readSkillsError
        ? { data: null, error: readSkillsError }
        : confirmedSkillRecords.length === 0
        ? { data: [], error: null }
        : await supabase.from('user_skills').insert(confirmedSkillRecords.map((skill) => ({
          user_id: currentUser.id,
          skill_id: skill.skill_id,
          skill_name: skill.skill_name,
          confidence: 1,
          source: 'confirmed_skill',
        }))).select('id');
      if (!insertSkillsError) {
        const keep = new Set((insertedSkills || []).map((row) => String(row.id)));
        const staleIds = (previousSkills || []).map((row) => String(row.id)).filter((id) => !keep.has(id));
        if (staleIds.length > 0) {
          const { error: deleteSkillsError } = await supabase.from('user_skills').delete().in('id', staleIds).eq('user_id', currentUser.id);
          if (deleteSkillsError) console.warn('Unable to remove replaced skills:', deleteSkillsError);
        }
      }
      if (insertSkillsError) {
        console.warn('Unable to save confirmed skills:', insertSkillsError);
        showToast("Matches refreshed, but your skills weren't saved.", 'warn');
      }
      const saved = await saveMatchHistory({
        userId: currentUser.id,
        resumeId: options?.resumeId ?? state.savedResumeId,
        preferences: answers,
        results: result,
      });
      if (!saved) showToast('Matches refreshed, but not saved to your profile.', 'warn');
    }
    return result;
  };

  const handlePreferencesSave = async (answers: SurveyAnswers) => {
    if (!isLocationPreferenceComplete(answers)) {
      showToast('Please choose a region, or pick "Anywhere in the Philippines".', 'warn');
      return;
    }
    setSurveyAnswers(answers);
    let preferencesSaved = true;
    if (currentUser?.id) {
      await updateCandidateProfile({
        userId: currentUser.id,
        preferredIndustry: getCareerAreaLabel(answers.industry),
        targetRole: answers.role,
        preferredWorkSetup: getPreferenceLabel(setupLabels, answers.setup),
        expectedSalary: getPreferenceLabel({ ...legacySalaryLabels, ...salaryLabels }, answers.salary),
        skillToDevelop: answers.skill,
        preferredLocationScope: normalizeLocationScope(answers.locationScope),
        preferredRegion: locationPreferencePayload(answers).region,
      }).catch((error) => {
        console.warn('Unable to save preferences to Supabase:', error);
        preferencesSaved = false;
        showToast('Preferences not saved. They may reset when you reload.', 'danger');
      });
    }
    const savedResume = state.resume || state.resumeAnalysis?.parsedResume;
    const resumeText = savedResume ? extractResumeText(savedResume) : '';
    if (!savedResume || !resumeText) {
      if (!preferencesSaved) return;
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
      if (preferencesSaved) {
        showInlineNotice('Preferences and skills saved. Your dashboard is refreshed.', 'success');
        showToast('Profile recommendations refreshed.', 'success');
      } else {
        showInlineNotice('Your dashboard is refreshed, but your preferences could not be saved to your profile.', 'warn');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to refresh your profile recommendations.';
      setError(message);
      showToast(message, 'danger');
    } finally {
      setLoading(false);
    }
  };

  // One job selection serves the desktop split views and the job detail dialog.
  const detailRequest = useRef(0);
  const selectJob = useCallback(async (job: DashboardJob, openDialog: boolean) => {
    const request = ++detailRequest.current;
    setSelectedJob(job);
    if (openDialog) setJobDetailOpen(true);
    try {
      const detail = await fetchJobDetails(job.id, job.jobSource);
      if (request === detailRequest.current) setSelectedJob(mergeSupabaseJobDetails(job, detail.job));
    } catch (error) {
      console.warn('Unable to refresh job details from Supabase:', error);
    }
  }, []);
  const openJobDetails = useCallback((job: DashboardJob) => {
    void selectJob(job, true);
  }, [selectJob]);

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
      showToast("Couldn't update your saved jobs. Please try again.", 'danger');
      return;
    }
    showToast(alreadySaved ? 'Job removed from saved list.' : 'Job saved to your account.', 'success');
  };

  const applyToInternalJob = async (job: DashboardJob): Promise<boolean> => {
    if (job.sourceType === 'external') {
      showToast("Apply for this job on the employer's site.", 'warn');
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
    showToast('Application sent.', 'success', { label: 'View', onClick: () => setActivePage('applications') });
    return true;
  };

  const requestApply = (job: DashboardJob) => {
    if (job.sourceType === 'external') {
      window.open(externalJobUrl(job), '_blank', 'noopener,noreferrer');
      return;
    }
    if (getApplicationStatus(job.id, job.jobSource)) {
      showToast('You have already applied for this job.', 'warn');
      return;
    }
    setApplyTarget(job);
  };

  const confirmApply = async () => {
    if (!applyTarget) return;
    setIsApplying(true);
    try {
      if (await applyToInternalJob(applyTarget)) setApplyTarget(null);
    } finally {
      setIsApplying(false);
    }
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

  const selectedModeration = selectedMessageApp ? messageModeration[selectedMessageApp.id] : undefined;
  const acceptedMessageReplyEnabled = selectedMessageState === 'Accepted' && !selectedModeration?.blocked;

  useEffect(() => {
    if (!selectedMessageApp?.id) return;
    let isMounted = true;
    const applicationId = selectedMessageApp.id;
    loadMessageModeration(applicationId)
      .then((moderation) => {
        if (isMounted) setMessageModeration((current) => ({ ...current, [applicationId]: moderation }));
      })
      .catch((error) => console.warn('Unable to load message moderation state:', error));
    return () => {
      isMounted = false;
    };
  }, [selectedMessageApp?.id]);

  const applyMessageModeration = async (
    app: DashboardApplication,
    input: { action: 'report' | 'block' | 'unblock'; reason?: MessageReportReason; details?: string },
  ): Promise<boolean> => {
    try {
      const moderation = await submitMessageModeration({ applicationId: app.id, ...input });
      setMessageModeration((current) => ({ ...current, [app.id]: moderation }));
      return true;
    } catch (error) {
      console.warn('Unable to update message moderation:', error);
      showToast(error instanceof Error ? error.message : 'Unable to complete this action. Please try again.', 'danger');
      return false;
    }
  };

  const submitMessageReport = async (reason: MessageReportReason, details: string, alsoBlock: boolean) => {
    if (!reportTarget) return;
    const app = reportTarget;
    if (!(await applyMessageModeration(app, { action: 'report', reason, details }))) return;
    if (alsoBlock && !(await applyMessageModeration(app, { action: 'block' }))) return;
    setReportTarget(null);
    showToast(alsoBlock ? `${app.company} was reported and blocked.` : `Thanks — ${app.company} was reported for review.`, 'success');
  };

  const confirmBlockEmployer = async () => {
    if (!blockTarget) return;
    const app = blockTarget;
    if (!(await applyMessageModeration(app, { action: 'block' }))) return;
    setBlockTarget(null);
    setMessageDraft('');
    showToast(`${app.company} is blocked. They can no longer message you here.`, 'warn');
  };

  const unblockEmployer = async (app: DashboardApplication) => {
    if (await applyMessageModeration(app, { action: 'unblock' })) showToast(`${app.company} is unblocked.`, 'success');
  };

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
    setResumeModalOpen(true);
    setResumeStep('upload');
    setResumeDragOver(false);
    setResumeUploadFile(null);
    setResumeAnalyzeData(null);
    setResumeActionError('');
    savedResumeUploadId.current = null;
    reusedResumeFile.current = null;
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
    let latestResume: SavedResumeRecord | null;
    try {
      latestResume = await loadLatestResume({ userId: currentUser.id });
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to open the saved resume. Please try again.', 'danger');
      return;
    }
    const located = await locateSavedResumeFile(latestResume);
    if (!located) {
      showToast('Resume file not found. Please upload it again.', 'warn');
      return;
    }
    const { data, error } = await supabase.storage
      .from(located.bucket)
      .createSignedUrl(located.path, 300);
    if (error || !data?.signedUrl) {
      console.warn('Unable to create resume preview link:', error);
      showToast('Unable to open the saved resume. Please try again.', 'danger');
      return;
    }
    const previewName = latestResume?.original_filename || savedResumeFileName || located.path.split('/').pop() || 'Saved resume';
    const previewMimeType = located.mimeType || (previewName.toLowerCase().endsWith('.pdf') ? 'application/pdf' : '');
    setResumePreview({ url: data.signedUrl, name: previewName, mimeType: previewMimeType, local: false });
  };

  const reanalyzeSavedResume = async () => {
    if (!currentUser.id || state.isLoading) return;
    let located: ExistingResumeFile | null;
    try {
      located = savedResumeFile || await locateSavedResumeFile(await loadLatestResume({ userId: currentUser.id }));
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to load your saved resume. Please try again.', 'danger');
      return;
    }
    if (!located) {
      setSavedResumeFile(null);
      showToast('Resume file not found. Please upload it again.', 'warn');
      openResumeModal();
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // The user's own file, read through their session (owner-only storage policy);
      // it stays in memory and is not stored again when the new analysis is saved.
      const { data: blob, error: downloadError } = await supabase.storage.from(located.bucket).download(located.path);
      if (downloadError || !blob) throw new Error(downloadError?.message || 'The saved resume could not be downloaded.');
      const file = new File([blob], located.name, { type: located.mimeType || blob.type || '' });
      openResumeModal();
      reusedResumeFile.current = located;
      setResumeUploadFile(file);
      await analyzeResumeForModal(file);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to re-scan the saved resume.';
      showToast(`${message} Please upload your resume again.`, 'danger');
      setLoading(false);
    }
  };

  const closeResumePreview = () => {
    if (resumePreview?.local) URL.revokeObjectURL(resumePreview.url);
    setResumePreview(null);
  };

  const handleResumeFilePick = (file: File | null) => {
    setResumeAnalyzeData(null);
    setResumeActionError('');
    savedResumeUploadId.current = null;
    reusedResumeFile.current = null;
    if (!file) {
      setResumeUploadFile(null);
      return;
    }
    const validation = validateResumeFile(file);
    if (!validation.valid) {
      showToast(validation.error || 'Please upload a PDF, DOCX or DOC file.', 'warn');
      return;
    }
    setResumeUploadFile(file);
  };

  const handleResumeUploadAndReview = async () => {
    if (!resumeUploadFile) {
      showToast('Please upload a resume file first.', 'warn');
      return;
    }
    await analyzeResumeForModal(resumeUploadFile);
  };

  const analyzeResumeForModal = async (resumeFileToAnalyze: File) => {
    savedResumeUploadId.current = null;
    setResumeActionError('');
    setLoading(true);
    setError(null);
    try {
      const prefs = state.surveyAnswers || defaultSurveyAnswers;
      const data = withExtractedEducation(await analyzeResume(resumeFileToAnalyze, prefs));
      setResumeAnalyzeData(data);
      const extracted = extractSkillsFromResume(data.parsedResume);
      const baseline = extracted.length > 0 ? extracted : skillNames;
      const unique = Array.from(new Set(baseline.map((item) => item.trim()).filter(Boolean)));
      setReviewSkills(unique);
      setResumeStep('decision');
      showToast(reusedResumeFile.current
        ? 'Resume re-scanned.'
        : 'Resume uploaded.', 'success');
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


  // The education a resume carries is applied to the profile only once that
  // resume is saved, so analysing a file the candidate then abandons (or that
  // fails to save) leaves their existing profile as it was.
  const applyExtractedEducation = async (data: ResumeAnalyzeResponse) => {
    const extractedEducation = data.candidate_profile?.education?.[0];
    if (!extractedEducation) return;
    setProfileForm((current) => ({
      ...current,
      highestEducationalAttainment: normalizeEducationLevel(extractedEducation.highest_educational_attainment) || current.highestEducationalAttainment,
      degreeProgram: extractedEducation.degree_program || current.degreeProgram,
      schoolUniversity: extractedEducation.school_university || current.schoolUniversity,
      yearGraduated: extractedEducation.year_graduated || current.yearGraduated,
    }));
    // A failure here must not discard the resume that was just saved.
    await saveCandidateAccountSettings({
      full_name: accountIdentity.name,
      email: accountIdentity.email,
      birthday: profileForm.birthday,
      location: profileForm.location,
      contact_number: profileForm.contactNumber,
      address: profileForm.address,
      highest_educational_attainment: normalizeEducationLevel(extractedEducation.highest_educational_attainment) || profileForm.highestEducationalAttainment,
      degree_program: extractedEducation.degree_program || profileForm.degreeProgram,
      school_university: extractedEducation.school_university || profileForm.schoolUniversity,
      year_graduated: extractedEducation.year_graduated || profileForm.yearGraduated,
    }).catch((saveError) => {
      console.warn('Unable to save extracted education to account settings', saveError);
    });
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
        // A re-scan points the new analysis at the stored original instead of uploading a second copy.
        existingFile: reusedResumeFile.current,
        analysis: resumeAnalyzeData,
      });
      savedResumeUploadId.current = resumeId;
      setSavedResumeFileName(resumeUploadFile.name);
      setSavedResumeFile(null);
      await applyExtractedEducation(resumeAnalyzeData);
    }
    // A resume analyzed just now was read by the live reader; uploading it again
    // would not change anything, so it is never flagged as an older analysis.
    setSavedResumeFreshness(null);
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
      showInlineNotice('Resume updated. Your dashboard is refreshed.', 'success');
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
      showInlineNotice('Resume updated. Your dashboard is refreshed.', 'success');
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
    credentialUrl?: string;
    credentialCheck?: CredentialLinkCheck;
  }) => {
    const existingRecord = draft.id ? evidenceRecords.find((record) => record.id === draft.id) : undefined;
    setLoading(true);
    setError(null);
    try {
      // A certificate link is checked first (Credly badges are looked up), so a made-up link never becomes proof.
      if (draft.credentialUrl?.trim()) {
        draft = { ...draft, credentialCheck: await checkCredentialLink(draft.credentialUrl.trim(), accountIdentity.name) };
      }
      // The related skill is optional: when left empty it is read from the title, notes and badge details. It can be edited on the record afterwards.
      if (!draft.relatedSkill.trim()) {
        const vocabulary = [...skillNames, ...gaps.map((gap) => gap.skill), ...courses.flatMap(getCourseSkillLabels)];
        const details = [draft.title, draft.notes, draft.credentialCheck?.badge_name, draft.credentialCheck?.issuer].filter(Boolean).join(' ');
        draft = { ...draft, relatedSkill: inferRelatedSkills(details, vocabulary) };
      }
      draft = { ...draft, category: draft.category.trim() || deriveEvidenceCategory(draft.relatedSkill, gaps, evidenceCourseTarget) };
      const nextRecord = await prepareEvidenceUpload(draft, existingRecord, validateCertificateFile);
      // Saved to the account first, so a failure keeps the form open and nothing looks saved that is not.
      if (currentUser.id) await saveEvidence(currentUser.id, nextRecord);

      setEvidenceRecords((current) => {
        if (draft.id) {
          return current.map((record) => (record.id === draft.id ? nextRecord : record));
        }
        return [nextRecord, ...current];
      });

      setEvidenceModalOpen(false);
      setEditingEvidence(null);
      if (evidenceCourseTarget) {
        const course = evidenceCourseTarget;
        setCourseCompletions((current) => ({ ...current, [course.id]: { status: 'evidenced', markedAt: current[course.id]?.markedAt || new Date().toISOString(), evidenceId: nextRecord.id } }));
        updateCourseSkillProgress(course, 'evidenced', { fileName: nextRecord.fileName || `${nextRecord.credentialProvider || 'Certificate'} link`, uploadedAt: nextRecord.uploadedAt });
        setEvidenceCourseTarget(null);
        showToast('Proof uploaded. Pending verification.', 'success');
      } else if (evidenceSkillTarget) {
        const { key } = evidenceSkillTarget;
        setSkillProgressRecords((current) => (current[key] ? {
          ...current,
          [key]: { ...current[key], status: 'evidenced', progressPercent: SKILL_PROGRESS_PERCENT.evidenced, evidenceFilename: nextRecord.fileName || `${nextRecord.credentialProvider || 'Certificate'} link`, evidenceUploadedAt: nextRecord.uploadedAt },
        } : current));
        setEvidenceSkillTarget(null);
        showToast('Proof uploaded. Pending verification.', 'success');
      } else {
        showToast('Proof saved. Pending verification.', 'success');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to validate certificate upload.';
      setError(message);
      showToast(message, 'danger');
    } finally {
      setLoading(false);
    }
  };

  const openEvidenceUploadModal = (mode?: 'file' | 'link') => {
    setEvidenceMode(mode);
    setEvidenceSkillTarget(null);
    setEvidenceCourseTarget(null);
    setEditingEvidence(null);
    setEvidenceModalOpen(true);
  };

  // Moves the skills a course covers forward (or back) in Skill Development Progress.
  const updateCourseSkillProgress = (
    course: DashboardCourse,
    status: SkillProgressStatus,
    evidence?: { fileName?: string; uploadedAt?: string },
  ) => {
    const courseIds = new Set(course.mappedSkillIds.map((id) => id.toUpperCase()));
    const courseSkills = new Set(getCourseSkillLabels(course).map(normalizeSkill));
    setSkillProgressRecords((current) => {
      const next = { ...current };
      Object.entries(current).forEach(([key, record]) => {
        const covers = (record.skillId && courseIds.has(record.skillId.toUpperCase())) || courseSkills.has(normalizeSkill(record.skillName));
        if (!covers || record.status === 'covered') return;
        if (status === 'missing' && record.selectedResourceId !== course.id) return;
        if (status === 'completed' && record.status === 'evidenced') return;
        next[key] = {
          ...record,
          status,
          progressPercent: SKILL_PROGRESS_PERCENT[status],
          selectedResourceId: course.id,
          evidenceFilename: status === 'missing' ? undefined : evidence?.fileName || record.evidenceFilename,
          evidenceUploadedAt: status === 'missing' ? undefined : evidence?.uploadedAt || record.evidenceUploadedAt,
        };
      });
      return next;
    });
  };

  const openCourseEvidenceUpload = (course: DashboardCourse) => {
    setEvidenceSkillTarget(null);
    setEvidenceCourseTarget(course);
    setEditingEvidence(null);
    setEvidenceModalOpen(true);
  };

  const markCourseTaken = (course: DashboardCourse) => {
    setCourseCompletions((current) => ({ ...current, [course.id]: { status: 'completed', markedAt: new Date().toISOString() } }));
    updateCourseSkillProgress(course, 'completed');
    openCourseEvidenceUpload(course);
  };

  const unmarkCourseTaken = (course: DashboardCourse) => {
    setCourseCompletions((current) => {
      const next = { ...current };
      delete next[course.id];
      return next;
    });
    updateCourseSkillProgress(course, 'missing');
    showToast(`${course.title} marked as not taken.`, 'warn');
  };

  const openSkillEvidenceUpload = (key: string, gap: DashboardGap, course?: DashboardCourse) => {
    if (course) {
      openCourseEvidenceUpload(course);
      return;
    }
    setEvidenceCourseTarget(null);
    setEvidenceSkillTarget({ key, gap });
    setEditingEvidence(null);
    setEvidenceModalOpen(true);
  };

  // Re-runs matching with an updated skill list; without a resume the list is just saved.
  const refreshMatchesWithSkills = async (nextSkills: string[], nextClaimed: Record<string, ClaimedSkill>, extraKnownSkills?: SelectedSkill[]) => {
    setSkillNames(nextSkills);
    const savedResume = state.resume || state.resumeAnalysis?.parsedResume;
    if (!savedResume || !extractResumeText(savedResume)) return false;
    setLoading(true);
    setError(null);
    try {
      await runMatchingWithSkills(savedResume, nextSkills, surveyAnswers, { extraKnownSkills, claimedSkills: nextClaimed });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to refresh your matches.';
      setError(message);
      showToast(message, 'danger');
      return false;
    } finally {
      setLoading(false);
    }
  };

  const unclaimSkill = (key: string) => {
    const latestClaimed = claimedSkillsRef.current;
    const item = latestClaimed[key];
    if (!item) return;
    const nextClaimed = { ...latestClaimed };
    delete nextClaimed[key];
    claimedSkillsRef.current = nextClaimed;
    setClaimedSkills(nextClaimed);
    const nextSkills = skillNames.filter((name) => normalizeSkill(name) !== normalizeSkill(item.skillName));
    void refreshMatchesWithSkills(nextSkills, nextClaimed).then((refreshed) => {
      showToast(`${cleanSkillDisplayName(item.skillName)} is back in your skill gaps${refreshed ? ' and your matches were refreshed' : ''}.`, 'success');
    });
  };

  // The candidate says they already have a gap skill: it joins their skill list,
  // stops being recommended for learning, and matches are refreshed.
  const claimSkill = (gap: DashboardGap) => {
    const key = skillRecordKey(gap);
    const name = cleanSkillDisplayName(gap.skill);
    // Added once: a second click (or a synonym already claimed) changes nothing.
    if (claimedSkills[key] || state.isLoading) return;
    const alreadyListed = skillNames.some((skill) => normalizeSkill(skill) === normalizeSkill(gap.skill));
    if (!alreadyListed && skillNames.length >= CONFIRMED_SKILL_LIMIT) {
      showToast('Skill limit reached. Remove one in Preferences first.', 'warn');
      return;
    }
    const item: ClaimedSkill = { skillId: gap.skillId || undefined, skillName: gap.skill, claimedAt: new Date().toISOString() };
    const nextClaimed = { ...claimedSkills, [key]: item };
    claimedSkillsRef.current = nextClaimed;
    setClaimedSkills(nextClaimed);
    const nextSkills = alreadyListed ? skillNames : [...skillNames, gap.skill];
    const record: SelectedSkill = { skill_id: gap.skillId || null, skill_name: gap.skill, source: 'confirmed_skill', is_standardized: Boolean(gap.skillId) };
    void refreshMatchesWithSkills(nextSkills, nextClaimed, [record]).then(() => {
      showToast(
        `${name} added. Keep an example of your work ready.`,
        'success',
        { label: 'Undo', onClick: () => unclaimSkill(key) },
      );
    });
  };

  // Removing a claimed skill in Preferences also brings its gap back.
  const updateSkillNames = (next: string[]) => {
    setSkillNames(next);
    const kept = new Set(next.map(normalizeSkill));
    setClaimedSkills((current) => {
      const entries = Object.entries(current).filter(([, item]) => kept.has(normalizeSkill(item.skillName)));
      return entries.length === Object.keys(current).length ? current : Object.fromEntries(entries);
    });
  };

  const evidencePrefill: EvidencePrefill | undefined = evidenceSkillTarget && !evidenceCourseTarget ? {
    title: `${cleanSkillDisplayName(evidenceSkillTarget.gap.skill)} work sample`,
    evidenceType: 'Portfolio',
    relatedSkill: cleanSkillDisplayName(evidenceSkillTarget.gap.skill),
    category: deriveEvidenceCategory(evidenceSkillTarget.gap.skill, gaps, null),
  } : evidenceCourseTarget ? {
    title: evidenceCourseTarget.title,
    evidenceType: ['industry_certification', 'professional_certificate', 'certificate_course'].includes(evidenceCourseTarget.credentialType) ? 'Certificate' : 'Course Completion',
    relatedSkill: getCourseSkillLabels(evidenceCourseTarget).join(', '),
    category: deriveEvidenceCategory(getCourseSkillLabels(evidenceCourseTarget).join(', '), gaps, evidenceCourseTarget),
  } : undefined;

  const handleViewEvidence = (record: EvidenceUploadRecord) => {
    const target = record.fileUrl || record.credentialUrl;
    if (!target) {
      showToast(record.fileName
        ? 'The PDF itself is not kept after you leave this page. Add a certificate link or upload it again to open it.'
        : 'No viewable PDF or link is attached to this evidence record yet.', 'warn');
      return;
    }
    window.open(target, '_blank', 'noopener,noreferrer');
  };

  const handleEditEvidence = (record: EvidenceUploadRecord) => {
    setEditingEvidence(record);
    setEvidenceModalOpen(true);
  };

  const handleDeleteEvidence = (record: EvidenceUploadRecord) => {
    setDeleteEvidenceTarget(record);
  };

  const confirmDeleteEvidence = async () => {
    if (!deleteEvidenceTarget) return;
    const target = deleteEvidenceTarget;
    try {
      if (currentUser.id) await deleteEvidence(currentUser.id, target.id);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to delete this certificate.', 'danger');
      return;
    }
    setEvidenceRecords((current) => current.filter((record) => record.id !== target.id));
    setDeleteEvidenceTarget(null);
    showToast('Evidence record deleted.', 'success');
  };

  const matchesExist = fitNowJobs.length + aspirationJobs.length > 0;
  const hasResume = Boolean(state.resumeFile || state.resume || state.resumeAnalysis || savedResumeFileName);
  const confirmedSkillsCount = skillNames.length || state.resumeAnalysis?.normalized_for_matching?.skill_ids?.length || 0;
  const hasPreferencesCompleted = Boolean(surveyAnswers.industry && surveyAnswers.role && surveyAnswers.setup && surveyAnswers.salary);
  const hasProfileDetails = Boolean(profileForm.location || profileForm.highestEducationalAttainment || profileForm.degreeProgram || profileForm.schoolUniversity || profileForm.yearGraduated || educationIndicators.length || experienceIndicators.length);
  const applicationStatusFor = (job: DashboardJob) => getApplicationStatus(job.id, job.jobSource);
  const openLearning = (focus: { skill?: string; jobId?: string } = {}) => {
    // From a job's detail, Learning opens on that job's first missing skill.
    const job = focus.jobId ? jobs.find((item) => item.id === focus.jobId) : undefined;
    setLearningFocus({ skill: focus.skill || job?.missingSkills[0] || job?.missingPreferredSkills?.[0] });
    setJobDetailOpen(false);
    setActivePage('upskilling');
  };
  const pendingMessageApp = eligibleMessageApps.find((app) => app.messageRequestState === 'pending');
  const nextFitNow = fitNowJobs.find((job) => job.sourceType === 'internal' && !getApplicationStatus(job.id, job.jobSource));
  const firstGap = openGapSkills[0];

  // The Home page answers "what should I do now?": most useful action first.
  const nextSteps: NextStep[] = [
    ...(!hasResume ? [{ id: 'resume', title: 'Upload your resume', detail: 'Kareerly reads your skills and finds jobs that fit.', actionLabel: 'Upload resume', onAction: () => openResumeModal() }] : []),
    ...(pendingMessageApp ? [{ id: 'message', title: `Reply to ${pendingMessageApp.company}`, detail: `Message request about ${pendingMessageApp.jobTitle}`, actionLabel: 'Open messages', onAction: () => setActivePage('messages') }] : []),
    ...(nextFitNow ? [{
      id: 'apply',
      title: `Apply to ${nextFitNow.title}`,
      detail: [knownValue(nextFitNow.company), nextFitNow.hasMatchScore ? `${nextFitNow.matchScore}% Fit Now` : ''].filter(Boolean).join(' · '),
      actionLabel: 'View job',
      onAction: () => void selectJob(nextFitNow, true),
    }] : []),
    ...(firstGap ? [{ id: 'learn', title: `Learn ${firstGap.skill_name}`, detail: `${firstGap.tier_label} · ${requirementSummary(firstGap)}`, actionLabel: 'See resources', onAction: () => openLearning({ skill: firstGap.skill_name }) }] : []),
    ...(hasResume && !matchesExist && !state.isLoading ? [{ id: 'refresh', title: 'Refresh your matches', detail: 'Check your preferences, then save to run matching again.', actionLabel: 'Open preferences', onAction: () => setActivePage('preferences') }] : []),
  ];
  const profileTasks: ProfileTask[] = [
    { label: 'Upload your resume', done: hasResume, onAction: () => openResumeModal() },
    { label: 'Confirm your skills', done: confirmedSkillsCount > 0, onAction: () => setActivePage('preferences') },
    { label: 'Set your preferences', done: hasPreferencesCompleted, onAction: () => setActivePage('preferences') },
    { label: 'Add education and contact details', done: hasProfileDetails, onAction: () => setActivePage('account') },
  ];

  const activeApplicationFor = (job: DashboardJob) => applications.find((app) => app.jobId === job.id && app.jobSource === job.jobSource && app.status !== 'Withdrawn') || null;
  const feedbackKeyFor = (job: DashboardJob) => matchFeedbackKey(job.id, job.jobSource);
  const hasLearningFor = (job: DashboardJob) => job.missingSkills.length > 0 || (job.missingPreferredSkills || []).length > 0;
  const withdrawFromDetail = (application: DashboardApplication) => {
    setJobDetailOpen(false);
    openWithdraw(application);
  };
  // On the Applications page the application is already listed, so the job detail offers no link back to it.
  const viewApplicationFromDetail = activePage === 'applications' ? undefined : (application: DashboardApplication) => {
    setJobDetailOpen(false);
    setFocusedApplicationId(application.id);
    setActivePage('applications');
  };
  const pendingMessageCount = eligibleMessageApps.filter((app) => app.messageRequestState === 'pending').length;
  const sentence = (text: string) => text.trim().replace(/([^.!?])$/, '$1.');
  const progressSyncError = progressLoad.status === 'error'
    ? `${sentence(progressLoad.error)} Changes to your skills, skill progress and courses will not be saved until it loads.`
    : progressLoad.status === 'ready' && progressSaveError
      ? `${sentence(progressSaveError)} Recent changes show on this page but are not saved to your account yet.`
      : '';
  const hasBanners = Boolean((savedResumeFreshness?.stale && !resumeModalOpen) || inlineNotice || state.error || restoreError || savedJobsError || progressSyncError);

  return (
    <CandidateShell
      activePage={activePage}
      onNavigate={setActivePage}
      onHome={onHome}
      onLogout={onLogout}
      displayName={displayName}
      displayEmail={displayEmail}
      initials={initials}
      uiLanguage={uiLanguage}
      onLanguage={setUiLanguage}
      notifications={notifications}
      notificationStatus={notificationLoadStatus}
      unreadCount={unreadNotificationCount}
      onOpenNotifications={() => void openNotifications()}
      onMarkAllRead={() => void markAllNotificationsRead()}
      onMarkRead={(row) => void markNotificationRead(row)}
      applicationsBadge={pendingMessageCount}
    >
      {hasBanners && (
        <div className="k-page !pb-0">
          {restoreError && (
            <Banner
              tone="error"
              actions={<button className="k-btn k-btn-secondary k-btn-sm" type="button" onClick={() => setRestoreAttempt((count) => count + 1)}>Try again</button>}
            >
              {restoreError} Your matches and skill gaps can't be shown until it loads.
            </Banner>
          )}
          {savedJobsError && (
            <Banner
              tone="error"
              actions={<button className="k-btn k-btn-secondary k-btn-sm" type="button" onClick={() => setSavedJobsAttempt((count) => count + 1)}>Try again</button>}
            >
              {savedJobsError}
            </Banner>
          )}
          {savedResumeFreshness?.stale && !resumeModalOpen && (
            <Banner
              tone="warn"
              actions={(
                <button className="k-btn k-btn-secondary k-btn-sm" type="button" disabled={state.isLoading} onClick={() => (savedResumeFile ? void reanalyzeSavedResume() : openResumeModal())}>
                  {savedResumeFile ? 'Re-scan resume' : 'Upload again'}
                </button>
              )}
            >
              {staleResumeMessage(savedResumeFreshness, Boolean(savedResumeFile))}
            </Banner>
          )}
          {inlineNotice && (
            <Banner tone={inlineNotice.type === 'danger' ? 'error' : inlineNotice.type === 'warn' ? 'warn' : 'info'} onDismiss={() => setInlineNotice(null)}>
              {inlineNotice.message}
            </Banner>
          )}
          {state.error && <Banner tone="error" onDismiss={() => setError(null)}>{state.error}</Banner>}
          {progressSyncError && (
            <Banner
              tone="error"
              actions={currentUser.id ? (
                <button className="k-btn k-btn-secondary k-btn-sm" type="button" onClick={retryProgressSync}>Try again</button>
              ) : undefined}
            >
              {progressSyncError}
            </Banner>
          )}
        </div>
      )}

      {activePage === 'dashboard' && (
        <HomePage
          isLoading={state.isLoading}
          nextSteps={nextSteps}
          fitNowCount={fitNowJobs.length}
          aspirationCount={aspirationJobs.length}
          topMatches={[...fitNowJobs, ...aspirationJobs].slice(0, 3)}
          getApplicationStatus={applicationStatusFor}
          onOpenJob={(job) => void selectJob(job, true)}
          onOpenMatches={() => setActivePage('jobmatches')}
          topGaps={topMissingSkills}
          gapCount={openGapSkills.length}
          resumeSummary={(
            <ResumeSummaryCard
              key={resumeSummary?.resume_version || 'none'}
              summary={resumeSummary}
              status={resumeSummaryStatus}
              vote={resumeSummaryVote}
              saving={resumeSummarySaving}
              onVote={saveResumeSummaryVote}
              onFixSkills={() => setActivePage('preferences')}
            />
          )}
          onOpenSkills={() => setActivePage('skillgaps')}
          recentApplications={recentApplications}
          applicationLoadStatus={applicationLoadStatus}
          activeApplicationCount={applications.filter((app) => ['Pending', 'Shortlisted', 'Interviewing'].includes(app.status)).length}
          onOpenApplications={() => setActivePage('applications')}
          profileTasks={profileTasks}
          assessmentsDue={assessmentsDue}
        />
      )}

      {activePage === 'jobmatches' && (
        <JobMatchesPage
          fitNowJobs={fitNowJobs}
          aspirationJobs={aspirationJobs}
          savedJobRows={savedJobRows}
          view={matchView}
          onView={setMatchView}
          search={jobSearch}
          onSearch={setJobSearch}
          savedJobs={savedJobs}
          getApplicationStatus={applicationStatusFor}
          onSave={(jobId) => void toggleSaved(jobId)}
          onApply={requestApply}
          onOpenJob={openJobDetails}
          onAnalyze={() => setActivePage('external-job')}
          isLoading={state.isLoading}
          hasResume={hasResume}
          onUploadResume={openResumeModal}
          locationFilter={state.matchResults?.location_filter}
          reportHasMatches={Boolean(
            (state.matchResults?.all_fit_now_matches || state.matchResults?.fit_now_matches || []).length
            || (state.matchResults?.all_aspiration_matches || state.matchResults?.aspiration_matches || []).length,
          )}
          isBusy={state.isLoading}
          onChangeRegion={() => setActivePage('preferences')}
          onRemoveRegionFilter={() => void handlePreferencesSave({ ...surveyAnswers, locationScope: 'anywhere', region: '' })}
        />
      )}

      {activePage === 'external-job' && (
        <ExternalJobAnalysisPage onOpenLearning={() => openLearning()} />
      )}

      {activePage === 'skillgaps' && (
        <SkillGapsPage
          report={gapReport}
          jobReport={jobGapReport}
          status={gapStatus}
          error={gapError}
          onRetry={() => setGapReload((count) => count + 1)}
          scope={gapScope}
          onScope={setGapScope}
          groupBy={gapGroupBy}
          onGroupBy={setGapGroupBy}
          busy={state.isLoading}
          skillProgressRecords={skillProgressRecords}
          claimedSkills={claimedSkills}
          courseCompletions={courseCompletions}
          onUpdateSkillProgress={updateSkillProgressStatus}
          onMarkCourseTaken={markCourseTaken}
          onUnmarkCourseTaken={unmarkCourseTaken}
          onAddSkillProof={openSkillEvidenceUpload}
          onClaimSkill={claimSkill}
          onUnclaimSkill={unclaimSkill}
          onOpenLearning={(skill) => openLearning({ skill })}
          onTab={(tab) => (tab === 'learning' ? openLearning() : setActivePage('skillgaps'))}
          isDesktop={isDesktop}
          hasMatches={matchesExist}
          onOpenMatches={() => setActivePage('jobmatches')}
        />
      )}

      {activePage === 'upskilling' && (
        <UpskillingPage
          key={learningFocus.skill || ''}
          report={gapReport}
          status={gapStatus}
          error={gapError}
          onRetry={() => setGapReload((count) => count + 1)}
          hasMatches={matchesExist}
          claimedSkills={claimedSkills}
          skillProgressRecords={skillProgressRecords}
          focusSkill={learningFocus.skill}
          courseCompletions={courseCompletions}
          onMarkCourseTaken={markCourseTaken}
          onUnmarkCourseTaken={unmarkCourseTaken}
          onUploadCourseEvidence={openCourseEvidenceUpload}
          onTab={(tab) => setActivePage(tab === 'gaps' ? 'skillgaps' : 'upskilling')}
          onOpenJobMatches={() => setActivePage('jobmatches')}
        />
      )}

      {activePage === 'applications' && (
        <ApplicationsPage
          loadStatus={applicationLoadStatus}
          applications={applications}
          focusedApplicationId={focusedApplicationId}
          onFocusHandled={clearFocusedApplication}
          onViewJob={(application) => {
            const knownJob = jobs.find((item) => item.id === application.jobId && item.jobSource === application.jobSource)
              || kareersList.find((item) => item.id === application.jobId && item.jobSource === application.jobSource);
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
              matchCategory: (application.matchScore ?? 0) >= FIT_NOW_MATCH_PERCENT ? 'fit-now' : 'aspiration',
              sourceType: 'internal',
              requiredSkills: [],
              preferredSkills: [],
              responsibilities: [],
              matchedSkills: [],
              missingSkills: [],
              explanation: '',
            };
            void selectJob(applicationJob, true);
          }}
          onWithdraw={openWithdraw}
          onOpenMessages={() => setActivePage('messages')}
          onOpenMatches={() => setActivePage('jobmatches')}
          onTab={(tab) => setActivePage(tab === 'messages' ? 'messages' : 'applications')}
          messageCount={pendingMessageCount}
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
          moderation={messageModeration}
          onReport={setReportTarget}
          onBlock={setBlockTarget}
          onUnblock={(app) => void unblockEmployer(app)}
          onTab={(tab) => setActivePage(tab === 'messages' ? 'messages' : 'applications')}
          messageCount={pendingMessageCount}
          isDesktop={isDesktop}
          loadError={messageLoadError}
        />
      )}

      {activePage === 'kareers' && (
        <KareersPage
          kareers={kareersList}
          isLoading={isLoadingKareers}
          error={kareersError}
          onRetry={() => void loadKareers()}
          savedJobs={savedJobs}
          getApplicationStatus={applicationStatusFor}
          onSave={(jobId) => void toggleSaved(jobId)}
          onApply={requestApply}
          onOpenJob={openJobDetails}
          onAnalyzeJob={() => setActivePage('external-job')}
        />
      )}

      {activePage === 'preferences' && (
        <PreferencesPage
          key={JSON.stringify(surveyAnswers)}
          surveyAnswers={surveyAnswers}
          profileLocation={accountSettingsLoaded ? profileForm.location : undefined}
          extraPreferences={extraPreferences}
          skillNames={skillNames}
          isLoading={state.isLoading}
          onUpdateExtra={setExtraPreferences}
          onUpdateSkills={updateSkillNames}
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
          onEditEvidence={handleEditEvidence}
          onDeleteEvidence={handleDeleteEvidence}
          onProfileChange={setProfileForm}
          onIdentityChange={setAccountIdentity}
          onPasswordChange={setAccountPassword}
          onUpdatePassword={updateCandidatePassword}
          onSave={saveCandidateProfile}
        />
      )}

      {jobDetailOpen && selectedJob && (
        <JobDetailModal
          job={selectedJob}
          application={activeApplicationFor(selectedJob)}
          courses={courses}
          isSaved={savedJobs.has(selectedJob.id)}
          onApply={() => requestApply(selectedJob)}
          onWithdraw={withdrawFromDetail}
          onSave={() => void toggleSaved(selectedJob.id)}
          onOpenLearning={hasLearningFor(selectedJob) ? () => openLearning({ jobId: selectedJob.id }) : undefined}
          onViewApplication={viewApplicationFromDetail}
          feedback={{ vote: matchFeedback[feedbackKeyFor(selectedJob)] ?? null, status: matchFeedbackStatus[feedbackKeyFor(selectedJob)] ?? { state: 'idle' }, onVote: (vote) => submitMatchFeedback(selectedJob, vote) }}
          onClose={() => setJobDetailOpen(false)}
        />
      )}

      {applyTarget && (
        <ConfirmDialog
          title={`Apply to ${applyTarget.title}?`}
          message={knownValue(applyTarget.company) ? `${applyTarget.company} will see your profile and resume.` : 'The employer will see your profile and resume.'}
          confirmLabel={isApplying ? 'Sending…' : 'Apply'}
          busy={isApplying}
          onCancel={() => setApplyTarget(null)}
          onConfirm={confirmApply}
        />
      )}

      {resumeModalOpen && (
        <ResumeUpdateModal
          step={resumeStep}
          postRefreshTarget={resumePostRefreshTarget}
          dragOver={resumeDragOver}
          file={resumeUploadFile}
          readingWarnings={extractionWarnings(resumeAnalyzeData)}
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
          prefill={evidencePrefill}
          mode={editingEvidence || evidencePrefill ? undefined : evidenceMode}
          onClose={() => {
            setEvidenceModalOpen(false);
            setEditingEvidence(null);
            if (evidenceCourseTarget || evidenceSkillTarget) {
              showToast('Marked as done. You can add proof later.', 'success');
            }
            setEvidenceCourseTarget(null);
            setEvidenceSkillTarget(null);
          }}
          onSave={handleEvidenceSave}
        />
      )}

      {reportTarget && (
        <ReportConversationModal
          name={reportTarget.company}
          alreadyBlocked={Boolean(messageModeration[reportTarget.id]?.blocked_by_me)}
          onCancel={() => setReportTarget(null)}
          onSubmit={submitMessageReport}
        />
      )}

      {blockTarget && (
        <ConfirmDialog
          title={`Block ${blockTarget.company}?`}
          message="They won't be able to message you here, and you won't be able to reply. Your application isn't affected. You can unblock them later."
          danger
          confirmLabel="Block"
          onCancel={() => setBlockTarget(null)}
          onConfirm={() => void confirmBlockEmployer()}
        />
      )}

      {withdrawModalOpen && withdrawTarget && (
        <ConfirmDialog
          title="Withdraw application?"
          message={`Your application for ${withdrawTarget.jobTitle} leaves employer review. This can't be undone.`}
          danger
          confirmLabel="Withdraw"
          onCancel={() => setWithdrawModalOpen(false)}
          onConfirm={confirmWithdraw}
        />
      )}

      {deleteModalOpen && (
        <ConfirmDialog
          title="Delete your profile?"
          message="This asks the Kareerly administrators to remove your candidate account, saved matches, applications and progress. Your account stays active until an administrator approves the request."
          danger
          confirmLabel="Request deletion"
          onCancel={() => setDeleteModalOpen(false)}
          onConfirm={() => {
            setDeleteModalOpen(false);
            requestAccountDeletion()
              .then(() => showToast('Profile deletion request sent. An administrator will review it.', 'success'))
              .catch((error) => showToast(error instanceof Error ? error.message : 'Unable to submit your deletion request.', 'danger'));
          }}
        />
      )}

      {deleteEvidenceTarget && (
        <ConfirmDialog
          title="Delete this proof?"
          message="If it supports an active skill gap, that skill's progress may go down."
          danger
          confirmLabel="Delete"
          onCancel={() => setDeleteEvidenceTarget(null)}
          onConfirm={confirmDeleteEvidence}
        />
      )}

      {resumePreview && (() => {
        const previewName = resumePreview.name.toLowerCase();
        const isPdf = resumePreview.mimeType.includes('pdf') || previewName.endsWith('.pdf');
        const isLegacyWord = resumePreview.mimeType.includes('msword') || previewName.endsWith('.doc');
        const loaded = docxPreviewResult?.url === resumePreview.url ? docxPreviewResult : null;
        const downloadHref = loaded?.blobUrl || resumePreview.url;
        const downloadLink = <a className="k-link" href={downloadHref} download={resumePreview.name}>Download the resume</a>;
        return (
          <Modal
            title="Resume"
            subtitle={<span className="[overflow-wrap:anywhere]">{resumePreview.name}</span>}
            onClose={closeResumePreview}
            size="xl"
            fullOnMobile
            fill
            headerActions={(
              <a className="k-btn k-btn-secondary k-btn-sm" href={downloadHref} download={resumePreview.name}>
                <FontAwesomeIcon icon={faDownload} aria-hidden="true" />Download
              </a>
            )}
          >
            {isLegacyWord ? (
              <Banner>Older Word (.doc) files can't be previewed here. {downloadLink}</Banner>
            ) : !loaded ? (
              <p className="k-secondary py-8 text-center" role="status">Preparing preview…</p>
            ) : loaded.error ? (
              <Banner>
                {loaded.error}{' '}
                <button className="k-link" type="button" onClick={() => { setDocxPreviewResult(null); setResumePreviewAttempt((attempt) => attempt + 1); }}>Try again</button>
                {' · '}{downloadLink}
              </Banner>
            ) : isPdf ? (
              <iframe className="cand-resume-preview-frame" src={loaded.blobUrl} title={`Preview of ${resumePreview.name}`} />
            ) : (
              <div
                className="cand-resume-preview-document"
                aria-label={`Preview of ${resumePreview.name}`}
                dangerouslySetInnerHTML={{ __html: loaded.html }}
              />
            )}
          </Modal>
        );
      })()}

      <ToastRegion toast={toast} onClose={() => setToast(null)} />
    </CandidateShell>
  );
}

import { useMemo, useState } from 'react';
import { faClipboardCheck, faDownload, faPaperPlane, faUsers } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Banner, ConfirmDialog, EmptyState, FormField, InfoTip, PageHeader, SearchField, SkeletonRows } from '../../components/ui';
import { assessmentDueDateProblem, defaultAssessmentDueDate, type CandidateAssessment } from '../../lib/assessmentApi';
import type { EvaluationSummary } from '../../lib/evaluationApi';
import { MatchScoreNotice } from '../../components/MatchScoreNotice';
import { EMPLOYER_MATCH_DISCLAIMER } from '../../lib/matchDisclaimer';
import { ApplicantRow } from './ApplicantRow';
import { AssessmentDeadlineField } from './AssessmentDeadlineField';
import { ExportApplicantsDialog } from './ApplicantReports';
import {
  ALL_JOBS,
  APPLICANT_SORTS,
  CANDIDATE_BULK_LABEL,
  candidateActionBlocker,
  HIGH_MATCH_PERCENT,
  profileMatch,
  visibleApplicants,
  type ApplicantSort,
  type CandidateBulkAction,
  type CandidateFilters,
} from './evaluation';
import {
  JOB_STATUS_LABEL,
  REJECTION_REASONS,
  type CandidateApplication,
  type CandidateStatus,
  type EmployerJob,
} from './model';

type EmployerCandidatesPageProps = {
  applications: CandidateApplication[];
  jobs: EmployerJob[];
  isLoading: boolean;
  loadFailed: boolean;
  filters: CandidateFilters;
  onFilters: (filters: CandidateFilters) => void;
  summaries: Map<string, EvaluationSummary>;
  /** Candidate Assessments by application id. */
  assessments: Map<string, CandidateAssessment>;
  /** Whether a job has its Candidate Assessment set up. */
  jobHasRubric: (jobId: string) => boolean;
  evaluationUnavailable: boolean;
  onReview: (candidateId: string) => void;
  onOpenJobs: () => void;
  onEditRubric: (jobId: string) => void;
  /** Applies a stage change to the eligible applicants; resolves when done. */
  onBulkAction: (action: CandidateBulkAction, candidateIds: string[], rejectionReason: string, assessmentDueDate: string) => Promise<void>;
};

const STATUSES: CandidateStatus[] = ['Pending', 'Shortlisted', 'Interviewing', 'Hired', 'Rejected', 'Withdrawn'];
const BULK_ACTIONS: CandidateBulkAction[] = ['send-assessment', 'shortlisted', 'interviewing', 'hired', 'rejected'];

type PendingBulk = { action: CandidateBulkAction; eligible: CandidateApplication[]; skipped: Array<{ candidate: CandidateApplication; reason: string }> };

function bulkMessage({ action, eligible, skipped }: PendingBulk): string {
  const people = `${eligible.length} applicant${eligible.length === 1 ? '' : 's'}`;
  const shortlistFirst = action === 'send-assessment' && eligible.some((candidate) => candidate.status === 'Pending')
    ? ' Pending applicants are shortlisted first, since the assessment is sent at shortlisting.'
    : '';
  const message = {
    shortlisted: `${people} will be shortlisted and sent the Candidate Assessment.`,
    'send-assessment': `${people} will receive the Candidate Assessment and be notified.${shortlistFirst}`,
    interviewing: `${people} will move to Interviewing. Their name and contact details become visible to you.`,
    hired: `${people} will be marked as hired. This is final.`,
    rejected: `${people} will be declined with the reason below. This is final.`,
  }[action];
  const reasons = Array.from(new Set(skipped.map((item) => item.reason)));
  return skipped.length > 0 ? `${message} ${skipped.length} selected applicant${skipped.length === 1 ? ' is' : 's are'} skipped (${reasons.join(', ')}).` : message;
}

export function EmployerCandidatesPage({
  applications,
  jobs,
  isLoading,
  loadFailed,
  filters,
  onFilters,
  summaries,
  assessments,
  jobHasRubric,
  evaluationUnavailable,
  onReview,
  onOpenJobs,
  onEditRubric,
  onBulkAction,
}: EmployerCandidatesPageProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<PendingBulk | null>(null);
  // The day Candidate Assessments sent by this action are due; starts at the 7 day default.
  const [dueDate, setDueDate] = useState(() => defaultAssessmentDueDate());
  const sendsAssessment = pending?.action === 'shortlisted' || pending?.action === 'send-assessment';
  const [rejectionReason, setRejectionReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  const allJobs = filters.jobId === ALL_JOBS;
  const job = allJobs ? null : jobs.find((item) => item.id === filters.jobId) || null;
  const jobById = useMemo(() => new Map(jobs.map((item) => [item.id, item])), [jobs]);
  const jobFor = (candidate: CandidateApplication) => jobById.get(candidate.jobId) || null;
  const hasRubric = job ? jobHasRubric(job.id) : false;
  const forJob = useMemo(() => (allJobs ? applications : applications.filter((candidate) => candidate.jobId === filters.jobId)), [applications, allJobs, filters.jobId]);
  const counts = useMemo(() => {
    const result = new Map<CandidateStatus, number>();
    forJob.forEach((candidate) => result.set(candidate.status, (result.get(candidate.status) || 0) + 1));
    return result;
  }, [forJob]);
  const highMatchCount = useMemo(() => forJob.filter((candidate) => {
    const percent = profileMatch(candidate, jobById.get(candidate.jobId) || null).percent;
    return percent !== null && percent >= HIGH_MATCH_PERCENT && (filters.status === 'all' || candidate.status === filters.status);
  }).length, [forJob, jobById, filters.status]);
  const visible = useMemo(() => visibleApplicants(applications, jobs, filters, summaries), [applications, jobs, filters, summaries]);
  const applicantCount = (jobId: string) => applications.filter((candidate) => candidate.jobId === jobId).length;
  const jobOptions = jobs.filter((item) => (item.status !== 'draft' && item.status !== 'archived') || applicantCount(item.id) > 0);
  // Changing what is shown clears the selection, so an action never reaches hidden applicants.
  const set = (patch: Partial<CandidateFilters>) => { setSelectedIds(new Set()); onFilters({ ...filters, ...patch }); };
  const isFiltered = Boolean(filters.search.trim()) || filters.status !== 'all' || filters.highMatch;
  const scoreSort = filters.sort === 'profile-match' || filters.sort === 'reviewed';

  const selectedVisible = visible.filter((candidate) => selectedIds.has(candidate.id));
  const allSelected = visible.length > 0 && selectedVisible.length === visible.length;
  const someSelected = selectedVisible.length > 0 && !allSelected;
  const blocker = (action: CandidateBulkAction, candidate: CandidateApplication) => candidateActionBlocker(action, candidate, assessments.get(candidate.id) || null, jobHasRubric(candidate.jobId));
  const eligibleCount = (action: CandidateBulkAction, list: CandidateApplication[]) => list.filter((candidate) => !blocker(action, candidate)).length;

  const toggle = (candidateId: string) => setSelectedIds((current) => {
    const next = new Set(current);
    if (next.has(candidateId)) next.delete(candidateId);
    else next.add(candidateId);
    return next;
  });
  const toggleAll = () => setSelectedIds(allSelected ? new Set() : new Set(visible.map((candidate) => candidate.id)));

  const request = (action: CandidateBulkAction, targets: CandidateApplication[]) => {
    const eligible: CandidateApplication[] = [];
    const skipped: PendingBulk['skipped'] = [];
    targets.forEach((candidate) => {
      const reason = blocker(action, candidate);
      if (reason) skipped.push({ candidate, reason });
      else eligible.push(candidate);
    });
    setRejectionReason('');
    setDueDate(defaultAssessmentDueDate());
    setPending({ action, eligible, skipped });
  };

  const run = async () => {
    if (!pending || pending.eligible.length === 0) {
      setPending(null);
      return;
    }
    setBusy(true);
    try {
      await onBulkAction(pending.action, pending.eligible.map((candidate) => candidate.id), rejectionReason, dueDate);
      setSelectedIds(new Set());
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  // Strong matches who still need the assessment, for the quick-send prompt.
  const highMatchNeedingAssessment = filters.highMatch ? visible.filter((candidate) => !blocker('send-assessment', candidate)) : [];

  return (
    <div className="k-page">
      <PageHeader
        title="Candidates"
        actions={!isLoading && applications.length > 0 ? (
          <button className="k-btn k-btn-secondary" type="button" onClick={() => { setExportError(''); setExporting(true); }}>
            <FontAwesomeIcon icon={faDownload} aria-hidden="true" />Download
          </button>
        ) : undefined}
      >
        <p className="k-secondary mt-1 flex items-center gap-1">
          Review applicants across all your jobs, or pick one job to compare them against its criteria.
          <InfoTip label="How applicant privacy works" align="left">
            Identity stays masked while an applicant is Pending or Shortlisted and is shown from Interviewing on. Withdrawn applications are read-only. You can't search or browse candidates who haven't applied to you.
          </InfoTip>
        </p>
      </PageHeader>

      {isLoading ? (
        <SkeletonRows count={4} label="Loading applicants" />
      ) : jobs.length === 0 || applications.length === 0 ? (
        <EmptyState
          icon={faUsers}
          title={loadFailed ? "Applicants couldn't load" : 'No applicants yet'}
          text={loadFailed ? 'Check your connection. The list refreshes on its own.' : 'Applicants appear here once candidates apply to your open jobs.'}
          actions={loadFailed ? undefined : <button className="k-btn k-btn-secondary" type="button" onClick={onOpenJobs}>View jobs</button>}
        />
      ) : (
        <>
          {exportError && <Banner tone="warn" className="mb-4" onDismiss={() => setExportError('')}>{exportError}</Banner>}

          <div className="grid gap-3 [&>.k-field+.k-field]:mt-0 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1fr)] lg:items-end">
            <FormField label="Job">
              <select className="k-select" value={filters.jobId} onChange={(event) => set({ jobId: event.target.value, status: 'all' })}>
                <option value={ALL_JOBS}>All jobs · {applications.length} applicant{applications.length === 1 ? '' : 's'}</option>
                {jobOptions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title} · {JOB_STATUS_LABEL[item.status]} · {applicantCount(item.id)} applicant{applicantCount(item.id) === 1 ? '' : 's'}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Sort by">
              <select className="k-select" value={filters.sort} onChange={(event) => onFilters({ ...filters, sort: event.target.value as ApplicantSort })}>
                {APPLICANT_SORTS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </FormField>
            <div className="sm:col-span-2 lg:col-span-1">
              <SearchField value={filters.search} onChange={(search) => set({ search })} label="Search applicants" placeholder="Search ID or skill" />
            </div>
          </div>

          <MatchScoreNotice text={EMPLOYER_MATCH_DISCLAIMER} className="mt-3" />

          <div className="k-chip-scroller my-4" role="group" aria-label="Filter applicants">
            <button className="k-chip" type="button" aria-pressed={filters.highMatch} onClick={() => set({ highMatch: !filters.highMatch })}>
              Match ≥ {HIGH_MATCH_PERCENT}% <span className="k-chip-count">{highMatchCount}</span>
            </button>
            <span className="mx-1 w-px self-stretch bg-bdr" aria-hidden="true" />
            <button className="k-chip" type="button" aria-pressed={filters.status === 'all'} onClick={() => set({ status: 'all' })}>
              Every stage <span className="k-chip-count">{forJob.length}</span>
            </button>
            {STATUSES.filter((value) => counts.get(value) || filters.status === value).map((value) => (
              <button key={value} className="k-chip" type="button" aria-pressed={filters.status === value} onClick={() => set({ status: value })}>
                {value} <span className="k-chip-count">{counts.get(value) || 0}</span>
              </button>
            ))}
          </div>

          {evaluationUnavailable ? (
            <Banner tone="warn" className="mb-4">Structured evaluation isn't available on this database yet. The match score and stage changes still work.</Banner>
          ) : !hasRubric && job ? (
            <Banner
              tone="info"
              className="mb-4"
              actions={<button className="k-btn k-btn-secondary k-btn-sm" type="button" onClick={() => onEditRubric(job.id)}><FontAwesomeIcon icon={faClipboardCheck} aria-hidden="true" />Set up assessment</button>}
            >
              Set up the Candidate Assessment for {job.title}. Shortlisted applicants receive its questions, and every reviewer rates the answers against the same criteria.
            </Banner>
          ) : null}

          {highMatchNeedingAssessment.length > 0 && (
            <Banner
              tone="info"
              className="mb-4"
              actions={(
                <button className="k-btn k-btn-primary k-btn-sm" type="button" onClick={() => request('send-assessment', highMatchNeedingAssessment)}>
                  <FontAwesomeIcon icon={faPaperPlane} aria-hidden="true" />Send Assessment to {highMatchNeedingAssessment.length}
                </button>
              )}
            >
              {highMatchNeedingAssessment.length} applicant{highMatchNeedingAssessment.length === 1 ? '' : 's'} matching {HIGH_MATCH_PERCENT}% or more of the required skills {highMatchNeedingAssessment.length === 1 ? "hasn't" : "haven't"} received the Candidate Assessment yet.
            </Banner>
          )}

          {scoreSort && (
            <p className="k-meta mb-3">
              {job ? `Sorted within ${job.title} only.` : 'Sorted across all jobs, each applicant scored against the job they applied to.'} Applicants without a figure are listed after the rest, not ranked as zero. A score is one input: read the evidence before deciding.
            </p>
          )}

          {visible.length === 0 ? (
            <EmptyState
              title="No applicants match"
              text={isFiltered ? (filters.highMatch ? `No applicants here match ${HIGH_MATCH_PERCENT}% or more of the required skills.` : 'Try another search or stage.') : (allJobs ? 'No one has applied to your jobs yet.' : 'No one has applied to this job yet.')}
              actions={isFiltered ? <button className="k-btn k-btn-secondary" type="button" onClick={() => set({ search: '', status: 'all', highMatch: false })}>Reset</button> : undefined}
            />
          ) : (
            <section aria-label={job ? `Applicants for ${job.title}` : 'Applicants for all jobs'}>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <label className="k-select-all k-secondary mb-0">
                  <span className="k-select-box -ml-1.5">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={(input) => { if (input) input.indeterminate = someSelected; }}
                      onChange={toggleAll}
                    />
                  </span>
                  {selectedVisible.length > 0 ? `${selectedVisible.length} of ${visible.length} selected` : `Select all ${visible.length}`}
                </label>
                <p className="k-meta" aria-live="polite">{visible.length} applicant{visible.length === 1 ? '' : 's'} shown</p>
              </div>
              <ul className="k-list">
                {visible.map((candidate) => (
                  <li key={candidate.id} className="flex items-start">
                    <label className="k-select-box ml-2 mt-3">
                      <input type="checkbox" checked={selectedIds.has(candidate.id)} onChange={() => toggle(candidate.id)} aria-label={`Select ${candidate.publicId || 'applicant'}`} />
                    </label>
                    <div className="min-w-0 flex-1">
                      <ApplicantRow candidate={candidate} job={jobFor(candidate)} summary={summaries.get(candidate.id)} assessment={assessments.get(candidate.id) || null} hasRubric={jobHasRubric(candidate.jobId)} onReview={onReview} showRole={allJobs} />
                    </div>
                  </li>
                ))}
              </ul>
              {selectedVisible.length > 0 && (
                <div className="k-bulk-bar" role="toolbar" aria-label="Actions for selected applicants">
                  <span className="k-bulk-bar-count">{selectedVisible.length} selected</span>
                  {BULK_ACTIONS.map((action) => {
                    const count = eligibleCount(action, selectedVisible);
                    return (
                      <button
                        key={action}
                        className={`k-btn k-btn-sm ${action === 'rejected' ? 'k-btn-danger-outline' : action === 'send-assessment' ? 'k-btn-primary' : 'k-btn-secondary'}`}
                        type="button"
                        disabled={count === 0}
                        title={count === 0 ? `None of the selected applicants can ${CANDIDATE_BULK_LABEL[action].toLowerCase()} right now.` : undefined}
                        onClick={() => request(action, selectedVisible)}
                      >
                        {CANDIDATE_BULK_LABEL[action]}{count > 0 ? ` (${count})` : ''}
                      </button>
                    );
                  })}
                  <button className="k-btn k-btn-ghost k-btn-sm" type="button" onClick={() => setSelectedIds(new Set())}>Clear</button>
                </div>
              )}
            </section>
          )}
        </>
      )}

      {exporting && (
        <ExportApplicantsDialog
          job={job}
          shown={visible}
          applications={applications}
          jobs={jobs}
          summaries={summaries}
          assessments={assessments}
          onClose={() => setExporting(false)}
          onError={(message) => { setExporting(false); setExportError(message); }}
        />
      )}

      {pending && (
        <ConfirmDialog
          title={pending.eligible.length === 0 ? 'No applicants can take this step' : `${CANDIDATE_BULK_LABEL[pending.action]}: ${pending.eligible.length} applicant${pending.eligible.length === 1 ? '' : 's'}?`}
          message={pending.eligible.length === 0
            ? `None of the selected applicants are eligible (${Array.from(new Set(pending.skipped.map((item) => item.reason))).join(', ')}).`
            : bulkMessage(pending)}
          confirmLabel={pending.eligible.length === 0 ? 'OK' : CANDIDATE_BULK_LABEL[pending.action]}
          danger={pending.action === 'rejected' && pending.eligible.length > 0}
          busy={busy}
          confirmDisabled={(pending.action === 'rejected' && pending.eligible.length > 0 && !rejectionReason) || (sendsAssessment && pending.eligible.length > 0 && Boolean(assessmentDueDateProblem(dueDate)))}
          onCancel={() => setPending(null)}
          onConfirm={run}
        >
          {sendsAssessment && pending.eligible.length > 0 && (
            <AssessmentDeadlineField className="mt-4" value={dueDate} onChange={setDueDate} />
          )}
          {pending.action === 'rejected' && pending.eligible.length > 0 && (
            <FormField label="Reason *" help="Use an objective, job-related reason. It is saved with each application." className="mt-4">
              <select className="k-select" value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)} required>
                <option value="">Select a reason</option>
                {REJECTION_REASONS.map((reason) => <option key={reason.value} value={reason.value}>{reason.label}</option>)}
              </select>
            </FormField>
          )}
        </ConfirmDialog>
      )}
    </div>
  );
}

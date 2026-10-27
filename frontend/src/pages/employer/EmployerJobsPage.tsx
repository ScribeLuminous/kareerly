import { useMemo, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faArrowLeft,
  faBoxArchive,
  faBriefcase,
  faClipboardCheck,
  faClipboardList,
  faLockOpen,
  faPen,
  faPlus,
  faTrash,
  faUsers,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';
import { Banner, ConfirmDialog, EmptyState, InfoTip, PageHeader, SearchField, SkeletonRows } from '../../components/ui';
import { draftSavedLabel, jobToDraft, validateJobDraft } from './jobDraft';
import { formatJobDescription } from '../../lib/jobDescription';
import { AssessmentSummary } from './AssessmentCriteriaEditor';
import { ChooseTemplatesModal, JobsSectionTabs, type JobsSection } from './AssessmentTemplatesPage';
import { rubricToDraft, type AssessmentTemplate, type Rubric } from './evaluation';
import {
  daysUntil,
  EMPTY_JOB_STATS,
  formatDateLabel,
  JOB_STATUS_LABEL,
  jobLocation,
  jobStatusBadgeClass,
  type EmployerJob,
  type JobStats,
  type JobStatus,
} from './model';

export type JobBulkAction = 'open' | 'close' | 'archive' | 'delete';

type JobHandlers = {
  onEdit: (job: EmployerJob) => void;
  onEditRubric: (jobId: string) => void;
  onViewApplicants: (jobId: string) => void;
  /** Applies a status change or delete to the eligible jobs; resolves when saved. */
  onBulkAction: (action: JobBulkAction, jobIds: string[]) => Promise<void>;
};

type EmployerJobsPageProps = JobHandlers & {
  jobs: EmployerJob[];
  jobStats: Map<string, JobStats>;
  /** Latest rubric version per job id, when one exists. */
  rubricVersions: Map<string, number>;
  /** Latest rubric per job id, for the assessment summary on a job's page. */
  latestRubrics: Map<string, Rubric>;
  templates: AssessmentTemplate[];
  /** Gives the jobs one or more templates (combined in order); resolves true when saved. */
  onApplyTemplates: (templateIds: string[], jobIds: string[]) => Promise<boolean>;
  onSection: (section: JobsSection) => void;
  isLoading: boolean;
  /** The job whose page is open; '' shows the list. */
  detailJobId: string;
  onOpenJob: (jobId: string) => void;
  onBackToList: () => void;
  onPostJob: () => void;
  /** An unsaved new posting kept on this device, if any. */
  newJobDraft: { title: string; savedAt: string } | null;
  onDiscardNewJobDraft: () => void;
};

type StatusFilter = 'all' | JobStatus;
const STATUS_FILTERS: StatusFilter[] = ['all', 'open', 'draft', 'closed', 'archived'];

const BULK_LABEL: Record<JobBulkAction, string> = { open: 'Open', close: 'Close', archive: 'Archive', delete: 'Delete' };

function jobMeta(job: EmployerJob): string[] {
  return [jobLocation(job), job.workSetup, job.employmentType].filter(Boolean);
}

function deadlineLabel(job: EmployerJob): string {
  if (!job.deadline) return '';
  if (job.status !== 'open') return `Deadline ${formatDateLabel(job.deadline)}`;
  const days = daysUntil(job.deadline);
  if (days !== null && days >= 0 && days <= 7) return days === 0 ? 'Closes today' : `Closes in ${days} day${days === 1 ? '' : 's'}`;
  return `Closes ${formatDateLabel(job.deadline)}`;
}

/** Whether a job can take this action, and why not when it can't. */
function jobActionBlocker(action: JobBulkAction, job: EmployerJob, applicants: number): string | null {
  if (action === 'open') {
    if (job.status === 'open') return 'already open';
    // Drafts can be saved half-filled; they post only once complete.
    if (job.status === 'draft' && validateJobDraft(jobToDraft(job))) return 'draft not finished';
    const days = daysUntil(job.deadline);
    if (days === null || days < 1) return 'deadline has passed';
    return null;
  }
  if (action === 'close') return job.status === 'open' ? null : 'not open';
  if (action === 'archive') return job.status === 'archived' ? 'already archived' : null;
  return applicants > 0 ? 'has applicants' : null;
}

function confirmCopy(action: JobBulkAction, eligible: number, skipped: Array<{ job: EmployerJob; reason: string }>) {
  const jobs = `${eligible} job${eligible === 1 ? '' : 's'}`;
  const message = {
    open: `${jobs} will be posted and start taking applications again.`,
    close: `${jobs} will stop taking applications. Current applicants stay in Candidates.`,
    archive: `${jobs} will be hidden from candidates and moved to Archived. Applicants and reviews are kept, and you can reopen them later.`,
    delete: `${jobs} will be permanently deleted, with their rubrics. This can't be undone.`,
  }[action];
  const reasons = Array.from(new Set(skipped.map((item) => item.reason)));
  const skipText = skipped.length === 0 ? '' : ` ${skipped.length} selected job${skipped.length === 1 ? ' is' : 's are'} skipped (${reasons.join(', ')}).`;
  const hint = action === 'delete' && skipped.some((item) => item.reason === 'has applicants') ? ' Archive jobs with applicants instead, so their records are kept.' : '';
  return `${message}${skipText}${hint}${openHint(action, skipped)}`;
}

function openHint(action: JobBulkAction, skipped: Array<{ reason: string }>): string {
  if (action !== 'open') return '';
  const unfinished = skipped.some((item) => item.reason === 'draft not finished') ? ' Edit unfinished drafts to fill in the required fields before posting.' : '';
  const expired = skipped.some((item) => item.reason === 'deadline has passed') ? ' Edit a job to set a later deadline before reopening it.' : '';
  return `${unfinished}${expired}`;
}

/** One job posting as a card: title, where, status, and how applicants are looking. */
function JobPostCard({ job, stats, checked, onToggle, onOpen }: { job: EmployerJob; stats: JobStats; checked: boolean; onToggle: () => void; onOpen: () => void }) {
  const meta = jobMeta(job);
  const deadline = deadlineLabel(job);
  return (
    <article className={`k-job-card ${checked ? 'k-job-card-selected' : ''}`}>
      <div className="k-job-top">
        <div className="flex min-w-0 items-start gap-2">
          <label className="k-select-box -ml-2 -mt-1.5">
            <input type="checkbox" checked={checked} onChange={onToggle} aria-label={`Select ${job.title}`} />
          </label>
          <div className="min-w-0">
            <h3 className="k-item-title">
              <button className="k-card-link" type="button" onClick={onOpen} aria-label={`${job.title}, open job page`}>
                {job.title}
              </button>
            </h3>
            {meta.length > 0 && <p className="k-meta k-dot-sep mt-0.5">{meta.map((part, index) => <span key={`${index}-${part}`}>{part}</span>)}</p>}
          </div>
        </div>
        <span className={jobStatusBadgeClass(job.status)}>{JOB_STATUS_LABEL[job.status]}</span>
      </div>
      <p className="k-secondary k-dot-sep pl-8">
        <span><strong className="k-num text-dark">{stats.applications}</strong> applicant{stats.applications === 1 ? '' : 's'}</span>
        {stats.pending > 0 && <span>{stats.pending} awaiting review</span>}
        {deadline && <span>{deadline}</span>}
      </p>
    </article>
  );
}

function JobAssessmentSection({ rubric, templateName, onEditRubric }: { rubric: Rubric | null; templateName: string; onEditRubric: () => void }) {
  return (
    <section className="k-detail-section" aria-label="Candidate Assessment">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="k-label">Candidate Assessment</h3>
        <button className="k-btn k-btn-ghost k-btn-sm" type="button" onClick={onEditRubric}>{rubric ? 'Edit' : 'Set up'}</button>
      </div>
      {rubric ? (
        <>
          {templateName && <p className="k-meta mb-2">Based on the template {templateName}.</p>}
          <AssessmentSummary criteria={rubricToDraft(rubric)} compact />
        </>
      ) : (
        <p className="k-secondary">No assessment yet. Shortlisted applicants receive its questions automatically once it is set up.</p>
      )}
    </section>
  );
}

function JobDetailBody({ job, stats }: { job: EmployerJob; stats: JobStats }) {
  const facts = [
    { label: 'Category', value: [job.category, job.subcategory].filter(Boolean).join(' · ') },
    { label: 'Level', value: job.experienceLevel },
    { label: 'Employment', value: job.employmentType },
    { label: 'Work setup', value: job.workSetup },
    { label: 'Location', value: jobLocation(job) },
    { label: 'Salary', value: job.salaryRange },
    { label: 'Deadline', value: job.deadline ? formatDateLabel(job.deadline) : '' },
    { label: 'Posted', value: job.postedDate ? formatDateLabel(job.postedDate) : '' },
  ].filter((fact) => fact.value);
  const description = job.description?.trim() ? formatJobDescription(job.description) : '';
  return (
    <>
      <section className="k-detail-section" aria-label="Applicants">
        <h3 className="k-label mb-2 flex items-center gap-1">
          Applicants by stage
          <InfoTip label="About applicant review">Applicants are compared only with others who applied to the same job, using this job's rubric.</InfoTip>
        </h3>
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: 'Total', value: stats.applications },
            { label: 'Awaiting review', value: stats.pending },
            { label: 'In progress', value: stats.inReview },
            { label: 'Closed', value: stats.closed },
          ].map((item) => (
            <div key={item.label} className="rounded-[10px] bg-bg px-3 py-2">
              <dt className="k-meta">{item.label}</dt>
              <dd className="k-num text-[20px] font-bold leading-7 text-dark">{item.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {(job.requiredSkills.length > 0 || job.niceToHaveSkills.length > 0) && (
        <section className="k-detail-section" aria-label="Skills">
          {job.requiredSkills.length > 0 && (
            <>
              <h3 className="k-label mb-2">Required skills</h3>
              <div className="k-chip-row flex-wrap gap-1.5">{job.requiredSkills.map((skill) => <span key={`req-${skill}`} className="k-skill">{skill}</span>)}</div>
            </>
          )}
          {job.niceToHaveSkills.length > 0 && (
            <>
              <h3 className="k-label mb-2 mt-4">Nice to have</h3>
              <div className="k-chip-row flex-wrap gap-1.5">{job.niceToHaveSkills.map((skill) => <span key={`nice-${skill}`} className="k-skill k-skill-nice">{skill}</span>)}</div>
            </>
          )}
        </section>
      )}

      <section className="k-detail-section" aria-label="About the role">
        <h3 className="k-label mb-2">About the role</h3>
        <div className="k-prose">
          {description ? <div className="whitespace-pre-wrap">{description}</div> : <p>No description yet.</p>}
          {job.responsibilities.length > 0 && (
            <>
              <p className="k-label mt-3">Responsibilities</p>
              <ul>{job.responsibilities.map((item) => <li key={item}>{item}</li>)}</ul>
            </>
          )}
          {job.qualifications.length > 0 && (
            <>
              <p className="k-label mt-3">Qualifications</p>
              <ul>{job.qualifications.map((item) => <li key={item}>{item}</li>)}</ul>
            </>
          )}
        </div>
      </section>

      {facts.length > 0 && (
        <section className="k-detail-section" aria-label="Details">
          <h3 className="k-label mb-2">Details</h3>
          <dl className="k-facts">
            {facts.map((fact) => (
              <div key={fact.label}>
                <dt>{fact.label}</dt>
                <dd>{fact.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </>
  );
}

type PendingAction = { action: JobBulkAction; eligible: EmployerJob[]; skipped: Array<{ job: EmployerJob; reason: string }>; onDone?: () => void };

/** A job's own page: everything about the posting, with its actions. */
function JobDetailPage({ job, stats, rubricVersion, rubric, templateName, onBack, onEdit, onEditRubric, onViewApplicants, onRequestAction }: Omit<JobHandlers, 'onBulkAction'> & {
  job: EmployerJob;
  stats: JobStats;
  rubricVersion?: number;
  rubric: Rubric | null;
  templateName: string;
  onBack: () => void;
  onRequestAction: (action: JobBulkAction) => void;
}) {
  return (
    <div className="k-page">
      <button className="k-btn k-btn-ghost k-btn-sm -ml-2 mb-3" type="button" onClick={onBack}>
        <FontAwesomeIcon icon={faArrowLeft} aria-hidden="true" />All jobs
      </button>
      <article className="k-detail" aria-label={`${job.title} details`}>
        <header className="k-detail-header">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="k-page-title">{job.title}</h1>
              <p className="k-secondary k-dot-sep mt-1">{jobMeta(job).map((part, index) => <span key={`${index}-${part}`}>{part}</span>)}</p>
            </div>
            <span className={jobStatusBadgeClass(job.status)}>{JOB_STATUS_LABEL[job.status]}</span>
          </div>
          <div className="k-detail-actions mt-4">
            <button className="k-btn k-btn-primary" type="button" onClick={() => onViewApplicants(job.id)}>
              <FontAwesomeIcon icon={faUsers} aria-hidden="true" />View applicants{stats.applications > 0 ? ` (${stats.applications})` : ''}
            </button>
            <button className="k-btn k-btn-secondary" type="button" onClick={() => onEdit(job)}>
              <FontAwesomeIcon icon={faPen} aria-hidden="true" />Edit
            </button>
            <button className="k-btn k-btn-secondary" type="button" onClick={() => onEditRubric(job.id)}>
              <FontAwesomeIcon icon={faClipboardCheck} aria-hidden="true" />{rubricVersion ? 'Assessment & rubric' : 'Set up assessment'}
            </button>
            {job.status === 'open' ? (
              <button className="k-btn k-btn-ghost" type="button" onClick={() => onRequestAction('close')}>
                <FontAwesomeIcon icon={faXmark} aria-hidden="true" />Close job
              </button>
            ) : (
              <button className="k-btn k-btn-ghost" type="button" onClick={() => onRequestAction('open')}>
                <FontAwesomeIcon icon={faLockOpen} aria-hidden="true" />{job.status === 'draft' ? 'Post job' : 'Reopen'}
              </button>
            )}
            {job.status !== 'archived' && (
              <button className="k-btn k-btn-ghost" type="button" onClick={() => onRequestAction('archive')}>
                <FontAwesomeIcon icon={faBoxArchive} aria-hidden="true" />Archive
              </button>
            )}
            {stats.applications === 0 && (
              <button className="k-btn k-btn-ghost text-red" type="button" onClick={() => onRequestAction('delete')}>
                <FontAwesomeIcon icon={faTrash} aria-hidden="true" />Delete
              </button>
            )}
          </div>
        </header>
        <div className="px-0">
          <JobDetailBody job={job} stats={stats} />
          <JobAssessmentSection rubric={rubric} templateName={templateName} onEditRubric={() => onEditRubric(job.id)} />
        </div>
      </article>
    </div>
  );
}

export function EmployerJobsPage({
  jobs,
  jobStats,
  rubricVersions,
  latestRubrics,
  templates,
  onApplyTemplates,
  onSection,
  isLoading,
  detailJobId,
  onOpenJob,
  onBackToList,
  onPostJob,
  newJobDraft,
  onDiscardNewJobDraft,
  onEdit,
  onEditRubric,
  onViewApplicants,
  onBulkAction,
}: EmployerJobsPageProps) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [choosingTemplate, setChoosingTemplate] = useState(false);
  const [confirmDiscardDraft, setConfirmDiscardDraft] = useState(false);

  const counts = useMemo(() => {
    const result: Record<StatusFilter, number> = { all: 0, open: 0, draft: 0, closed: 0, archived: 0 };
    jobs.forEach((job) => {
      result[job.status] += 1;
      if (job.status !== 'archived') result.all += 1;
    });
    return result;
  }, [jobs]);
  // "All" leaves archived jobs out; they have their own filter.
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return jobs.filter((job) => {
      if (status === 'all' ? job.status === 'archived' : job.status !== status) return false;
      if (!query) return true;
      return `${job.title} ${job.subcategory} ${job.city} ${job.province}`.toLowerCase().includes(query);
    });
  }, [jobs, search, status]);

  const selectedVisible = visible.filter((job) => selectedIds.has(job.id));
  const allSelected = visible.length > 0 && selectedVisible.length === visible.length;
  const someSelected = selectedVisible.length > 0 && !allSelected;
  const applicants = (job: EmployerJob) => (jobStats.get(job.id) || EMPTY_JOB_STATS).applications;

  const toggle = (jobId: string) => setSelectedIds((current) => {
    const next = new Set(current);
    if (next.has(jobId)) next.delete(jobId);
    else next.add(jobId);
    return next;
  });
  const toggleAll = () => setSelectedIds(allSelected ? new Set() : new Set(visible.map((job) => job.id)));

  const requestAction = (action: JobBulkAction, targets: EmployerJob[], onDone?: () => void) => {
    const eligible: EmployerJob[] = [];
    const skipped: PendingAction['skipped'] = [];
    targets.forEach((job) => {
      const reason = jobActionBlocker(action, job, applicants(job));
      if (reason) skipped.push({ job, reason });
      else eligible.push(job);
    });
    setPending({ action, eligible, skipped, onDone });
  };

  const runPending = async () => {
    if (!pending || pending.eligible.length === 0) {
      setPending(null);
      return;
    }
    setBusy(true);
    try {
      await onBulkAction(pending.action, pending.eligible.map((job) => job.id));
      setSelectedIds(new Set());
      pending.onDone?.();
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  const confirm = pending && (
    <ConfirmDialog
      title={pending.eligible.length === 0 ? `Nothing to ${BULK_LABEL[pending.action].toLowerCase()}` : `${BULK_LABEL[pending.action]} ${pending.eligible.length} job${pending.eligible.length === 1 ? '' : 's'}?`}
      message={pending.eligible.length === 0
        ? `None of the selected jobs can be changed: ${Array.from(new Set(pending.skipped.map((item) => item.reason))).join(', ')}.${pending.action === 'delete' ? ' Archive jobs with applicants instead, so their records are kept.' : ''}${openHint(pending.action, pending.skipped)}`
        : confirmCopy(pending.action, pending.eligible.length, pending.skipped)}
      confirmLabel={pending.eligible.length === 0 ? 'OK' : BULK_LABEL[pending.action]}
      danger={pending.action === 'delete' && pending.eligible.length > 0}
      busy={busy}
      onCancel={() => setPending(null)}
      onConfirm={runPending}
    />
  );

  if (detailJobId) {
    const job = jobs.find((item) => item.id === detailJobId) || null;
    if (!job) {
      return (
        <div className="k-page">
          {isLoading ? <SkeletonRows count={4} label="Loading job" /> : (
            <EmptyState
              icon={faBriefcase}
              title="Job not found"
              text="It may have been deleted."
              actions={<button className="k-btn k-btn-secondary" type="button" onClick={onBackToList}>All jobs</button>}
            />
          )}
        </div>
      );
    }
    return (
      <>
        <JobDetailPage
          job={job}
          stats={jobStats.get(job.id) || EMPTY_JOB_STATS}
          rubricVersion={rubricVersions.get(job.id)}
          rubric={latestRubrics.get(job.id) || null}
          templateName={templates.find((item) => item.id === latestRubrics.get(job.id)?.templateId)?.name || ''}
          onBack={onBackToList}
          onEdit={onEdit}
          onEditRubric={onEditRubric}
          onViewApplicants={onViewApplicants}
          onRequestAction={(action) => requestAction(action, [job], action === 'delete' ? onBackToList : undefined)}
        />
        {confirm}
      </>
    );
  }

  const isFiltered = Boolean(search.trim()) || status !== 'all';
  const bulkCount = (action: JobBulkAction) => selectedVisible.filter((job) => !jobActionBlocker(action, job, applicants(job))).length;

  return (
    <div className="k-page">
      <PageHeader
        title="Jobs"
        actions={!isLoading && jobs.length > 0 ? (
          <button className="k-btn k-btn-primary" type="button" onClick={onPostJob}>
            <FontAwesomeIcon icon={faPlus} aria-hidden="true" />Post a job
          </button>
        ) : undefined}
      />

      <JobsSectionTabs section="postings" templateCount={templates.length} onChange={onSection} />

      {newJobDraft && (
        <Banner
          tone="info"
          className="mb-4"
          actions={(
            <>
              <button className="k-btn k-btn-primary k-btn-sm" type="button" onClick={onPostJob}>Continue editing</button>
              <button className="k-btn k-btn-ghost k-btn-sm" type="button" onClick={() => setConfirmDiscardDraft(true)}>Discard</button>
            </>
          )}
        >
          You have an unposted job{newJobDraft.title ? <>, <strong>{newJobDraft.title}</strong>,</> : ''} kept on this device{newJobDraft.savedAt ? ` (last edited ${draftSavedLabel(newJobDraft.savedAt)})` : ''}.
        </Banner>
      )}

      {isLoading ? (
        <SkeletonRows count={4} label="Loading jobs" />
      ) : jobs.length === 0 ? (
        <EmptyState
          icon={faBriefcase}
          title="No jobs yet"
          text="Post a job to start receiving matched applicants."
          actions={<button className="k-btn k-btn-primary" type="button" onClick={onPostJob}>{newJobDraft ? 'Continue your draft' : 'Post a job'}</button>}
        />
      ) : (
        <>
          <div className="k-toolbar">
            <SearchField value={search} onChange={setSearch} label="Search jobs" placeholder="Search title, category or city" />
          </div>
          <div className="k-chip-scroller mb-4" role="group" aria-label="Filter by status">
            {STATUS_FILTERS.map((value) => (
              <button key={value} className="k-chip" type="button" aria-pressed={status === value} onClick={() => { setStatus(value); setSelectedIds(new Set()); }}>
                {value === 'all' ? 'All' : JOB_STATUS_LABEL[value]} <span className="k-chip-count">{counts[value]}</span>
              </button>
            ))}
          </div>

          {visible.length === 0 ? (
            <EmptyState
              title={status === 'archived' && !search.trim() ? 'No archived jobs' : 'No jobs match'}
              text={isFiltered ? 'Try another term or status.' : undefined}
              actions={<button className="k-btn k-btn-secondary" type="button" onClick={() => { setSearch(''); setStatus('all'); }}>Reset</button>}
            />
          ) : (
            <>
              <h2 className="sr-only">Job postings</h2>
              <label className="k-select-all k-secondary">
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
              <div className="k-job-grid">
                {visible.map((job) => (
                  <JobPostCard
                    key={job.id}
                    job={job}
                    stats={jobStats.get(job.id) || EMPTY_JOB_STATS}
                    checked={selectedIds.has(job.id)}
                    onToggle={() => toggle(job.id)}
                    onOpen={() => onOpenJob(job.id)}
                  />
                ))}
              </div>
              {selectedVisible.length > 0 && (
                <div className="k-bulk-bar" role="toolbar" aria-label="Actions for selected jobs">
                  <span className="k-bulk-bar-count">{selectedVisible.length} selected</span>
                  <button className="k-btn k-btn-secondary k-btn-sm" type="button" disabled={bulkCount('open') === 0} onClick={() => requestAction('open', selectedVisible)}>
                    <FontAwesomeIcon icon={faLockOpen} aria-hidden="true" />Open{bulkCount('open') > 0 ? ` (${bulkCount('open')})` : ''}
                  </button>
                  <button className="k-btn k-btn-secondary k-btn-sm" type="button" disabled={bulkCount('close') === 0} onClick={() => requestAction('close', selectedVisible)}>
                    <FontAwesomeIcon icon={faXmark} aria-hidden="true" />Close{bulkCount('close') > 0 ? ` (${bulkCount('close')})` : ''}
                  </button>
                  <button className="k-btn k-btn-secondary k-btn-sm" type="button" disabled={bulkCount('archive') === 0} onClick={() => requestAction('archive', selectedVisible)}>
                    <FontAwesomeIcon icon={faBoxArchive} aria-hidden="true" />Archive{bulkCount('archive') > 0 ? ` (${bulkCount('archive')})` : ''}
                  </button>
                  <button className="k-btn k-btn-secondary k-btn-sm" type="button" onClick={() => setChoosingTemplate(true)}>
                    <FontAwesomeIcon icon={faClipboardList} aria-hidden="true" />Set assessment
                  </button>
                  <button className="k-btn k-btn-danger-outline k-btn-sm" type="button" onClick={() => requestAction('delete', selectedVisible)}>
                    <FontAwesomeIcon icon={faTrash} aria-hidden="true" />Delete{bulkCount('delete') > 0 ? ` (${bulkCount('delete')})` : ''}
                  </button>
                  <button className="k-btn k-btn-ghost k-btn-sm" type="button" onClick={() => setSelectedIds(new Set())}>Clear</button>
                </div>
              )}
            </>
          )}
        </>
      )}
      {confirm}
      {confirmDiscardDraft && (
        <ConfirmDialog
          title="Discard this draft?"
          message="Everything you entered for this job is cleared. This can't be undone."
          confirmLabel="Discard draft"
          danger
          onCancel={() => setConfirmDiscardDraft(false)}
          onConfirm={() => { setConfirmDiscardDraft(false); onDiscardNewJobDraft(); }}
        />
      )}
      {choosingTemplate && (
        <ChooseTemplatesModal
          templates={templates}
          jobCount={selectedVisible.length}
          onApply={async (templateIds) => {
            const done = await onApplyTemplates(templateIds, selectedVisible.map((job) => job.id));
            if (done) setSelectedIds(new Set());
            return done;
          }}
          onManage={() => { setChoosingTemplate(false); onSection('templates'); }}
          onClose={() => setChoosingTemplate(false)}
        />
      )}
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBriefcase, faPen, faPlus, faUsers, faXmark } from '@fortawesome/free-solid-svg-icons';
import { EmptyState, InfoTip, Modal, PageHeader, SearchField, SkeletonRows } from '../../components/ui';
import { formatJobDescription } from '../../lib/jobDescription';
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

type JobHandlers = {
  onEdit: (job: EmployerJob) => void;
  onViewApplicants: (jobId: string) => void;
  onCloseJob: (job: EmployerJob) => void;
};

type EmployerJobsPageProps = JobHandlers & {
  jobs: EmployerJob[];
  jobStats: Map<string, JobStats>;
  isLoading: boolean;
  isDesktop: boolean;
  selectedJobId: string;
  detailOpen: boolean;
  onSelect: (jobId: string) => void;
  onCloseDetail: () => void;
  onPostJob: () => void;
};

const STATUS_FILTERS: Array<'all' | JobStatus> = ['all', 'open', 'draft', 'closed'];

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

/** One job posting as a card: title, where, status, and how applicants are looking. */
function JobPostCard({ job, stats, selected, onOpen }: { job: EmployerJob; stats: JobStats; selected: boolean; onOpen: () => void }) {
  const meta = jobMeta(job);
  const deadline = deadlineLabel(job);
  return (
    <article className="k-job-card" aria-current={selected ? 'true' : undefined}>
      <div className="k-job-top">
        <div className="min-w-0">
          <h3 className="k-item-title">
            <button className="k-card-link" type="button" onClick={onOpen} aria-label={`${job.title}, view details`}>
              {job.title}
            </button>
          </h3>
          {meta.length > 0 && <p className="k-meta k-dot-sep mt-0.5">{meta.map((part) => <span key={part}>{part}</span>)}</p>}
        </div>
        <span className={jobStatusBadgeClass(job.status)}>{JOB_STATUS_LABEL[job.status]}</span>
      </div>
      <p className="k-secondary k-dot-sep">
        <span><strong className="k-num text-dark">{stats.applications}</strong> applicant{stats.applications === 1 ? '' : 's'}</span>
        {stats.top > 0 && <span>{stats.top} top match{stats.top === 1 ? '' : 'es'}</span>}
        {deadline && <span>{deadline}</span>}
      </p>
    </article>
  );
}

function JobActions({ job, stats, onEdit, onViewApplicants, onCloseJob }: JobHandlers & { job: EmployerJob; stats: JobStats }) {
  return (
    <div className="k-detail-actions mt-0">
      <button className="k-btn k-btn-primary" type="button" onClick={() => onViewApplicants(job.id)}>
        <FontAwesomeIcon icon={faUsers} aria-hidden="true" />View applicants{stats.applications > 0 ? ` (${stats.applications})` : ''}
      </button>
      <button className="k-btn k-btn-secondary" type="button" onClick={() => onEdit(job)}>
        <FontAwesomeIcon icon={faPen} aria-hidden="true" />Edit
      </button>
      {job.status !== 'closed' && (
        <button className="k-btn k-btn-ghost" type="button" onClick={() => onCloseJob(job)}>
          <FontAwesomeIcon icon={faXmark} aria-hidden="true" />Close job
        </button>
      )}
    </div>
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
          Applicants
          <InfoTip label="About match bands">Top is 90% or more, Good is 75–89%, Partial is below 75%.</InfoTip>
        </h3>
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: 'Total', value: stats.applications },
            { label: 'Top', value: stats.top },
            { label: 'Good', value: stats.good },
            { label: 'Partial', value: stats.partial },
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
              <div className="k-chip-row gap-1.5">{job.requiredSkills.map((skill) => <span key={`req-${skill}`} className="k-skill">{skill}</span>)}</div>
            </>
          )}
          {job.niceToHaveSkills.length > 0 && (
            <>
              <h3 className="k-label mb-2 mt-4">Nice to have</h3>
              <div className="k-chip-row gap-1.5">{job.niceToHaveSkills.map((skill) => <span key={`nice-${skill}`} className="k-skill k-skill-nice">{skill}</span>)}</div>
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

export function EmployerJobsPage({
  jobs,
  jobStats,
  isLoading,
  isDesktop,
  selectedJobId,
  detailOpen,
  onSelect,
  onCloseDetail,
  onPostJob,
  onEdit,
  onViewApplicants,
  onCloseJob,
}: EmployerJobsPageProps) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | JobStatus>('all');
  const counts = useMemo(() => {
    const result: Record<'all' | JobStatus, number> = { all: jobs.length, open: 0, draft: 0, closed: 0 };
    jobs.forEach((job) => { result[job.status] += 1; });
    return result;
  }, [jobs]);
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return jobs.filter((job) => {
      if (status !== 'all' && job.status !== status) return false;
      if (!query) return true;
      return `${job.title} ${job.subcategory} ${job.city} ${job.province}`.toLowerCase().includes(query);
    });
  }, [jobs, search, status]);

  // Desktop always shows a job beside the list; phones open it on demand.
  const selected = jobs.find((job) => job.id === selectedJobId) || null;
  const selectedIsVisible = Boolean(selected && visible.some((job) => job.id === selected.id));
  useEffect(() => {
    if (isDesktop && !selectedIsVisible && visible.length > 0) onSelect(visible[0].id);
  }, [isDesktop, selectedIsVisible, visible, onSelect]);

  const handlers = { onEdit, onViewApplicants, onCloseJob };
  const selectedStats = selected ? jobStats.get(selected.id) || EMPTY_JOB_STATS : EMPTY_JOB_STATS;
  const isFiltered = Boolean(search.trim()) || status !== 'all';

  return (
    <div className="k-page">
      <PageHeader
        title="Jobs"
        actions={(
          <button className="k-btn k-btn-primary" type="button" onClick={onPostJob}>
            <FontAwesomeIcon icon={faPlus} aria-hidden="true" />Post a job
          </button>
        )}
      />

      {isLoading ? (
        <SkeletonRows count={4} label="Loading jobs" />
      ) : jobs.length === 0 ? (
        <EmptyState
          icon={faBriefcase}
          title="No jobs yet"
          text="Post a job to start receiving matched applicants."
          actions={<button className="k-btn k-btn-primary" type="button" onClick={onPostJob}>Post a job</button>}
        />
      ) : (
        <>
          <div className="k-toolbar">
            <SearchField value={search} onChange={setSearch} label="Search jobs" placeholder="Search title, category or city" />
          </div>
          <div className="k-chip-scroller mb-4" role="group" aria-label="Filter by status">
            {STATUS_FILTERS.map((value) => (
              <button key={value} className="k-chip" type="button" aria-pressed={status === value} onClick={() => setStatus(value)}>
                {value === 'all' ? 'All' : JOB_STATUS_LABEL[value]} <span className="k-chip-count">{counts[value]}</span>
              </button>
            ))}
          </div>

          {visible.length === 0 ? (
            <EmptyState
              title="No jobs match"
              text={isFiltered ? 'Try another term or status.' : undefined}
              actions={<button className="k-btn k-btn-secondary" type="button" onClick={() => { setSearch(''); setStatus('all'); }}>Reset</button>}
            />
          ) : (
            <div className={isDesktop ? 'k-split' : undefined}>
              <div>
                <h2 className="sr-only">Job postings</h2>
                <div className="k-job-grid">
                  {visible.map((job) => (
                    <JobPostCard
                      key={job.id}
                      job={job}
                      stats={jobStats.get(job.id) || EMPTY_JOB_STATS}
                      selected={isDesktop && selected?.id === job.id}
                      onOpen={() => onSelect(job.id)}
                    />
                  ))}
                </div>
              </div>
              {isDesktop && selected && selectedIsVisible && (
                <article className="k-split-detail k-detail" aria-label={`${selected.title} details`}>
                  <header className="k-detail-header">
                    <div className="flex items-start justify-between gap-3">
                      <h2 className="k-page-title text-[22px] leading-7">{selected.title}</h2>
                      <span className={jobStatusBadgeClass(selected.status)}>{JOB_STATUS_LABEL[selected.status]}</span>
                    </div>
                    <p className="k-secondary k-dot-sep mt-1">{jobMeta(selected).map((part) => <span key={part}>{part}</span>)}</p>
                    <div className="mt-4"><JobActions job={selected} stats={selectedStats} {...handlers} /></div>
                  </header>
                  <div className="k-detail-scroll">
                    <JobDetailBody job={selected} stats={selectedStats} />
                  </div>
                </article>
              )}
            </div>
          )}
        </>
      )}

      {!isDesktop && detailOpen && selected && (
        <Modal
          title={selected.title}
          subtitle={<span className="k-dot-sep">{jobMeta(selected).map((part) => <span key={part}>{part}</span>)}</span>}
          onClose={onCloseDetail}
          size="lg"
          fullOnMobile
          closeStyle="back"
          closeLabel="Close job details"
          footer={<div className="w-full"><JobActions job={selected} stats={selectedStats} {...handlers} /></div>}
        >
          <span className={jobStatusBadgeClass(selected.status)}>{JOB_STATUS_LABEL[selected.status]}</span>
          <JobDetailBody job={selected} stats={selectedStats} />
        </Modal>
      )}
    </div>
  );
}

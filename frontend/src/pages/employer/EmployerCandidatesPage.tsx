import { useMemo } from 'react';
import { faClipboardCheck, faUsers } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Banner, EmptyState, FormField, InfoTip, PageHeader, SearchField, SkeletonRows } from '../../components/ui';
import type { EvaluationSummary } from '../../lib/evaluationApi';
import { ApplicantRow } from './ApplicantRow';
import { APPLICANT_SORTS, visibleApplicants, type ApplicantSort, type CandidateFilters } from './evaluation';
import {
  JOB_STATUS_LABEL,
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
  hasRubric: boolean;
  evaluationUnavailable: boolean;
  onReview: (candidateId: string) => void;
  onOpenJobs: () => void;
  onEditRubric: (jobId: string) => void;
};

const STATUSES: CandidateStatus[] = ['Pending', 'Shortlisted', 'Interviewing', 'Hired', 'Rejected', 'Withdrawn'];

export function EmployerCandidatesPage({
  applications,
  jobs,
  isLoading,
  loadFailed,
  filters,
  onFilters,
  summaries,
  hasRubric,
  evaluationUnavailable,
  onReview,
  onOpenJobs,
  onEditRubric,
}: EmployerCandidatesPageProps) {
  const job = jobs.find((item) => item.id === filters.jobId) || null;
  const forJob = useMemo(() => applications.filter((candidate) => candidate.jobId === filters.jobId), [applications, filters.jobId]);
  const counts = useMemo(() => {
    const result = new Map<CandidateStatus, number>();
    forJob.forEach((candidate) => result.set(candidate.status, (result.get(candidate.status) || 0) + 1));
    return result;
  }, [forJob]);
  const visible = useMemo(() => visibleApplicants(applications, jobs, filters, summaries), [applications, jobs, filters, summaries]);
  const applicantCount = (jobId: string) => applications.filter((candidate) => candidate.jobId === jobId).length;
  const jobOptions = jobs.filter((item) => item.status !== 'draft' || applicantCount(item.id) > 0);
  const set = (patch: Partial<CandidateFilters>) => onFilters({ ...filters, ...patch });
  const isFiltered = Boolean(filters.search.trim()) || filters.status !== 'all';
  const scoreSort = filters.sort === 'profile-match' || filters.sort === 'reviewed';

  return (
    <div className="k-page">
      <PageHeader title="Candidates">
        <p className="k-secondary mt-1 flex items-center gap-1">
          Review applicants one job at a time, against that job's criteria.
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
          <div className="grid gap-3 [&>.k-field+.k-field]:mt-0 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1fr)] lg:items-end">
            <FormField label="Job">
              <select className="k-select" value={filters.jobId} onChange={(event) => onFilters({ ...filters, jobId: event.target.value, status: 'all' })}>
                {jobOptions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title} · {JOB_STATUS_LABEL[item.status]} · {applicantCount(item.id)} applicant{applicantCount(item.id) === 1 ? '' : 's'}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Sort by">
              <select className="k-select" value={filters.sort} onChange={(event) => set({ sort: event.target.value as ApplicantSort })}>
                {APPLICANT_SORTS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </FormField>
            <div className="sm:col-span-2 lg:col-span-1">
              <SearchField value={filters.search} onChange={(search) => set({ search })} label="Search applicants" placeholder="Search ID or skill" />
            </div>
          </div>

          <div className="k-chip-scroller my-4" role="group" aria-label="Filter by stage">
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
            <Banner tone="warn" className="mb-4">Structured evaluation isn't available on this database yet. Profile match and stage changes still work.</Banner>
          ) : !hasRubric && job ? (
            <Banner
              tone="info"
              className="mb-4"
              actions={<button className="k-btn k-btn-secondary k-btn-sm" type="button" onClick={() => onEditRubric(job.id)}><FontAwesomeIcon icon={faClipboardCheck} aria-hidden="true" />Set up rubric</button>}
            >
              Agree the criteria for {job.title} before scoring applicants, so every reviewer rates the same job-related evidence.
            </Banner>
          ) : null}

          {scoreSort && (
            <p className="k-meta mb-3">
              Sorted within {job?.title || 'this job'} only. Applicants without a figure are listed after the rest, not ranked as zero. A score is one input: read the evidence before deciding.
            </p>
          )}

          {visible.length === 0 ? (
            <EmptyState
              title="No applicants match"
              text={isFiltered ? 'Try another search or stage.' : 'No one has applied to this job yet.'}
              actions={isFiltered ? <button className="k-btn k-btn-secondary" type="button" onClick={() => set({ search: '', status: 'all' })}>Reset</button> : undefined}
            />
          ) : (
            <section aria-label={`Applicants for ${job?.title || 'this job'}`}>
              <p className="k-meta mb-2" aria-live="polite">{visible.length} applicant{visible.length === 1 ? '' : 's'} shown</p>
              <ul className="k-list">
                {visible.map((candidate) => (
                  <li key={candidate.id}>
                    <ApplicantRow candidate={candidate} job={job} summary={summaries.get(candidate.id)} hasRubric={hasRubric} onReview={onReview} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

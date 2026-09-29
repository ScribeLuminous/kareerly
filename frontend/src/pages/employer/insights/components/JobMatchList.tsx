import { faChevronRight } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { JobInsight } from '../insightsModel';

const COLUMNS = 'grid grid-cols-[minmax(0,1fr)_44px_56px_12px] items-center gap-x-2 sm:grid-cols-[minmax(0,1fr)_96px_112px_16px]';

/** A plain table: one line per job, numbers on the right. A row opens that job's applicants. */
export function JobMatchList({ jobs, onViewApplicants }: {
  jobs: JobInsight[];
  onViewApplicants: (jobId: string) => void;
}) {
  return (
    <div className="k-card overflow-hidden p-0">
      <div className={`${COLUMNS} border-b border-bdr px-4 py-2 k-meta`} aria-hidden="true">
        <span>Job</span>
        <span className="text-right"><span className="sm:hidden">Total</span><span className="hidden sm:inline">Applicants</span></span>
        <span className="text-right">Strong</span>
        <span />
      </div>
      <ul>
        {jobs.map((job) => (
          <li key={job.jobId} className="border-b border-bdr last:border-b-0">
            <button
              className={`${COLUMNS} min-h-[56px] w-full px-4 py-3 text-left hover:bg-tan-l focus-visible:outline-none focus-visible:shadow-[var(--k-focus)]`}
              type="button"
              aria-label={`${job.title}, ${job.isOpen ? 'open' : 'closed'}: ${job.applicants} applicant${job.applicants === 1 ? '' : 's'}, ${job.scored === 0 ? 'no skill data yet' : `${job.strong} strong`}. Review applicants.`}
              onClick={() => onViewApplicants(job.jobId)}
            >
              <span className="min-w-0">
                <span className="k-label line-clamp-2 block">{job.title}</span>
                <span className={`k-meta block ${job.isOpen ? 'font-semibold text-green' : ''}`}>{job.isOpen ? 'Open' : 'Closed'}</span>
              </span>
              <span className="k-num text-right text-dark">{job.applicants}</span>
              <span className="k-num text-right text-dark">
                {job.scored === 0 ? <span className="k-meta">No data</span> : <>{job.strong}<span className="k-meta"> of {job.applicants}</span></>}
              </span>
              <FontAwesomeIcon className="text-soft-text" icon={faChevronRight} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

import { useState } from 'react';
import { faChevronDown, faDownload } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { missingSkills, type JobInsight } from '../insightsModel';

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
const MAX_CHIPS = 3;

function JobRow({ job, expanded, onToggle, onViewApplicants, onDownloadJob }: {
  job: JobInsight;
  expanded: boolean;
  onToggle: () => void;
  onViewApplicants: (jobId: string) => void;
  onDownloadJob: (job: JobInsight) => void;
}) {
  const panelId = `insight-panel-${job.jobId}`;
  const skills = missingSkills(job);
  const share = Math.round((100 * job.strong) / job.applicants);
  return (
    <li className="border-b border-bdr last:border-b-0">
      <button
        className="flex min-h-[44px] w-full items-start gap-3 px-4 py-3 text-left hover:bg-tan-l focus-visible:outline-none focus-visible:shadow-[var(--k-focus)]"
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={onToggle}
      >
        <span className="min-w-0 flex-1">
          <span className="k-label line-clamp-2 block">{job.title}</span>
          <span className="k-meta mt-0.5 block">
            <span className={job.isOpen ? 'font-semibold text-green' : undefined}>{job.isOpen ? 'Open' : 'Closed'}</span> · {plural(job.applicants, 'applicant')}
          </span>
          <span className="mt-2 flex items-center gap-3">
            {job.scored === 0 ? (
              <span className="k-meta">No skill data yet</span>
            ) : (
              <>
                <span
                  className="k-meter max-w-[260px] flex-1"
                  role="meter"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={share}
                  aria-label={`${job.title}: ${job.strong} of ${plural(job.applicants, 'applicant')} are a strong match`}
                >
                  <span style={{ width: `${share}%` }} />
                </span>
                <span className="k-secondary shrink-0">{job.strong} of {job.applicants} strong</span>
              </>
            )}
          </span>
        </span>
        <FontAwesomeIcon className={`mt-1 text-soft-text ${expanded ? 'rotate-180' : ''}`} icon={faChevronDown} aria-hidden="true" />
      </button>
      {expanded && (
        <div id={panelId} className="grid gap-3 px-4 pb-4" role="region" aria-label={`${job.title} details`}>
          {skills.length > 0 && (
            <div>
              <p className="k-meta mb-1.5">Skills most often missing</p>
              <ul className="flex flex-wrap items-center gap-1.5">
                {skills.slice(0, MAX_CHIPS).map((stat) => (
                  <li key={stat.skill}><span className="k-badge k-badge-outline max-w-[240px] truncate" title={stat.skill}>{stat.skill}</span></li>
                ))}
                {skills.length > MAX_CHIPS && <li className="k-meta">+{skills.length - MAX_CHIPS} more</li>}
              </ul>
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <button className="k-btn k-btn-secondary" type="button" onClick={() => onViewApplicants(job.jobId)}>Review applicants</button>
            <button className="k-icon-btn" type="button" aria-label={`Download CSV for ${job.title}`} title="Download CSV for this job" onClick={() => onDownloadJob(job)}>
              <FontAwesomeIcon icon={faDownload} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

/** One plain row per job; the detail opens on demand, one job at a time. */
export function JobMatchList({ jobs, onViewApplicants, onDownloadJob }: {
  jobs: JobInsight[];
  onViewApplicants: (jobId: string) => void;
  onDownloadJob: (job: JobInsight) => void;
}) {
  const [expandedId, setExpandedId] = useState('');
  return (
    <ul className="k-card overflow-hidden p-0">
      {jobs.map((job) => (
        <JobRow
          key={job.jobId}
          job={job}
          expanded={expandedId === job.jobId}
          onToggle={() => setExpandedId((current) => (current === job.jobId ? '' : job.jobId))}
          onViewApplicants={onViewApplicants}
          onDownloadJob={onDownloadJob}
        />
      ))}
    </ul>
  );
}

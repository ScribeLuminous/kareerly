import { useState } from 'react';
import { faChevronDown, faDownload } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { JOB_STATUS_LABEL } from '../../model';
import { missingSkills, type JobInsight } from '../insightsModel';
import { MatchBadge } from './MatchBadge';
import { TierBar } from './TierBar';

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

function SkillChips({ job }: { job: JobInsight }) {
  const skills = missingSkills(job);
  if (skills.length === 0) return null;
  // Two chips on a phone, three from `sm` up; the rest fold into +N.
  const overflowMobile = skills.length - 2;
  const overflowDesktop = skills.length - 3;
  return (
    <div>
      <p className="k-meta mb-1.5">Often missing</p>
      <ul className="flex flex-wrap items-center gap-1.5">
        {skills.slice(0, 3).map((stat, index) => (
          <li key={stat.skill} className={index === 2 ? 'hidden sm:block' : undefined}>
            <span className="k-badge k-badge-outline max-w-[220px] truncate" title={stat.skill}>{stat.skill}</span>
          </li>
        ))}
        {overflowMobile > 0 && <li className="k-meta sm:hidden">+{overflowMobile}</li>}
        {overflowDesktop > 0 && <li className="k-meta hidden sm:block">+{overflowDesktop}</li>}
      </ul>
    </div>
  );
}

function JobRow({ job, expanded, onToggle, onViewApplicants, onDownloadJob }: {
  job: JobInsight;
  expanded: boolean;
  onToggle: () => void;
  onViewApplicants: (jobId: string) => void;
  onDownloadJob: (job: JobInsight) => void;
}) {
  const panelId = `insight-panel-${job.jobId}`;
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
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={`k-badge ${job.isOpen ? 'k-badge-success' : 'k-badge-outline'}`}>{job.isOpen ? JOB_STATUS_LABEL.open : JOB_STATUS_LABEL.closed}</span>
            <span className="k-meta">{plural(job.applicants, 'applicant')}</span>
          </span>
          <span className="mt-1.5 block"><MatchBadge level={job.level} avgMatch={job.avgMatch} /></span>
        </span>
        <FontAwesomeIcon className={`mt-1 text-soft-text ${expanded ? 'rotate-180' : ''}`} icon={faChevronDown} aria-hidden="true" />
      </button>
      {expanded && (
        <div id={panelId} className="grid gap-4 px-4 pb-4" role="region" aria-label={`${job.title} details`}>
          <TierBar counts={job.counts} total={job.applicants} title={job.title} />
          <p className="k-secondary">
            {job.strong} strong · {job.advanced} interviewing or hired
            {job.scored > 0 && job.strong === 0 && <span className="k-meta block">No strong matches</span>}
          </p>
          <SkillChips job={job} />
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

/** Jobs as collapsible rows: a headline when closed, the detail when open. One row opens at a time. */
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

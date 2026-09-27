import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronRight, faPlus } from '@fortawesome/free-solid-svg-icons';
import { NextStepCard, PageHeader, SectionHead, SeeAllLink, SkeletonRows, type NextStep } from '../../components/ui';
import {
  formatDateLabel,
  JOB_STATUS_LABEL,
  jobStatusBadgeClass,
  type EmployerJob,
} from './model';

type EmployerHomePageProps = {
  isLoading: boolean;
  nextSteps: NextStep[];
  pipeline: Array<{ label: string; count: number }>;
  /** Jobs with applicants still at Pending, most waiting first. Never ranked by score. */
  reviewQueue: Array<{ job: EmployerJob; pending: number; oldestApplied: string }>;
  openJobs: Array<EmployerJob & { applicantCount: number }>;
  onOpenCandidates: () => void;
  onOpenJobApplicants: (jobId: string) => void;
  onOpenJobs: () => void;
  onOpenJob: (jobId: string) => void;
  onPostJob: () => void;
};

export function EmployerHomePage({ isLoading, nextSteps, pipeline, reviewQueue, openJobs, onOpenCandidates, onOpenJobApplicants, onOpenJobs, onOpenJob, onPostJob }: EmployerHomePageProps) {
  const totalApplicants = pipeline.reduce((sum, stage) => sum + stage.count, 0);
  return (
    <div className="k-page">
      <PageHeader
        title="Home"
        actions={(
          <button className="k-btn k-btn-primary" type="button" onClick={onPostJob}>
            <FontAwesomeIcon icon={faPlus} aria-hidden="true" />Post a job
          </button>
        )}
      />
      <div className="grid gap-7 lg:grid-cols-12 lg:gap-8">
        <div className="min-w-0 space-y-7 lg:col-span-8 lg:space-y-8">
          <NextStepCard steps={nextSteps} />

          {isLoading ? (
            <section aria-label="Loading applicants">
              <SectionHead title="Waiting for review" />
              <SkeletonRows count={3} label="Loading applicants" />
            </section>
          ) : reviewQueue.length > 0 && (
            <section aria-labelledby="home-review-queue">
              <SectionHead id="home-review-queue" title="Waiting for review" action={<SeeAllLink onClick={onOpenCandidates} />} />
              <ul className="k-list">
                {reviewQueue.map(({ job, pending, oldestApplied }) => (
                  <li key={job.id}>
                    <button className="k-row" type="button" onClick={() => onOpenJobApplicants(job.id)}>
                      <span className="k-row-main">
                        <span className="k-label block truncate">{job.title}</span>
                        <span className="k-meta k-dot-sep mt-0.5 block">
                          <span>{pending} new applicant{pending === 1 ? '' : 's'}</span>
                          {oldestApplied && <span>Oldest applied {formatDateLabel(oldestApplied)}</span>}
                        </span>
                      </span>
                      <span className="k-meta">Review</span>
                      <FontAwesomeIcon className="k-row-chevron" icon={faChevronRight} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <div className="min-w-0 space-y-7 lg:col-span-4 lg:space-y-8">
          {!isLoading && totalApplicants > 0 && (
            <section aria-labelledby="home-pipeline">
              <SectionHead id="home-pipeline" title="Pipeline" count={totalApplicants} action={<SeeAllLink label="Open" onClick={onOpenCandidates} />} />
              <dl className="k-list">
                {pipeline.map((stage) => (
                  <div key={stage.label} className="k-row min-h-[48px] py-2">
                    <dt className="k-row-main k-secondary">{stage.label}</dt>
                    <dd className="k-label k-num">{stage.count}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          {isLoading ? (
            <section aria-label="Loading jobs">
              <SectionHead title="Open jobs" />
              <SkeletonRows count={2} label="Loading jobs" />
            </section>
          ) : (
            <section aria-labelledby="home-jobs">
              <SectionHead id="home-jobs" title="Open jobs" count={openJobs.length} action={<SeeAllLink onClick={onOpenJobs} />} />
              {openJobs.length === 0 ? (
                <p className="k-secondary">No open jobs. <button className="k-link" type="button" onClick={onPostJob}>Post a job</button></p>
              ) : (
                <ul className="k-list">
                  {openJobs.slice(0, 5).map((job) => (
                    <li key={job.id}>
                      <button className="k-row" type="button" onClick={() => onOpenJob(job.id)}>
                        <span className="k-row-main">
                          <span className="k-label block truncate">{job.title}</span>
                          <span className="k-meta k-dot-sep mt-0.5 block">
                            <span>{job.applicantCount} applicant{job.applicantCount === 1 ? '' : 's'}</span>
                            {job.deadline && <span>Closes {formatDateLabel(job.deadline)}</span>}
                          </span>
                        </span>
                        <span className={jobStatusBadgeClass(job.status)}>{JOB_STATUS_LABEL[job.status]}</span>
                        <FontAwesomeIcon className="k-row-chevron" icon={faChevronRight} aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

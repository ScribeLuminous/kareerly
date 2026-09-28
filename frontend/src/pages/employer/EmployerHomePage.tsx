import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCircleCheck, faChevronRight, faPlus } from '@fortawesome/free-solid-svg-icons';
import { NextStepCard, PageHeader, SectionHead, SeeAllLink, SkeletonRows, type NextStep } from '../../components/ui';
import {
  formatDateLabel,
  JOB_STATUS_LABEL,
  jobStatusBadgeClass,
  type EmployerJob,
} from './model';

export type HomeStrongMatch = {
  id: string;
  label: string;
  jobTitle: string;
  percent: number;
  /** Where the applicant is in the assessment step, in words. */
  assessment: string;
};

export type HomeSnapshot = { newThisWeek: number; openJobs: number; interviewing: number; hired: number };

export type HomeAssessments = { awaitingCandidate: number; toReview: number; reviewed: number };

type EmployerHomePageProps = {
  isLoading: boolean;
  nextSteps: NextStep[];
  pipeline: Array<{ label: string; count: number }>;
  /** Jobs with applicants still at Pending, most waiting first. */
  reviewQueue: Array<{ job: EmployerJob; pending: number; oldestApplied: string }>;
  openJobs: Array<EmployerJob & { applicantCount: number }>;
  /** Active applicants matching most of a job's required skills, strongest first. */
  strongMatches: HomeStrongMatch[];
  highMatchPercent: number;
  assessments: HomeAssessments;
  snapshot: HomeSnapshot;
  onOpenCandidates: () => void;
  onOpenJobApplicants: (jobId: string) => void;
  onOpenJobs: () => void;
  onOpenJob: (jobId: string) => void;
  onOpenApplicant: (candidateId: string) => void;
  onPostJob: () => void;
};

/** Shown in place of the next-step card when nothing needs the employer right now. */
function CaughtUpCard({ hasOpenJobs, onPostJob, onOpenJobs }: { hasOpenJobs: boolean; onPostJob: () => void; onOpenJobs: () => void }) {
  return (
    <section className="k-card" aria-labelledby="home-caught-up">
      <p className="k-eyebrow flex items-center gap-1.5 text-green">
        <FontAwesomeIcon icon={faCircleCheck} aria-hidden="true" />All caught up
      </p>
      <h2 id="home-caught-up" className="k-section-title mt-1">No applicants are waiting on you</h2>
      <p className="k-secondary mt-1">
        {hasOpenJobs
          ? 'New applicants and submitted assessments will show up here. Meanwhile, a few ways to reach more candidates:'
          : 'You have no open jobs, so no new applicants will arrive. Post or reopen a job to start receiving matches.'}
      </p>
      <ul className="k-secondary mt-3 list-disc space-y-1 pl-5">
        <li>List the few skills that truly matter as required; move the rest to nice to have, so more candidates match.</li>
        <li>Keep the deadline at least two weeks out; jobs close on their own when it passes.</li>
        <li>Set up the Candidate Assessment so shortlisted applicants get your questions straight away.</li>
      </ul>
      <div className="k-button-row mt-4">
        <button className="k-btn k-btn-primary" type="button" onClick={onPostJob}>Post a job</button>
        <button className="k-btn k-btn-secondary" type="button" onClick={onOpenJobs}>Review your jobs</button>
      </div>
    </section>
  );
}

export function EmployerHomePage({
  isLoading,
  nextSteps,
  pipeline,
  reviewQueue,
  openJobs,
  strongMatches,
  highMatchPercent,
  assessments,
  snapshot,
  onOpenCandidates,
  onOpenJobApplicants,
  onOpenJobs,
  onOpenJob,
  onOpenApplicant,
  onPostJob,
}: EmployerHomePageProps) {
  const totalApplicants = pipeline.reduce((sum, stage) => sum + stage.count, 0);
  const hasAssessments = assessments.awaitingCandidate + assessments.toReview + assessments.reviewed > 0;
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
          {!isLoading && (nextSteps.length > 0
            ? <NextStepCard steps={nextSteps} />
            : <CaughtUpCard hasOpenJobs={openJobs.length > 0} onPostJob={onPostJob} onOpenJobs={onOpenJobs} />)}

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

          {!isLoading && strongMatches.length > 0 && (
            <section aria-labelledby="home-strong-matches">
              <SectionHead id="home-strong-matches" title="Strong matches" count={strongMatches.length} action={<SeeAllLink onClick={onOpenCandidates} />} />
              <p className="k-meta -mt-1 mb-2">Active applicants whose application shows {highMatchPercent}% or more of the job's required skills. A match is one input: read the evidence before deciding.</p>
              <ul className="k-list">
                {strongMatches.map((match) => (
                  <li key={match.id}>
                    <button className="k-row" type="button" onClick={() => onOpenApplicant(match.id)}>
                      <span className="k-row-main">
                        <span className="k-label block truncate">{match.label}</span>
                        <span className="k-meta k-dot-sep mt-0.5 block">
                          <span>{match.jobTitle}</span>
                          <span>{match.assessment}</span>
                        </span>
                      </span>
                      <span className="k-badge k-badge-success">Match {match.percent}%</span>
                      <FontAwesomeIcon className="k-row-chevron" icon={faChevronRight} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {!isLoading && hasAssessments && (
            <section aria-labelledby="home-assessments">
              <SectionHead id="home-assessments" title="Candidate Assessments" action={<SeeAllLink label="Open" onClick={onOpenCandidates} />} />
              <dl className="grid grid-cols-3 gap-2">
                {[
                  { label: 'Awaiting candidates', value: assessments.awaitingCandidate },
                  { label: 'Ready to review', value: assessments.toReview },
                  { label: 'Reviewed', value: assessments.reviewed },
                ].map((item) => (
                  <div key={item.label} className="k-card px-3 py-2">
                    <dt className="k-meta">{item.label}</dt>
                    <dd className="k-num text-[20px] font-bold leading-7 text-dark">{item.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
        </div>

        <div className="min-w-0 space-y-7 lg:col-span-4 lg:space-y-8">
          {!isLoading && (
            <section aria-labelledby="home-snapshot">
              <SectionHead id="home-snapshot" title="At a glance" />
              <dl className="grid grid-cols-2 gap-2">
                {[
                  { label: 'New this week', value: snapshot.newThisWeek },
                  { label: 'Open jobs', value: snapshot.openJobs },
                  { label: 'Interviewing', value: snapshot.interviewing },
                  { label: 'Hired', value: snapshot.hired },
                ].map((item) => (
                  <div key={item.label} className="k-card px-3 py-2">
                    <dt className="k-meta">{item.label}</dt>
                    <dd className="k-num text-[20px] font-bold leading-7 text-dark">{item.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

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

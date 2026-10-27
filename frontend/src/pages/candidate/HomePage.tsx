import type { ReactNode } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowRight, faCircleCheck } from '@fortawesome/free-solid-svg-icons';
import { Banner, NextStepCard, SkeletonRows, type NextStep } from '../../components/ui';
import { JobCard } from './JobCard';
import { PageHeader, SectionHead, StatusBadge } from './common';
import {
  formatDateLabel,
  knownValue,
  type ApplicationStatus,
  type DashboardApplication,
  type DashboardJob,
} from './model';

export type { NextStep } from '../../components/ui';
/** A Candidate Assessment still waiting for the candidate's answers. */
export type HomeAssessmentDue = { applicationId: string; jobTitle: string; dueText: string; overdue: boolean };
export type ProfileTask = { label: string; done: boolean; onAction: () => void };
/** An open skill gap as the Skills page ranks it. */
export type HomeGap = { key: string; name: string; detail: string; tierLabel: string };

type HomePageProps = {
  isLoading: boolean;
  nextSteps: NextStep[];
  fitNowCount: number;
  aspirationCount: number;
  topMatches: DashboardJob[];
  getApplicationStatus: (job: DashboardJob) => ApplicationStatus | null;
  onOpenJob: (job: DashboardJob) => void;
  onOpenMatches: () => void;
  topGaps: HomeGap[];
  gapCount: number;
  /** The "Your resume at a glance" card. */
  resumeSummary?: ReactNode;
  onOpenSkills: () => void;
  recentApplications: DashboardApplication[];
  applicationLoadStatus: 'loading' | 'ready' | 'error';
  activeApplicationCount: number;
  onOpenApplications: () => void;
  profileTasks: ProfileTask[];
  /** Assessments to answer, soonest deadline first. */
  assessmentsDue?: HomeAssessmentDue[];
};

const seeAll = (label: string, onClick: () => void) => (
  <button className="k-link" type="button" onClick={onClick}>
    {label}<FontAwesomeIcon icon={faArrowRight} aria-hidden="true" />
  </button>
);

export function HomePage({
  isLoading,
  nextSteps,
  fitNowCount,
  aspirationCount,
  topMatches,
  getApplicationStatus,
  onOpenJob,
  onOpenMatches,
  topGaps,
  gapCount,
  resumeSummary,
  onOpenSkills,
  recentApplications,
  applicationLoadStatus,
  activeApplicationCount,
  onOpenApplications,
  profileTasks,
  assessmentsDue = [],
}: HomePageProps) {
  const hasMatches = fitNowCount + aspirationCount > 0;
  const openTasks = profileTasks.filter((task) => !task.done);
  const completion = profileTasks.length ? Math.round(((profileTasks.length - openTasks.length) / profileTasks.length) * 100) : 100;

  return (
    <div className="k-page">
      <PageHeader title="Home" />
      <div className="grid gap-7 lg:grid-cols-12 lg:gap-8">
        <div className="min-w-0 space-y-7 lg:col-span-8 lg:space-y-8">
          {assessmentsDue.length > 0 && (
            <Banner
              tone="warn"
              actions={<button className="k-btn k-btn-primary k-btn-sm" type="button" onClick={onOpenApplications}>{assessmentsDue[0].overdue ? 'View' : 'Answer now'}</button>}
            >
              {assessmentsDue.length === 1
                ? assessmentsDue[0].overdue
                  ? `The deadline for your Candidate Assessment for ${assessmentsDue[0].jobTitle} passed on ${assessmentsDue[0].dueText}. Ask the employer if they can give you more time.`
                  : `Your Candidate Assessment for ${assessmentsDue[0].jobTitle} is due ${assessmentsDue[0].dueText}.`
                : `You have ${assessmentsDue.length} Candidate Assessments to answer. The first is due ${assessmentsDue[0].dueText}.`}
            </Banner>
          )}
          <NextStepCard steps={nextSteps} />

          {isLoading && !hasMatches ? (
            <section aria-label="Loading matches">
              <SectionHead title="Your matches" />
              <SkeletonRows count={3} label="Loading matches" />
            </section>
          ) : hasMatches && (
            <section aria-labelledby="home-matches">
              <SectionHead id="home-matches" title="Your matches" action={seeAll('See all', onOpenMatches)} />
              <p className="k-secondary mb-3">
                <strong className="k-num text-dark">{fitNowCount}</strong> Fit Now · <strong className="k-num text-dark">{aspirationCount}</strong> Aspiration
              </p>
              <div className="k-job-grid lg:grid-cols-1">
                {topMatches.map((job) => (
                  <JobCard
                    key={`${job.jobSource}-${job.id}`}
                    job={job}
                    applicationStatus={getApplicationStatus(job)}
                    isSaved={false}
                    onOpen={() => onOpenJob(job)}
                  />
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="min-w-0 space-y-7 lg:col-span-4 lg:space-y-8">
          {resumeSummary}
          {topGaps.length > 0 && (
            <section aria-labelledby="home-skills">
              <SectionHead id="home-skills" title="Skills to build" count={gapCount} action={seeAll('See all', onOpenSkills)} />
              <ul className="k-list">
                {topGaps.map((gap) => (
                  <li key={gap.key}>
                    <button className="k-row" type="button" onClick={onOpenSkills}>
                      <span className="k-row-main">
                        <span className="k-label block">{gap.name}</span>
                        <span className="k-meta mt-0.5 block">{gap.detail}</span>
                      </span>
                      <span className="k-badge shrink-0">{gap.tierLabel}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {applicationLoadStatus === 'loading' ? (
            <section aria-label="Applications">
              <SectionHead title="Applications" />
              <SkeletonRows count={2} label="Loading applications" />
            </section>
          ) : applicationLoadStatus === 'error' ? (
            <section aria-labelledby="home-apps">
              <SectionHead id="home-apps" title="Applications" action={seeAll('Open', onOpenApplications)} />
              <p className="k-secondary">Applications couldn't load right now.</p>
            </section>
          ) : recentApplications.length > 0 && (
            <section aria-labelledby="home-apps">
              <SectionHead id="home-apps" title="Applications" action={seeAll('See all', onOpenApplications)} />
              <p className="k-secondary mb-3"><strong className="k-num text-dark">{activeApplicationCount}</strong> active</p>
              <ul className="k-list">
                {recentApplications.map((application) => (
                  <li key={application.id}>
                    <button className="k-row" type="button" onClick={onOpenApplications}>
                      <span className="k-row-main">
                        <span className="k-label block truncate">{application.jobTitle}</span>
                        <span className="k-meta k-dot-sep mt-0.5 block truncate">
                          {knownValue(application.company) && <span>{application.company}</span>}
                          {application.dateApplied && <span>{formatDateLabel(application.dateApplied)}</span>}
                        </span>
                      </span>
                      <StatusBadge status={application.status} />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {openTasks.length > 0 && (
            <section className="k-card" aria-labelledby="home-profile">
              <div className="flex items-baseline justify-between gap-3">
                <h2 id="home-profile" className="k-section-title">Finish your profile</h2>
                <span className="k-meta k-num">{completion}%</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-cream" role="progressbar" aria-label="Profile completion" aria-valuenow={completion} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-full rounded-full bg-green" style={{ width: `${completion}%` }} />
              </div>
              <ul className="mt-3 space-y-1">
                {profileTasks.map((task) => (
                  <li key={task.label}>
                    {task.done ? (
                      <span className="k-secondary flex min-h-[36px] items-center gap-2 text-soft-text line-through">
                        <FontAwesomeIcon icon={faCircleCheck} className="text-green" aria-hidden="true" />{task.label}
                        <span className="sr-only">(done)</span>
                      </span>
                    ) : (
                      <button className="k-link min-h-[36px]" type="button" onClick={task.onAction}>{task.label}</button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

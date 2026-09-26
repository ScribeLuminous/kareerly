import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowRight, faChevronRight, faCircleCheck } from '@fortawesome/free-solid-svg-icons';
import { SkeletonRows } from '../../components/ui';
import { JobCard } from './JobCard';
import { PageHeader, SectionHead, StatusBadge } from './common';
import {
  cleanSkillDisplayName,
  formatDateLabel,
  formatGapMissingCount,
  knownValue,
  severityBadgeClass,
  type ApplicationStatus,
  type DashboardApplication,
  type DashboardGap,
  type DashboardJob,
} from './model';

export type NextStep = { id: string; title: string; detail?: string; actionLabel: string; onAction: () => void };
export type ProfileTask = { label: string; done: boolean; onAction: () => void };

type HomePageProps = {
  isLoading: boolean;
  nextSteps: NextStep[];
  fitNowCount: number;
  aspirationCount: number;
  topMatches: DashboardJob[];
  getApplicationStatus: (job: DashboardJob) => ApplicationStatus | null;
  onOpenJob: (job: DashboardJob) => void;
  onOpenMatches: () => void;
  topGaps: DashboardGap[];
  gapCount: number;
  onOpenSkills: () => void;
  recentApplications: DashboardApplication[];
  applicationLoadStatus: 'loading' | 'ready' | 'error';
  activeApplicationCount: number;
  onOpenApplications: () => void;
  profileTasks: ProfileTask[];
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
  onOpenSkills,
  recentApplications,
  applicationLoadStatus,
  activeApplicationCount,
  onOpenApplications,
  profileTasks,
}: HomePageProps) {
  const [primary, ...moreSteps] = nextSteps;
  const hasMatches = fitNowCount + aspirationCount > 0;
  const openTasks = profileTasks.filter((task) => !task.done);
  const completion = profileTasks.length ? Math.round(((profileTasks.length - openTasks.length) / profileTasks.length) * 100) : 100;

  return (
    <div className="k-page">
      <PageHeader title="Home" />
      <div className="grid gap-7 lg:grid-cols-12 lg:gap-8">
        <div className="min-w-0 space-y-7 lg:col-span-8 lg:space-y-8">
          {primary && (
            <section className="k-card border-l-4 border-l-rust" aria-labelledby="next-step-title">
              <p className="k-eyebrow">Next step</p>
              <h2 id="next-step-title" className="k-section-title mt-1">{primary.title}</h2>
              {primary.detail && <p className="k-secondary mt-1">{primary.detail}</p>}
              <div className="mt-4">
                <button className="k-btn k-btn-primary" type="button" onClick={primary.onAction}>{primary.actionLabel}</button>
              </div>
              {moreSteps.length > 0 && (
                <details className="mt-4 border-t border-bdr pt-3">
                  <summary className="k-link cursor-pointer">{moreSteps.length} more step{moreSteps.length === 1 ? '' : 's'}</summary>
                  <ul className="mt-2">
                    {moreSteps.map((step) => (
                      <li key={step.id}>
                        <button className="k-row -mx-4 w-[calc(100%+2rem)] rounded-none px-4" type="button" onClick={step.onAction}>
                          <span className="k-row-main">
                            <span className="k-label block">{step.title}</span>
                            {step.detail && <span className="k-meta mt-0.5 block">{step.detail}</span>}
                          </span>
                          <FontAwesomeIcon className="k-row-chevron" icon={faChevronRight} aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </section>
          )}

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
          {topGaps.length > 0 && (
            <section aria-labelledby="home-skills">
              <SectionHead id="home-skills" title="Skills to build" count={gapCount} action={seeAll('See all', onOpenSkills)} />
              <ul className="k-list">
                {topGaps.map((gap) => (
                  <li key={gap.skill}>
                    <button className="k-row" type="button" onClick={onOpenSkills}>
                      <span className="k-row-main">
                        <span className="k-label block">{cleanSkillDisplayName(gap.skill)}</span>
                        <span className="k-meta mt-0.5 block">{formatGapMissingCount(gap)}</span>
                      </span>
                      <span className={severityBadgeClass(gap.severity)}>{gap.severity}</span>
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

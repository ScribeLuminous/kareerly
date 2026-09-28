import { useMemo, useState } from 'react';
import { faChartColumn, faChevronRight, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { EmptyState, InfoTip, PageHeader, SectionHead, Segmented, SkeletonRows } from '../../components/ui';
import { HIGH_MATCH_PERCENT } from './evaluation';
import { JOB_STATUS_LABEL, jobStatusBadgeClass, type CandidateApplication, type EmployerJob } from './model';
import {
  insightTotals,
  jobMatchInsights,
  MATCH_BAND_LABELS,
  skillGapsAcrossJobs,
  type JobMatchInsight,
  type MatchBands,
} from './reports';

type Scope = 'open' | 'all';

type EmployerInsightsPageProps = {
  applications: CandidateApplication[];
  jobs: EmployerJob[];
  isLoading: boolean;
  loadFailed: boolean;
  onViewApplicants: (jobId: string) => void;
  onOpenJobs: () => void;
};

// One hue, darker for a stronger match; "no figure" is the neutral track colour.
const BAND_COLORS: Record<keyof MatchBands, string> = {
  strong: 'var(--forest)',
  partial: 'var(--forest-m)',
  low: '#A9C4B7',
  noFigure: 'var(--bdr)',
};

const percentText = (value: number | null) => (value === null ? '–' : `${value}%`);
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

function StatTile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="k-card px-4 py-3">
      <dt className="k-meta">{label}</dt>
      <dd className="k-num mt-0.5 text-[24px] font-bold leading-8 text-dark">{value}</dd>
      {detail && <dd className="k-meta">{detail}</dd>}
    </div>
  );
}

/** How a job's applicants split across the match bands, as one stacked bar. */
function BandBar({ bands, total, label }: { bands: MatchBands; total: number; label: string }) {
  const parts = MATCH_BAND_LABELS.filter((band) => bands[band.key] > 0);
  const description = parts.map((band) => `${bands[band.key]} ${band.label.toLowerCase()}`).join(', ');
  return (
    <span className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full" role="img" aria-label={`${label}: ${description}`}>
      {parts.map((band) => (
        <span
          key={band.key}
          className="h-full first:rounded-l-full last:rounded-r-full"
          style={{ width: `${(100 * bands[band.key]) / total}%`, background: BAND_COLORS[band.key] }}
          title={`${band.label} (${band.range}): ${plural(bands[band.key], 'applicant')}`}
        />
      ))}
    </span>
  );
}

function BandLegend() {
  return (
    <ul className="k-meta flex flex-wrap gap-x-4 gap-y-1" aria-label="Match bands">
      {MATCH_BAND_LABELS.map((band) => (
        <li key={band.key} className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: BAND_COLORS[band.key] }} aria-hidden="true" />
          <span><span className="font-semibold text-mid">{band.label}</span> {band.range}</span>
        </li>
      ))}
    </ul>
  );
}

function JobInsightRow({ insight, onViewApplicants }: { insight: JobMatchInsight; onViewApplicants: (jobId: string) => void }) {
  const noStrong = insight.withMatch > 0 && insight.highMatches === 0;
  return (
    <li>
      <button className="k-row items-start py-3" type="button" onClick={() => onViewApplicants(insight.job.id)}>
        <span className="k-row-main min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            <span className="k-label">{insight.job.title}</span>
            <span className={jobStatusBadgeClass(insight.job.status)}>{JOB_STATUS_LABEL[insight.job.status]}</span>
            {noStrong && (
              <span className="k-badge k-badge-warn">
                <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden="true" />No strong matches
              </span>
            )}
          </span>
          <span className="mt-2 block">
            <BandBar bands={insight.bands} total={insight.applicants} label={insight.job.title} />
          </span>
          <span className="k-meta k-dot-sep mt-1.5 block">
            <span>{plural(insight.applicants, 'applicant')}</span>
            <span>{insight.highMatches} strong</span>
            {insight.advanced > 0 && <span>{insight.advanced} interviewing or hired</span>}
          </span>
          {insight.commonGaps.length > 0 && (
            <span className="k-meta mt-0.5 block">
              Often missing: {insight.commonGaps.map((gap) => gap.skill).join(', ')}
            </span>
          )}
        </span>
        <span className="shrink-0 text-right">
          <span className="k-num block text-[18px] font-bold leading-6 text-dark">{percentText(insight.averageMatch)}</span>
          <span className="k-meta block">avg match</span>
        </span>
        <FontAwesomeIcon className="k-row-chevron self-center" icon={faChevronRight} aria-hidden="true" />
      </button>
    </li>
  );
}

export function EmployerInsightsPage({ applications, jobs, isLoading, loadFailed, onViewApplicants, onOpenJobs }: EmployerInsightsPageProps) {
  const [scope, setScope] = useState<Scope>('all');
  const scopedJobs = useMemo(() => (scope === 'open' ? jobs.filter((job) => job.status === 'open') : jobs), [jobs, scope]);
  const insights = useMemo(() => jobMatchInsights(applications, scopedJobs), [applications, scopedJobs]);
  const totals = useMemo(() => insightTotals(insights), [insights]);
  const gaps = useMemo(() => skillGapsAcrossJobs(applications, scopedJobs), [applications, scopedJobs]);

  return (
    <div className="k-page">
      <PageHeader title="Insights">
        <p className="k-secondary mt-1 flex items-center gap-1">
          How well your applicants match the skills your jobs require.
          <InfoTip label="How insights are worked out" align="left">
            Profile match is the share of a job's required skills found in an application. A strong match has {HIGH_MATCH_PERCENT}% or more. Withdrawn applications are left out, and applicants without skill evidence have no figure.
          </InfoTip>
        </p>
      </PageHeader>

      {isLoading ? (
        <SkeletonRows count={4} label="Loading insights" />
      ) : applications.length === 0 ? (
        <EmptyState
          icon={faChartColumn}
          title={loadFailed ? "Insights couldn't load" : 'No insights yet'}
          text={loadFailed ? 'Check your connection. The page refreshes on its own.' : 'Insights appear once candidates apply to your jobs.'}
          actions={loadFailed ? undefined : <button className="k-btn k-btn-secondary" type="button" onClick={onOpenJobs}>View jobs</button>}
        />
      ) : (
        <div className="space-y-8">
          <Segmented
            label="Jobs included"
            value={scope}
            onChange={setScope}
            options={[
              { value: 'all', label: 'All jobs' },
              { value: 'open', label: 'Open jobs' },
            ]}
          />

          {insights.length === 0 ? (
            <EmptyState
              icon={faChartColumn}
              title="No applicants to open jobs"
              text="Switch to All jobs to see insights from closed and archived posts."
              actions={<button className="k-btn k-btn-secondary" type="button" onClick={() => setScope('all')}>Show all jobs</button>}
            />
          ) : (
            <>
              <section aria-labelledby="insights-summary">
                <h2 id="insights-summary" className="sr-only">Summary</h2>
                <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <StatTile label="Applicants" value={String(totals.applicants)} detail={`across ${plural(totals.jobs, 'job')}`} />
                  <StatTile label="Average match" value={percentText(totals.averageMatch)} detail={totals.withMatch < totals.applicants ? `${totals.withMatch} with a match figure` : 'of required skills'} />
                  <StatTile label="Strong matches" value={String(totals.highMatches)} detail={totals.highMatchShare === null ? `${HIGH_MATCH_PERCENT}% or more` : `${totals.highMatchShare}% of applicants`} />
                  <StatTile label="Interviewing or hired" value={String(totals.advanced)} />
                </dl>
                {totals.jobsWithoutStrong > 0 && (
                  <p className="k-secondary mt-3 flex items-start gap-2">
                    <FontAwesomeIcon className="mt-1 text-amber" icon={faTriangleExclamation} aria-hidden="true" />
                    <span>
                      {plural(totals.jobsWithoutStrong, 'job')} {totals.jobsWithoutStrong === 1 ? 'has' : 'have'} no strong matches yet. Check whether the required skills are all essential.
                    </span>
                  </p>
                )}
              </section>

              <section aria-labelledby="insights-jobs">
                <SectionHead id="insights-jobs" title="Match by job" count={insights.length} />
                <p className="k-meta -mt-1 mb-3">Ranked by strong matches, then average match. Select a job to review its applicants.</p>
                <BandLegend />
                <ul className="k-list mt-3">
                  {insights.map((insight) => <JobInsightRow key={insight.job.id} insight={insight} onViewApplicants={onViewApplicants} />)}
                </ul>
              </section>

              {gaps.length > 0 && (
                <section aria-labelledby="insights-gaps">
                  <SectionHead id="insights-gaps" title="Skills applicants most often lack" />
                  <p className="k-meta -mt-1 mb-3">Required skills not found in applications, across the jobs above. A common gap may mean the skill is scarce, or that it could be trained on the job.</p>
                  <ul className="k-card grid grid-cols-[minmax(0,1fr)] gap-4">
                    {gaps.map((gap) => (
                      <li key={gap.skill.toLowerCase()}>
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="k-label">{gap.skill}</span>
                          <span className="k-meta k-num shrink-0">{gap.missing} of {plural(gap.assessed, 'applicant')}</span>
                        </div>
                        <span
                          className="k-meter mt-1.5"
                          role="meter"
                          aria-valuemin={0}
                          aria-valuemax={gap.assessed}
                          aria-valuenow={gap.missing}
                          aria-label={`${gap.skill}: missing for ${gap.missing} of ${gap.assessed} applicants`}
                        >
                          <span style={{ width: `${(100 * gap.missing) / gap.assessed}%`, background: 'var(--rust)' }} />
                        </span>
                        <span className="k-meta mt-1 block truncate">{gap.jobTitles.join(' · ')}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { faChartColumn } from '@fortawesome/free-solid-svg-icons';
import { EmptyState, InfoTip, PageHeader, SectionHead, Segmented, SkeletonRows, type ToastState } from '../../../components/ui';
import type { CandidateApplication, EmployerJob } from '../model';
import { DownloadMenu, type ReportKind, type ReportScope } from './components/DownloadMenu';
import { JobMatchList } from './components/JobMatchList';
import { SkillGapList } from './components/SkillGapList';
import { SummaryCard } from './components/SummaryCard';
import { downloadInsightsCsv } from './export/exportCsv';
import { buildJobInsights, buildKpis, INSIGHTS_DISCLAIMER, filterJobs, parseStatusFilter, sortJobs, topMissingSkills, type JobInsight, type StatusFilter } from './insightsModel';
import { STRONG_MATCH_PERCENT } from './matchTiers';

type InsightsPageProps = {
  applications: CandidateApplication[];
  jobs: EmployerJob[];
  employerName: string;
  isLoading: boolean;
  loadFailed: boolean;
  onViewApplicants: (jobId: string) => void;
  onPostJob: () => void;
  onToast: (message: string, type: NonNullable<ToastState>['type'], action?: { label: string; onClick: () => void }) => void;
};

const FILTER_LABEL: Record<StatusFilter, string> = { open: 'Open jobs', closed: 'Closed jobs', all: 'All jobs' };
const REPORT_GAP_LIMIT = 5;

function InsightsSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-label="Loading insights" aria-busy="true">
      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4" aria-hidden="true">
        {Array.from({ length: 4 }).map((_, index) => <div key={index} className="k-skel h-[92px] rounded-[12px]" />)}
      </div>
      <SkeletonRows count={4} label="Loading jobs" />
    </div>
  );
}

export function InsightsPage({ applications, jobs, employerName, isLoading, loadFailed, onViewApplicants, onPostJob, onToast }: InsightsPageProps) {
  const [params, setParams] = useSearchParams();
  const status = parseStatusFilter(params.get('status'));
  const [busy, setBusy] = useState(false);

  const allInsights = useMemo(() => sortJobs(buildJobInsights(applications, jobs)), [applications, jobs]);
  const visible = useMemo(() => sortJobs(filterJobs(allInsights, status)), [allInsights, status]);
  const kpis = useMemo(() => buildKpis(visible), [visible]);
  const gaps = useMemo(() => topMissingSkills(visible), [visible]);
  const counts = useMemo(() => ({
    open: filterJobs(allInsights, 'open').length,
    closed: filterJobs(allInsights, 'closed').length,
    all: allInsights.length,
  }), [allInsights]);

  const setStatus = (next: StatusFilter) => setParams({ status: next }, { replace: true });

  const download = async (kind: ReportKind, scope: ReportScope) => {
    if (busy) return;
    const reportJobs: JobInsight[] = scope === 'all' ? allInsights : visible;
    setBusy(true);
    try {
      const generatedAt = new Date();
      if (kind === 'csv') downloadInsightsCsv(reportJobs, generatedAt);
      else {
        const { downloadInsightsPdf } = await import('./export/exportPdf');
        await downloadInsightsPdf({
          employerName,
          generatedAt,
          filterLabel: scope === 'all' ? 'All jobs' : FILTER_LABEL[status],
          kpis: buildKpis(reportJobs),
          jobs: reportJobs,
          gaps: topMissingSkills(reportJobs, REPORT_GAP_LIMIT),
        });
      }
      onToast('Report downloaded', 'success');
    } catch {
      onToast("Couldn't prepare the report.", 'warn', { label: 'Retry', onClick: () => void download(kind, scope) });
    } finally {
      setBusy(false);
    }
  };

  const downloadJob = (job: JobInsight) => {
    try {
      downloadInsightsCsv([job], new Date(), job.title);
      onToast('Report downloaded', 'success');
    } catch {
      onToast("Couldn't prepare the report.", 'warn', { label: 'Retry', onClick: () => downloadJob(job) });
    }
  };

  return (
    <div className="k-page pb-10">
      <PageHeader
        title="Insights"
        actions={!isLoading && !loadFailed && allInsights.length > 0 ? <DownloadMenu busy={busy} currentLabel={FILTER_LABEL[status]} onDownload={download} /> : undefined}
      >
        <p className="k-secondary mt-1 flex items-center gap-1">
          How well your applicants match the skills your jobs require.
          <InfoTip label="How insights are worked out" align="right">
            A strong match has {STRONG_MATCH_PERCENT}% or more of the skills a job requires. Applicants who haven't shared skill data can't be scored, and withdrawn applications are left out.
          </InfoTip>
        </p>
      </PageHeader>

      {isLoading ? (
        <InsightsSkeleton />
      ) : loadFailed ? (
        <EmptyState
          icon={faChartColumn}
          title="Insights couldn't load"
          text="Check your connection and try again."
          actions={<button className="k-btn k-btn-secondary" type="button" onClick={() => window.location.reload()}>Retry</button>}
        />
      ) : allInsights.length === 0 ? (
        <EmptyState
          icon={faChartColumn}
          title="No insights yet"
          text="Insights appear once candidates apply to your jobs."
          actions={<button className="k-btn k-btn-primary" type="button" onClick={onPostJob}>Post a job</button>}
        />
      ) : (
        <div className="space-y-8">
          <div className="[&_.k-seg-btn]:min-h-[44px]">
            <Segmented
              label="Jobs included"
              value={status}
              onChange={setStatus}
              options={[
                { value: 'open', label: 'Open', count: counts.open },
                { value: 'closed', label: 'Closed', count: counts.closed },
                { value: 'all', label: 'All', count: counts.all },
              ]}
            />
          </div>

          {visible.length === 0 ? (
            <EmptyState
              icon={faChartColumn}
              title={status === 'open' ? 'No applicants on open jobs yet' : 'No applicants on closed jobs'}
              text="Switch the filter to see the rest of your jobs."
              actions={<button className="k-btn k-btn-secondary" type="button" onClick={() => setStatus('all')}>Show all jobs</button>}
            />
          ) : (
            <>
              <SummaryCard kpis={kpis} />

              <section aria-labelledby="insights-jobs">
                <SectionHead id="insights-jobs" title="Jobs" count={visible.length} />
                <JobMatchList jobs={visible} onViewApplicants={onViewApplicants} onDownloadJob={downloadJob} />
              </section>

              {gaps.length > 0 && (
                <section aria-labelledby="insights-gaps">
                  <SectionHead id="insights-gaps" title="Skills most often missing" />
                  <p className="k-meta -mt-1 mb-3">Required skills that applicants don't show yet. A common gap may mean the skill is scarce, or could be trained on the job.</p>
                  <SkillGapList gaps={gaps} />
                </section>
              )}
            </>
          )}

          <p className="k-meta">{INSIGHTS_DISCLAIMER}</p>
        </div>
      )}
    </div>
  );
}

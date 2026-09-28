import { useMemo, useState } from 'react';
import { faChartColumn, faFileCsv, faFilePdf } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { InfoTip, Modal, Segmented } from '../../components/ui';
import type { CandidateAssessment } from '../../lib/assessmentApi';
import type { EvaluationSummary } from '../../lib/evaluationApi';
import { HIGH_MATCH_PERCENT } from './evaluation';
import type { CandidateApplication, EmployerJob } from './model';
import {
  applicantExportRows,
  downloadApplicantsCsv,
  downloadApplicantsPdf,
  insightSummary,
  jobMatchInsights,
  type JobMatchInsight,
} from './reports';

const COLLAPSED_COUNT = 4;

/** Jobs ranked by how many applicants match most of their required skills. */
export function MatchInsightsCard({ insights, selectedJobId, onSelectJob }: {
  insights: JobMatchInsight[];
  selectedJobId: string;
  onSelectJob: (jobId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (insights.length === 0) return null;
  const shown = expanded ? insights : insights.slice(0, COLLAPSED_COUNT);
  const top = insights[0];
  return (
    <section className="k-card mb-4" aria-labelledby="match-insights-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="match-insights-title" className="k-section-title flex items-center gap-2">
          <FontAwesomeIcon icon={faChartColumn} aria-hidden="true" />Match insights
          <InfoTip label="How match insights work" align="left">
            Profile match is the share of a job's required skills found in each application. Jobs are ranked by applicants at {HIGH_MATCH_PERCENT}% or more, then by average match. Withdrawn applications are left out.
          </InfoTip>
        </h2>
      </div>
      {top.highMatches > 0 && (
        <p className="k-secondary mt-1">
          <strong>{top.job.title}</strong> draws your strongest matches: {top.highMatches} applicant{top.highMatches === 1 ? '' : 's'} at {HIGH_MATCH_PERCENT}% or more.
        </p>
      )}
      <ul className="mt-3 grid gap-3">
        {shown.map((insight) => {
          const share = insight.highMatchShare ?? 0;
          const selected = insight.job.id === selectedJobId;
          return (
            <li key={insight.job.id}>
              <button
                className={`w-full rounded-md p-2 text-left hover:bg-tan-l ${selected ? 'bg-tan-l' : ''}`}
                type="button"
                aria-current={selected ? 'true' : undefined}
                onClick={() => onSelectJob(insight.job.id)}
              >
                <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="k-label truncate">{insight.job.title}</span>
                  <span className="k-meta">{insight.highMatches} strong · avg {insight.averageMatch === null ? 'n/a' : `${insight.averageMatch}%`}</span>
                </span>
                <span
                  className="k-meter mt-1.5"
                  role="meter"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={share}
                  aria-label={`${insight.job.title}: ${share}% of applicants with a match figure are at ${HIGH_MATCH_PERCENT}% or more`}
                >
                  <span style={{ width: `${share}%` }} />
                </span>
                <span className="k-meta mt-1 block">{insightSummary(insight)}</span>
                {insight.commonGaps.length > 0 && (
                  <span className="k-meta block truncate">Most often missing: {insight.commonGaps.map((gap) => `${gap.skill} (${gap.count})`).join(', ')}</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {insights.length > COLLAPSED_COUNT && (
        <button className="k-btn k-btn-ghost k-btn-sm mt-2" type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
          {expanded ? 'Show fewer' : `Show all ${insights.length} jobs`}
        </button>
      )}
    </section>
  );
}

type ExportScope = 'shown' | 'all';

export function ExportApplicantsDialog({ job, shown, applications, jobs, summaries, assessments, onClose, onError }: {
  job: EmployerJob | null;
  /** The applicants currently listed, after search and filters. */
  shown: CandidateApplication[];
  applications: CandidateApplication[];
  jobs: EmployerJob[];
  summaries: Map<string, EvaluationSummary>;
  assessments: Map<string, CandidateAssessment>;
  onClose: () => void;
  onError?: (message: string) => void;
}) {
  const [scope, setScope] = useState<ExportScope>(shown.length > 0 ? 'shown' : 'all');
  const [busy, setBusy] = useState(false);
  const targets = scope === 'shown' ? shown : applications;
  const scopeJobs = useMemo(() => (scope === 'shown' ? jobs.filter((item) => item.id === job?.id) : jobs), [scope, jobs, job]);
  const scopeLabel = scope === 'shown' ? job?.title || 'Shown applicants' : 'All jobs';

  const exportAs = async (format: 'csv' | 'pdf') => {
    const generatedAt = new Date();
    const rows = applicantExportRows(targets, jobs, summaries, assessments);
    if (format === 'csv') {
      downloadApplicantsCsv(rows, scopeLabel, generatedAt);
      onClose();
      return;
    }
    setBusy(true);
    try {
      await downloadApplicantsPdf({
        title: 'Applicant report',
        scopeLabel,
        generatedAt,
        insights: jobMatchInsights(targets, scopeJobs),
        rows,
      });
      onClose();
    } catch {
      onError?.("The PDF couldn't be created. Try again, or download the CSV instead.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Download applicants"
      onClose={onClose}
      footer={(
        <>
          <button className="k-btn k-btn-secondary" type="button" disabled={busy || targets.length === 0} onClick={() => void exportAs('csv')}>
            <FontAwesomeIcon icon={faFileCsv} aria-hidden="true" />CSV
          </button>
          <button className="k-btn k-btn-primary" type="button" disabled={busy || targets.length === 0} onClick={() => void exportAs('pdf')} data-autofocus>
            <FontAwesomeIcon icon={faFilePdf} aria-hidden="true" />{busy ? 'Preparing PDF…' : 'PDF'}
          </button>
        </>
      )}
    >
      <Segmented<ExportScope>
        label="Applicants to include"
        value={scope}
        onChange={setScope}
        options={[
          { value: 'shown', label: 'This job', count: shown.length },
          { value: 'all', label: 'All jobs', count: applications.length },
        ]}
      />
      <p className="k-secondary mt-3">
        {scope === 'shown'
          ? `Includes the ${job?.title || ''} applicants listed now, with your current search, stage and match filters.`
          : 'Includes every applicant across all your jobs.'}
        {' '}CSV opens in Excel or Google Sheets; the PDF adds match insights per job.
      </p>
      <p className="k-meta mt-2">
        Names and locations are included only for applicants at Interviewing or later, as on screen. Keep downloaded files private and delete them when no longer needed.
      </p>
    </Modal>
  );
}

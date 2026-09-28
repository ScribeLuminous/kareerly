import { useMemo, useState } from 'react';
import { faFileCsv, faFilePdf } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Modal, Segmented } from '../../components/ui';
import type { CandidateAssessment } from '../../lib/assessmentApi';
import type { EvaluationSummary } from '../../lib/evaluationApi';
import type { CandidateApplication, EmployerJob } from './model';
import {
  applicantExportRows,
  downloadApplicantsCsv,
  downloadApplicantsPdf,
  jobMatchInsights,
} from './reports';

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

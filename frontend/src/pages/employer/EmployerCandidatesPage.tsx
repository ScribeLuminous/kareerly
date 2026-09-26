import { useMemo, useState } from 'react';
import { faUsers } from '@fortawesome/free-solid-svg-icons';
import { EmptyState, InfoTip, PageHeader, SearchField, SectionHead, Segmented, SkeletonRows } from '../../components/ui';
import { ApplicantRow } from './ApplicantRow';
import {
  ACTIVE_CANDIDATE_STATUSES,
  candidateDisplayName,
  candidateStatusBadgeClass,
  formatDateLabel,
  getMatchBucket,
  MATCH_BAND_LABEL,
  matchBandBadgeClass,
  type CandidateApplication,
  type CandidateStatus,
  type EmployerJob,
  type MatchBucket,
} from './model';

type CandidatesView = 'match' | 'all';

type EmployerCandidatesPageProps = {
  applications: CandidateApplication[];
  jobs: EmployerJob[];
  isLoading: boolean;
  loadFailed: boolean;
  jobFilter: string;
  onJobFilter: (jobId: string) => void;
  onReview: (candidateId: string) => void;
  onOpenJobs: () => void;
};

const STATUSES: CandidateStatus[] = ['Pending', 'Shortlisted', 'Interviewing', 'Hired', 'Rejected', 'Withdrawn'];
const BANDS: MatchBucket[] = ['top', 'good', 'partial', 'unknown'];
const BAND_HEADING: Record<MatchBucket, string> = { top: 'Top matches', good: 'Good matches', partial: 'Partial matches', unknown: 'No score yet' };

export function EmployerCandidatesPage({ applications, jobs, isLoading, loadFailed, jobFilter, onJobFilter, onReview, onOpenJobs }: EmployerCandidatesPageProps) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | CandidateStatus>('all');
  const [view, setView] = useState<CandidatesView>('match');

  const forJob = useMemo(() => (jobFilter ? applications.filter((candidate) => candidate.jobId === jobFilter) : applications), [applications, jobFilter]);
  const counts = useMemo(() => {
    const result = new Map<CandidateStatus, number>();
    forJob.forEach((candidate) => result.set(candidate.status, (result.get(candidate.status) || 0) + 1));
    return result;
  }, [forJob]);
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return forJob.filter((candidate) => {
      if (status !== 'all' && candidate.status !== status) return false;
      if (!query) return true;
      const corpus = [
        candidate.publicId,
        candidateDisplayName(candidate),
        candidate.role,
        candidate.status,
        MATCH_BAND_LABEL[getMatchBucket(candidate.matchPercent, candidate.hasMatchScore)],
        ...candidate.matchedSkills,
        ...candidate.missingSkills,
      ].join(' ').toLowerCase();
      return corpus.includes(query);
    });
  }, [forJob, search, status]);

  const active = visible.filter((candidate) => ACTIVE_CANDIDATE_STATUSES.includes(candidate.status));
  const hired = visible.filter((candidate) => candidate.status === 'Hired');
  const closed = visible.filter((candidate) => candidate.status === 'Rejected' || candidate.status === 'Withdrawn');
  const byBand = BANDS.map((band) => ({
    band,
    rows: active.filter((candidate) => getMatchBucket(candidate.matchPercent, candidate.hasMatchScore) === band),
  })).filter((group) => group.rows.length > 0);
  // Job titles in the filter come from every job that has applicants, plus open ones.
  const jobOptions = jobs.filter((job) => job.status !== 'closed' || applications.some((candidate) => candidate.jobId === job.id));
  const isFiltered = Boolean(search.trim()) || status !== 'all' || Boolean(jobFilter);
  const reset = () => { setSearch(''); setStatus('all'); onJobFilter(''); };

  return (
    <div className="k-page">
      <PageHeader title="Candidates">
        <p className="k-secondary mt-1 flex items-center gap-1">
          Applicants to your jobs only.
          <InfoTip label="How applicant privacy works" align="left">
            Identity stays masked while an applicant is Pending or Shortlisted and is shown from Interviewing on. Withdrawn applications are read-only. You can't search or browse candidates who haven't applied to you.
          </InfoTip>
        </p>
      </PageHeader>

      {isLoading ? (
        <SkeletonRows count={4} label="Loading applicants" />
      ) : applications.length === 0 ? (
        <EmptyState
          icon={faUsers}
          title={loadFailed ? "Applicants couldn't load" : 'No applicants yet'}
          text={loadFailed ? 'Check your connection. The list refreshes on its own.' : 'Applicants appear here once candidates apply to your open jobs.'}
          actions={loadFailed ? undefined : <button className="k-btn k-btn-secondary" type="button" onClick={onOpenJobs}>View jobs</button>}
        />
      ) : (
        <>
          <div className="k-toolbar">
            <SearchField value={search} onChange={setSearch} label="Search applicants" placeholder="Search ID, role or skill" />
            <div className="k-toolbar-controls">
              <label className="k-sort">
                <span className="sr-only">Filter by job</span>
                <select className="k-select" value={jobFilter} onChange={(event) => onJobFilter(event.target.value)}>
                  <option value="">All jobs</option>
                  {jobOptions.map((job) => <option key={job.id} value={job.id}>{job.title}</option>)}
                </select>
              </label>
            </div>
          </div>

          <div className="k-chip-scroller mb-4" role="group" aria-label="Filter by status">
            <button className="k-chip" type="button" aria-pressed={status === 'all'} onClick={() => setStatus('all')}>
              All <span className="k-chip-count">{forJob.length}</span>
            </button>
            {STATUSES.filter((value) => counts.get(value) || status === value).map((value) => (
              <button key={value} className="k-chip" type="button" aria-pressed={status === value} onClick={() => setStatus(value)}>
                {value} <span className="k-chip-count">{counts.get(value) || 0}</span>
              </button>
            ))}
          </div>

          <Segmented<CandidatesView>
            label="Group applicants"
            value={view}
            onChange={setView}
            options={[
              { value: 'match', label: 'By match' },
              { value: 'all', label: 'All', count: visible.length },
            ]}
          />

          <div className="mt-4">
            {visible.length === 0 ? (
              <EmptyState
                title="No applicants match"
                text={isFiltered ? 'Try another search, status or job.' : undefined}
                actions={isFiltered ? <button className="k-btn k-btn-secondary" type="button" onClick={reset}>Reset</button> : undefined}
              />
            ) : view === 'match' ? (
              <div className="space-y-7">
                {byBand.map(({ band, rows }) => (
                  <section key={band} aria-labelledby={`band-${band}`}>
                    <SectionHead id={`band-${band}`} title={BAND_HEADING[band]} count={rows.length} />
                    <ul className="k-list">
                      {rows.map((candidate) => <li key={candidate.id}><ApplicantRow candidate={candidate} onReview={onReview} showRole={!jobFilter} /></li>)}
                    </ul>
                  </section>
                ))}
                {byBand.length === 0 && <p className="k-secondary">No active applicants in this view.</p>}
                {[{ id: 'hired', title: 'Hired', rows: hired }, { id: 'closed', title: 'Rejected and withdrawn', rows: closed }]
                  .filter((group) => group.rows.length > 0)
                  .map((group) => (
                    <details key={group.id} className="k-detail-section border-t border-bdr pt-4">
                      <summary>{group.title} <span className="k-meta ml-1">{group.rows.length}</span></summary>
                      <ul className="k-list mt-3">
                        {group.rows.map((candidate) => <li key={candidate.id}><ApplicantRow candidate={candidate} onReview={onReview} showRole={!jobFilter} /></li>)}
                      </ul>
                    </details>
                  ))}
              </div>
            ) : (
              <>
                <ul className="k-list md:hidden">
                  {visible.map((candidate) => <li key={candidate.id}><ApplicantRow candidate={candidate} onReview={onReview} showRole={!jobFilter} /></li>)}
                </ul>
                <div className="k-list hidden md:block">
                  <table className="w-full text-left">
                    <caption className="sr-only">Applicants</caption>
                    <thead className="bg-bg">
                      <tr className="k-meta">
                        <th scope="col" className="rounded-tl-[11px] px-4 py-3 font-semibold">Applicant</th>
                        <th scope="col" className="px-4 py-3 font-semibold">Job</th>
                        <th scope="col" className="px-4 py-3 font-semibold">Match</th>
                        <th scope="col" className="px-4 py-3 font-semibold">Applied</th>
                        <th scope="col" className="rounded-tr-[11px] px-4 py-3 font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-bdr border-t border-bdr">
                      {visible.map((candidate) => {
                        const bucket = getMatchBucket(candidate.matchPercent, candidate.hasMatchScore);
                        return (
                          <tr key={candidate.id} className={candidate.status === 'Withdrawn' ? 'opacity-70' : undefined}>
                            <td className="px-4 py-3">
                              <button className="min-h-[32px] text-left" type="button" onClick={() => onReview(candidate.id)}>
                                <span className="k-label block hover:underline">{candidateDisplayName(candidate)}</span>
                                {candidate.publicId && <span className="k-meta block">{candidate.publicId}</span>}
                              </button>
                            </td>
                            <td className="k-secondary px-4 py-3">{candidate.role}</td>
                            <td className="px-4 py-3">
                              <span className="flex flex-wrap items-center gap-1.5">
                                {candidate.hasMatchScore && <span className="k-num k-label">{candidate.matchPercent}%</span>}
                                <span className={matchBandBadgeClass(bucket)}>{MATCH_BAND_LABEL[bucket]}</span>
                              </span>
                            </td>
                            <td className="k-secondary whitespace-nowrap px-4 py-3">{formatDateLabel(candidate.appliedDate)}</td>
                            <td className="px-4 py-3"><span className={candidateStatusBadgeClass(candidate.status)}>{candidate.status}</span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

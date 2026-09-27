import { useEffect, useMemo, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faComments, faEllipsisVertical, faEye, faLayerGroup, faRotateLeft } from '@fortawesome/free-solid-svg-icons';
import { EmptyState, Menu, SearchField, SkeletonRows, Tabs, type MenuItem } from '../../components/ui';
import { PageHeader, StatusBadge } from './common';
import { formatDateLabel, knownValue, MESSAGING_STATUSES, WITHDRAWABLE_STATUSES, type ApplicationStatus, type DashboardApplication } from './model';
import { scoreLabel } from '../../lib/uiData';
import { loadAssessments, type CandidateAssessment } from '../../lib/assessmentApi';
import { CandidateAssessmentModal } from './CandidateAssessmentModal';

export type ApplicationsTab = 'applications' | 'messages';

export function ApplicationsHeader({ tab, onTab, messageCount }: { tab: ApplicationsTab; onTab: (tab: ApplicationsTab) => void; messageCount: number }) {
  return (
    <>
      <PageHeader title="Applications" />
      <Tabs<ApplicationsTab>
        label="Applications views"
        idPrefix="applications"
        value={tab}
        onChange={onTab}
        items={[
          { id: 'applications', label: 'Applications' },
          { id: 'messages', label: 'Messages', count: messageCount || undefined, alert: messageCount > 0 },
        ]}
      />
    </>
  );
}

const STATUS_ORDER: ApplicationStatus[] = ['Pending', 'Shortlisted', 'Interviewing', 'Hired', 'Rejected', 'Withdrawn'];

type ApplicationsPageProps = {
  loadStatus: 'loading' | 'ready' | 'error';
  applications: DashboardApplication[];
  onViewJob: (application: DashboardApplication) => void;
  onWithdraw: (application: DashboardApplication) => void;
  onOpenMessages: () => void;
  onOpenMatches: () => void;
  onTab: (tab: ApplicationsTab) => void;
  messageCount: number;
};

export function ApplicationsPage({ loadStatus, applications, onViewJob, onWithdraw, onOpenMessages, onOpenMatches, onTab, messageCount }: ApplicationsPageProps) {
  const [search, setSearch] = useState('');
  const [assessments, setAssessments] = useState<Map<string, CandidateAssessment>>(new Map());
  const [assessmentOpen, setAssessmentOpen] = useState<string | null>(null);
  const [assessmentVersion, setAssessmentVersion] = useState(0);
  useEffect(() => {
    let mounted = true;
    const refresh = () => void loadAssessments(applications.map((item) => item.id)).then((rows) => { if (mounted) setAssessments(rows); }).catch(() => { if (mounted) setAssessments(new Map()); });
    refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => { mounted = false; window.clearInterval(timer); };
  }, [applications, assessmentVersion]);
  const [status, setStatus] = useState<ApplicationStatus | 'all'>('all');
  const statusCounts = useMemo(() => STATUS_ORDER
    .map((value) => ({ value, count: applications.filter((application) => application.status === value).length }))
    .filter((item) => item.count > 0), [applications]);
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return applications.filter((application) => {
      if (status !== 'all' && application.status !== status) return false;
      if (!query) return true;
      return `${application.jobTitle} ${application.company} ${application.status}`.toLowerCase().includes(query);
    });
  }, [applications, search, status]);

  const menuItems = (application: DashboardApplication): MenuItem[] => {
    const canWithdraw = WITHDRAWABLE_STATUSES.includes(application.status);
    const items: MenuItem[] = [{ label: 'View job', icon: faEye, onSelect: () => onViewJob(application) }];
    if (MESSAGING_STATUSES.includes(application.status)) items.push({ label: 'Messages', icon: faComments, onSelect: onOpenMessages });
    items.push({
      label: 'Withdraw',
      icon: faRotateLeft,
      danger: true,
      disabled: !canWithdraw,
      hint: canWithdraw ? undefined : `${application.status} applications can't be withdrawn.`,
      onSelect: () => onWithdraw(application),
    });
    return items;
  };

  return (
    <div className="k-page">
      <ApplicationsHeader tab="applications" onTab={onTab} messageCount={messageCount} />
      <div id="applications-panel" role="tabpanel" aria-labelledby="applications-tab-applications">
        {loadStatus === 'loading' ? (
          <SkeletonRows count={3} label="Loading applications" />
        ) : loadStatus === 'error' ? (
          <EmptyState title="Applications couldn't load" text="Check your connection and refresh the page." />
        ) : applications.length === 0 ? (
          <EmptyState
            icon={faLayerGroup}
            title="No applications yet"
            text="Apply to a Kareerly job and track it here."
            actions={<button className="k-btn k-btn-primary" type="button" onClick={onOpenMatches}>Browse matches</button>}
          />
        ) : (
          <>
            <div className="k-toolbar">
              <SearchField value={search} onChange={setSearch} label="Search applications" placeholder="Search job or company" />
            </div>
            {statusCounts.length > 1 && (
              <div className="k-chip-scroller mb-4" role="group" aria-label="Filter by status">
                <button className="k-chip" type="button" aria-pressed={status === 'all'} onClick={() => setStatus('all')}>
                  All <span className="k-chip-count">{applications.length}</span>
                </button>
                {statusCounts.map((item) => (
                  <button key={item.value} className="k-chip" type="button" aria-pressed={status === item.value} onClick={() => setStatus(item.value)}>
                    {item.value} <span className="k-chip-count">{item.count}</span>
                  </button>
                ))}
              </div>
            )}

            {filtered.length === 0 ? (
              <EmptyState title="No applications match" actions={<button className="k-btn k-btn-secondary" type="button" onClick={() => { setSearch(''); setStatus('all'); }}>Reset</button>} />
            ) : (
              <>
                {/* Phones and tablets: rows. */}
                <ul className="k-list md:hidden">
                  {filtered.map((application) => (
                    <li key={application.id} className={`k-row pr-1 ${application.status === 'Withdrawn' ? 'opacity-70' : ''}`}>
                      <button className="k-row-main min-h-[44px] text-left" type="button" onClick={() => onViewJob(application)}>
                        <span className="k-label block">{application.jobTitle}</span>
                        <span className="k-meta k-dot-sep mt-0.5 block">
                          {knownValue(application.company) && <span>{application.company}</span>}
                          <span>Applied {formatDateLabel(application.dateApplied)}</span>
                        </span>
                        <span className="mt-1.5 block"><StatusBadge status={application.status} /></span>
                        {assessments.has(application.id) && <span className="k-meta mt-1 block">Candidate Assessment: {assessments.get(application.id)?.status === 'pending' ? 'Action required' : 'Submitted'}</span>}
                      </button>
                      {assessments.has(application.id) && <button className="k-btn k-btn-secondary k-btn-sm" type="button" onClick={() => setAssessmentOpen(application.id)}>{assessments.get(application.id)?.status === 'pending' ? 'Start Assessment' : 'View Assessment'}</button>}
                      <Menu label={`Actions for ${application.jobTitle}`} trigger={<FontAwesomeIcon icon={faEllipsisVertical} aria-hidden="true" />} items={menuItems(application)} />
                    </li>
                  ))}
                </ul>
                {/* Tablet and up: a table. */}
                <div className="k-list hidden md:block">
                  <table className="w-full text-left">
                    <caption className="sr-only">Your applications</caption>
                    <thead className="bg-bg">
                      <tr className="k-meta">
                        <th scope="col" className="rounded-tl-[11px] px-4 py-3 font-semibold">Job</th>
                        <th scope="col" className="px-4 py-3 font-semibold">Match</th>
                        <th scope="col" className="px-4 py-3 font-semibold">Applied</th>
                        <th scope="col" className="px-4 py-3 font-semibold">Status</th>
                        <th scope="col" className="w-12 rounded-tr-[11px] px-2 py-3"><span className="sr-only">Actions</span></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-bdr border-t border-bdr">
                      {filtered.map((application) => (
                        <tr key={application.id} className={application.status === 'Withdrawn' ? 'opacity-70' : undefined}>
                          <td className="px-4 py-3">
                            <button className="min-h-[32px] text-left" type="button" onClick={() => onViewJob(application)}>
                              <span className="k-label block hover:underline">{application.jobTitle}</span>
                            </button>
                            {knownValue(application.company) && <span className="k-meta block">{application.company}</span>}
                            {assessments.has(application.id) && <button className="k-btn k-btn-secondary k-btn-sm mt-2" type="button" onClick={() => setAssessmentOpen(application.id)}>{assessments.get(application.id)?.status === 'pending' ? 'Start Assessment' : 'View Assessment'}</button>}
                          </td>
                          <td className="k-secondary k-num px-4 py-3">{scoreLabel(application.matchScore)}</td>
                          <td className="k-secondary whitespace-nowrap px-4 py-3">{formatDateLabel(application.dateApplied)}</td>
                          <td className="px-4 py-3"><StatusBadge status={application.status} /></td>
                          <td className="px-2 py-1 text-right">
                            <Menu label={`Actions for ${application.jobTitle}`} trigger={<FontAwesomeIcon icon={faEllipsisVertical} aria-hidden="true" />} items={menuItems(application)} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            <p className="k-meta mt-4">Only applications made on Kareerly appear here.</p>
            {assessmentOpen && assessments.get(assessmentOpen) && <CandidateAssessmentModal key={assessmentOpen} assessment={assessments.get(assessmentOpen)!} jobTitle={applications.find((item) => item.id === assessmentOpen)?.jobTitle || 'Application'} onClose={() => setAssessmentOpen(null)} onSaved={() => setAssessmentVersion((value) => value + 1)} />}
          </>
        )}
      </div>
    </div>
  );
}

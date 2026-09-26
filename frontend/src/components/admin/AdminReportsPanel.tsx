import { useCallback, useEffect, useState } from 'react';
import { fetchAdminReports, reviewAdminReport, suspendAdminUser } from '../../lib/api';
import type { AdminPerson, AdminReport, ReportStatus } from '../../lib/api';
import { buttonClass, chipClass, dangerButtonClass, dateText } from './adminShared';
import { PanelMessage, Pill } from './adminUi';
import type { AdminPanelProps } from './adminShared';

const filters: Array<{ id: ReportStatus | 'all'; label: string }> = [
  { id: 'open', label: 'Open' },
  { id: 'resolved', label: 'Resolved' },
  { id: 'dismissed', label: 'Dismissed' },
  { id: 'all', label: 'All' },
];

const reasonLabels: Record<string, string> = {
  spam: 'Spam', harassment: 'Harassment', scam: 'Scam or fraud', inappropriate: 'Inappropriate content',
  impersonation: 'Impersonation', other: 'Other',
};

function PersonCell({ person, role }: { person: AdminPerson | null; role: string }) {
  if (!person) return <span className="text-soft">Unknown {role}</span>;
  return (
    <div>
      <div className="font-bold text-dark">{person.company_name || person.name}</div>
      <div className="text-xs text-soft">{person.email} · <span className="capitalize">{person.role}</span></div>
    </div>
  );
}

export default function AdminReportsPanel({ getToken, notify }: AdminPanelProps) {
  const [status, setStatus] = useState<ReportStatus | 'all'>('open');
  const [data, setData] = useState<{ reports: AdminReport[]; counts: Record<ReportStatus, number> } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchAdminReports(await getToken(), status));
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Unable to load reports.', 'error');
    } finally {
      setLoading(false);
    }
  }, [getToken, notify, status]);

  useEffect(() => {
    // Loading data from the server; the state updates happen after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const review = async (report: AdminReport, next: ReportStatus) => {
    const note = next === 'open' ? '' : window.prompt(next === 'resolved' ? 'Resolution note (optional)' : 'Reason for dismissing (optional)', report.admin_note || '');
    if (note === null) return;
    setBusyId(report.id);
    try {
      await reviewAdminReport(await getToken(), report.id, { status: next, note: note || undefined });
      notify(next === 'open' ? 'Report reopened.' : `Report ${next}.`, 'success');
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Unable to update the report.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const suspendReported = async (report: AdminReport) => {
    const person = report.reported;
    if (!person || !window.confirm(`Suspend ${person.email}? They will be unable to log in until reactivated from the Users tab.`)) return;
    setBusyId(report.id);
    try {
      const token = await getToken();
      await suspendAdminUser(token, person.id, true);
      await reviewAdminReport(token, report.id, { status: 'resolved', note: report.admin_note || 'Reported account suspended.' });
      notify('Reported account suspended and report resolved.', 'success');
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Unable to suspend the account.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const reports = data?.reports || [];
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-bdr px-4 py-3">
        <div className="flex flex-wrap gap-2" aria-label="Report status filter">
          {filters.map((filter) => (
            <button key={filter.id} className={chipClass(status === filter.id)} type="button" onClick={() => setStatus(filter.id)}>
              {filter.label}{filter.id !== 'all' && data ? ` (${data.counts[filter.id]})` : ''}
            </button>
          ))}
        </div>
        <p className="text-xs text-soft">Reports filed by candidates and employers from message threads.</p>
      </div>
      {loading && !data ? <PanelMessage>Loading reports...</PanelMessage> : reports.length === 0 ? <PanelMessage>No {status === 'all' ? '' : status} reports.</PanelMessage> : (
        <div className="overflow-x-auto border-t border-bdr">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-bg text-xs uppercase text-soft">
              <tr>
                <th className="px-4 py-3 font-extrabold">Reason</th>
                <th className="px-4 py-3 font-extrabold">Reported by</th>
                <th className="px-4 py-3 font-extrabold">Reported account</th>
                <th className="px-4 py-3 font-extrabold">Application</th>
                <th className="px-4 py-3 font-extrabold">Status</th>
                <th className="px-4 py-3 font-extrabold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-bdr">
              {reports.map((report) => (
                <tr key={report.id} className="bg-card align-top">
                  <td className="max-w-[300px] px-4 py-3">
                    <div className="font-bold text-dark">{reasonLabels[report.reason || ''] || report.reason || 'No reason'}</div>
                    {report.details && <p className="mt-1 whitespace-pre-wrap break-words text-xs text-mid">{report.details}</p>}
                    <div className="mt-1 text-xs text-soft">{dateText(report.created_at)}</div>
                  </td>
                  <td className="px-4 py-3"><PersonCell person={report.reporter} role={report.actor_role} /></td>
                  <td className="px-4 py-3"><PersonCell person={report.reported} role={report.actor_role === 'candidate' ? 'employer' : 'candidate'} /></td>
                  <td className="px-4 py-3 text-mid">
                    <div>{report.application.job_title || '-'}</div>
                    <div className="text-xs text-soft">{report.application.company_name}</div>
                  </td>
                  <td className="px-4 py-3">
                    <Pill tone={report.review_status === 'open' ? 'warn' : report.review_status === 'resolved' ? 'good' : 'neutral'}>
                      <span className="capitalize">{report.review_status}</span>
                    </Pill>
                    {report.admin_note && <p className="mt-1 max-w-[200px] text-xs text-soft">{report.admin_note}</p>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {report.review_status === 'open' ? (
                        <>
                          <button className={buttonClass} type="button" disabled={busyId === report.id} onClick={() => void review(report, 'resolved')}>Resolve</button>
                          <button className={buttonClass} type="button" disabled={busyId === report.id} onClick={() => void review(report, 'dismissed')}>Dismiss</button>
                          {report.reported && report.reported.role !== 'admin' && (
                            <button className={dangerButtonClass} type="button" disabled={busyId === report.id} onClick={() => void suspendReported(report)}>Suspend account</button>
                          )}
                        </>
                      ) : (
                        <button className={buttonClass} type="button" disabled={busyId === report.id} onClick={() => void review(report, 'open')}>Reopen</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

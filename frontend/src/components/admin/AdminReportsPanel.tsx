import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchAdminReports, reviewAdminReport, suspendAdminUser } from '../../lib/api';
import type { AdminPerson, AdminReport, ReportStatus } from '../../lib/api';
import { bulkButtonClass, bulkDangerButtonClass, buttonClass, dangerButtonClass, dateText, matchesSearch, reportBulk, runBulk, selectCellClass } from './adminShared';
import { AdminSearch, AdminToolbar, BulkBar, FilterSelect, FilterTabs, PanelMessage, Pill, SelectBox } from './adminUi';
import { useRowSelection } from './adminHooks';
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
  if (!person) return <span className="text-soft-text">Unknown {role}</span>;
  return (
    <div>
      <div className="font-bold text-dark">{person.company_name || person.name}</div>
      <div className="text-xs text-soft-text">{person.email} · <span className="capitalize">{person.role}</span></div>
    </div>
  );
}

export default function AdminReportsPanel({ getToken, notify }: AdminPanelProps) {
  const [status, setStatus] = useState<ReportStatus | 'all'>('open');
  const [data, setData] = useState<{ reports: AdminReport[]; counts: Record<ReportStatus, number> } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [reason, setReason] = useState('all');

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

  const reports = useMemo(() => (data?.reports || []).filter((report) => (
    (reason === 'all' || report.reason === reason) && matchesSearch(
      query, report.reason && reasonLabels[report.reason], report.details, report.admin_note,
      report.reporter?.name, report.reporter?.email, report.reporter?.company_name,
      report.reported?.name, report.reported?.email, report.reported?.company_name,
      report.application.job_title, report.application.company_name,
    )
  )), [data, query, reason]);
  const reportIds = useMemo(() => reports.map((report) => report.id), [reports]);
  const selection = useRowSelection(reportIds);

  const bulkReview = async (next: ReportStatus) => {
    const chosen = reports.filter((report) => selection.selected.includes(report.id) && report.review_status !== next);
    if (chosen.length === 0) {
      notify(`The selected reports are already ${next}.`, 'error');
      return;
    }
    const note = next === 'open' ? '' : window.prompt(`${next === 'resolved' ? 'Resolution note' : 'Reason for dismissing'} for ${chosen.length} ${chosen.length === 1 ? 'report' : 'reports'} (optional)`);
    if (note === null) return;
    setBulkBusy(true);
    try {
      const token = await getToken();
      const verb = next === 'open' ? 'Reopened' : next === 'resolved' ? 'Resolved' : 'Dismissed';
      reportBulk(notify, await runBulk(chosen, (report) => reviewAdminReport(token, report.id, { status: next, note: note || report.admin_note || undefined })), verb);
      selection.clear();
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Unable to update the selected reports.', 'error');
    } finally {
      setBulkBusy(false);
    }
  };

  const bulkSuspend = async () => {
    const chosen = reports.filter((report) => selection.selected.includes(report.id) && report.reported && report.reported.role !== 'admin');
    const accounts = new Set(chosen.map((report) => report.reported!.id));
    if (accounts.size === 0) {
      notify('None of the selected reports name an account that can be suspended.', 'error');
      return;
    }
    if (!window.confirm(`Suspend ${accounts.size} reported ${accounts.size === 1 ? 'account' : 'accounts'} and resolve ${chosen.length} ${chosen.length === 1 ? 'report' : 'reports'}?`)) return;
    setBulkBusy(true);
    try {
      const token = await getToken();
      const suspended = new Set<string>();
      reportBulk(notify, await runBulk(chosen, async (report) => {
        const person = report.reported!;
        if (!suspended.has(person.id)) {
          await suspendAdminUser(token, person.id, true);
          suspended.add(person.id);
        }
        await reviewAdminReport(token, report.id, { status: 'resolved', note: report.admin_note || 'Reported account suspended.' });
      }), 'Suspended and resolved');
      selection.clear();
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Unable to suspend the reported accounts.', 'error');
    } finally {
      setBulkBusy(false);
    }
  };

  const filtered = Boolean(query.trim()) || reason !== 'all';
  return (
    <div>
      <AdminToolbar aside={<AdminSearch value={query} onChange={setQuery} placeholder="Search people, job or details" />}>
        <FilterTabs
          label="Report status"
          items={filters.map((filter) => ({ id: filter.id, label: filter.label, count: filter.id !== 'all' && data ? data.counts[filter.id] : undefined }))}
          value={status}
          onChange={(next) => { setStatus(next); selection.clear(); }}
        />
        <FilterSelect label="Reason" value={reason} options={[{ value: 'all', label: 'Any reason' }, ...Object.entries(reasonLabels).map(([value, label]) => ({ value, label }))]} onChange={setReason} />
      </AdminToolbar>
      <BulkBar count={selection.selected.length} onClear={selection.clear} busy={bulkBusy}>
        <button className={bulkButtonClass} type="button" disabled={bulkBusy} onClick={() => void bulkReview('resolved')}>Resolve</button>
        <button className={bulkButtonClass} type="button" disabled={bulkBusy} onClick={() => void bulkReview('dismissed')}>Dismiss</button>
        <button className={bulkButtonClass} type="button" disabled={bulkBusy} onClick={() => void bulkReview('open')}>Reopen</button>
        <button className={bulkDangerButtonClass} type="button" disabled={bulkBusy} onClick={() => void bulkSuspend()}>Suspend accounts</button>
      </BulkBar>
      {loading && !data ? <PanelMessage>Loading reports...</PanelMessage> : reports.length === 0 ? <PanelMessage>No {filtered ? 'matching ' : status === 'all' ? '' : `${status} `}reports.</PanelMessage> : (
        <div className="overflow-x-auto border-t border-bdr">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-bg text-xs uppercase text-soft-text">
              <tr>
                <th className={selectCellClass}>
                  <SelectBox label="Select all reports" checked={selection.allSelected} indeterminate={selection.someSelected} onChange={selection.toggleAll} />
                </th>
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
                <tr key={report.id} className={`align-top ${selection.isSelected(report.id) ? 'bg-rust-l/50' : 'bg-card'}`}>
                  <td className={selectCellClass}>
                    <SelectBox label={`Select report from ${report.reporter?.email || 'unknown reporter'}`} checked={selection.isSelected(report.id)} onChange={() => selection.toggle(report.id)} />
                  </td>
                  <td className="max-w-[300px] px-4 py-3">
                    <div className="font-bold text-dark">{reasonLabels[report.reason || ''] || report.reason || 'No reason'}</div>
                    {report.details && <p className="mt-1 whitespace-pre-wrap break-words text-xs text-mid">{report.details}</p>}
                    <div className="mt-1 text-xs text-soft-text">{dateText(report.created_at)}</div>
                  </td>
                  <td className="px-4 py-3"><PersonCell person={report.reporter} role={report.actor_role} /></td>
                  <td className="px-4 py-3"><PersonCell person={report.reported} role={report.actor_role === 'candidate' ? 'employer' : 'candidate'} /></td>
                  <td className="px-4 py-3 text-mid">
                    <div>{report.application.job_title || '-'}</div>
                    <div className="text-xs text-soft-text">{report.application.company_name}</div>
                  </td>
                  <td className="px-4 py-3">
                    <Pill tone={report.review_status === 'open' ? 'warn' : report.review_status === 'resolved' ? 'good' : 'neutral'}>
                      <span className="capitalize">{report.review_status}</span>
                    </Pill>
                    {report.admin_note && <p className="mt-1 max-w-[200px] text-xs text-soft-text">{report.admin_note}</p>}
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

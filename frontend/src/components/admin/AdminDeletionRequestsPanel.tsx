import { useCallback, useEffect, useMemo, useState } from 'react';
import { decideAdminDeletionRequest, fetchAdminDeletionRequests } from '../../lib/api';
import type { AccountDeletionRequest, DeletionRequestStatus } from '../../lib/api';
import { bulkButtonClass, bulkDangerButtonClass, buttonClass, dangerButtonClass, dateText, matchesSearch, reportBulk, runBulk, selectCellClass } from './adminShared';
import { AdminSearch, AdminToolbar, BulkBar, FilterSelect, FilterTabs, PanelMessage, Pill, SelectBox } from './adminUi';
import { useRowSelection } from './adminHooks';
import type { AdminPanelProps } from './adminShared';

const filters: Array<{ id: DeletionRequestStatus | 'all'; label: string }> = [
  { id: 'pending', label: 'Pending' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'cancelled', label: 'Cancelled' },
  { id: 'all', label: 'All' },
];

const tone = (status: DeletionRequestStatus) => (status === 'pending' ? 'warn' : status === 'approved' ? 'good' : status === 'rejected' ? 'bad' : 'neutral');

export default function AdminDeletionRequestsPanel({ getToken, notify }: AdminPanelProps) {
  const [status, setStatus] = useState<DeletionRequestStatus | 'all'>('pending');
  const [data, setData] = useState<{ requests: AccountDeletionRequest[]; counts: Record<DeletionRequestStatus, number> } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [role, setRole] = useState('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchAdminDeletionRequests(await getToken(), status));
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Unable to load deletion requests.', 'error');
    } finally {
      setLoading(false);
    }
  }, [getToken, notify, status]);

  useEffect(() => {
    // Loading data from the server; the state updates happen after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const decide = async (request: AccountDeletionRequest, decision: 'approve' | 'reject') => {
    const email = request.user?.email || request.user_email;
    if (decision === 'approve') {
      const typed = window.prompt(`Approve and permanently delete ${email}? Their profile, resumes, applications, messages and job posts will be removed. This cannot be undone.\n\nType DELETE to confirm.`);
      if (typed !== 'DELETE') return;
    }
    const note = decision === 'reject' ? window.prompt('Reason for rejecting (optional)') : '';
    if (note === null) return;
    setBusyId(request.id);
    try {
      await decideAdminDeletionRequest(await getToken(), request.id, decision, note || undefined);
      notify(decision === 'approve' ? 'Account deleted and request approved.' : 'Deletion request rejected.', 'success');
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Unable to update the request.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const requests = useMemo(() => (data?.requests || []).filter((request) => (
    (role === 'all' || request.user_role === role)
    && matchesSearch(query, request.user?.name, request.user_email, request.reason, request.admin_note)
  )), [data, query, role]);
  // Only pending requests can be decided, so only those can be selected.
  const pendingIds = useMemo(() => requests.filter((request) => request.status === 'pending').map((request) => request.id), [requests]);
  const selection = useRowSelection(pendingIds);

  const bulkDecide = async (decision: 'approve' | 'reject') => {
    const chosen = requests.filter((request) => selection.selected.includes(request.id));
    const count = chosen.length;
    const noun = count === 1 ? 'account' : 'accounts';
    if (decision === 'approve') {
      const typed = window.prompt(`Approve and permanently delete ${count} ${noun}? Their profiles, resumes, applications, messages and job posts will be removed. This cannot be undone.\n\nType DELETE to confirm.`);
      if (typed !== 'DELETE') return;
    }
    const note = decision === 'reject' ? window.prompt(`Reason for rejecting ${count} ${count === 1 ? 'request' : 'requests'} (optional)`) : '';
    if (note === null) return;
    setBulkBusy(true);
    try {
      const token = await getToken();
      reportBulk(notify, await runBulk(chosen, (request) => decideAdminDeletionRequest(token, request.id, decision, note || undefined)), decision === 'approve' ? 'Approved and deleted' : 'Rejected');
      selection.clear();
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Unable to update the selected requests.', 'error');
    } finally {
      setBulkBusy(false);
    }
  };

  const filtered = Boolean(query.trim()) || role !== 'all';
  return (
    <div>
      <AdminToolbar aside={<AdminSearch value={query} onChange={setQuery} placeholder="Search name, email or reason" />}>
        <FilterTabs
          label="Deletion request status"
          items={filters.map((filter) => ({ id: filter.id, label: filter.label, count: filter.id !== 'all' && data ? data.counts[filter.id] : undefined }))}
          value={status}
          onChange={(next) => { setStatus(next); selection.clear(); }}
        />
        <FilterSelect label="Account" value={role} options={[{ value: 'all', label: 'Any type' }, { value: 'candidate', label: 'Candidates' }, { value: 'employer', label: 'Employers' }]} onChange={setRole} />
      </AdminToolbar>
      <p className="border-t border-bdr bg-bg px-4 py-2 text-xs text-soft-text">Approving deletes the account immediately.</p>
      <BulkBar count={selection.selected.length} onClear={selection.clear} busy={bulkBusy}>
        <button className={bulkDangerButtonClass} type="button" disabled={bulkBusy} onClick={() => void bulkDecide('approve')}>Approve &amp; delete</button>
        <button className={bulkButtonClass} type="button" disabled={bulkBusy} onClick={() => void bulkDecide('reject')}>Reject</button>
      </BulkBar>
      {loading && !data ? <PanelMessage>Loading deletion requests...</PanelMessage> : requests.length === 0 ? <PanelMessage>No {filtered ? 'matching ' : status === 'all' ? '' : `${status} `}deletion requests.</PanelMessage> : (
        <div className="overflow-x-auto border-t border-bdr">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-bg text-xs uppercase text-soft-text">
              <tr>
                <th className={selectCellClass}>
                  <SelectBox label="Select all pending requests" checked={selection.allSelected} indeterminate={selection.someSelected} disabled={pendingIds.length === 0} onChange={selection.toggleAll} />
                </th>
                <th className="px-4 py-3 font-extrabold">Account</th>
                <th className="px-4 py-3 font-extrabold">Reason</th>
                <th className="px-4 py-3 font-extrabold">Requested</th>
                <th className="px-4 py-3 font-extrabold">Status</th>
                <th className="px-4 py-3 font-extrabold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-bdr">
              {requests.map((request) => (
                <tr key={request.id} className={`align-top ${selection.isSelected(request.id) ? 'bg-rust-l/50' : 'bg-card'}`}>
                  <td className={selectCellClass}>
                    {request.status === 'pending' && <SelectBox label={`Select ${request.user_email}`} checked={selection.isSelected(request.id)} onChange={() => selection.toggle(request.id)} />}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-bold text-dark">{request.user?.name || request.user_email}</div>
                    <div className="text-xs text-soft-text">{request.user_email} · <span className="capitalize">{request.user_role}</span></div>
                  </td>
                  <td className="max-w-[320px] whitespace-pre-wrap break-words px-4 py-3 text-mid">{request.reason || <span className="text-soft-text">No reason given</span>}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-mid">{dateText(request.requested_at)}</td>
                  <td className="px-4 py-3">
                    <Pill tone={tone(request.status)}><span className="capitalize">{request.status}</span></Pill>
                    {request.reviewed_at && <div className="mt-1 text-xs text-soft-text">{dateText(request.reviewed_at)}</div>}
                    {request.admin_note && <p className="mt-1 max-w-[200px] text-xs text-soft-text">{request.admin_note}</p>}
                  </td>
                  <td className="px-4 py-3">
                    {request.status === 'pending' ? (
                      <div className="flex flex-wrap gap-1">
                        <button className={dangerButtonClass} type="button" disabled={busyId === request.id} onClick={() => void decide(request, 'approve')}>Approve &amp; delete</button>
                        <button className={buttonClass} type="button" disabled={busyId === request.id} onClick={() => void decide(request, 'reject')}>Reject</button>
                      </div>
                    ) : <span className="text-xs text-soft-text">-</span>}
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

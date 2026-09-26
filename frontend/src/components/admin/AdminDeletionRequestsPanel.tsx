import { useCallback, useEffect, useState } from 'react';
import { decideAdminDeletionRequest, fetchAdminDeletionRequests } from '../../lib/api';
import type { AccountDeletionRequest, DeletionRequestStatus } from '../../lib/api';
import { buttonClass, chipClass, dangerButtonClass, dateText } from './adminShared';
import { PanelMessage, Pill } from './adminUi';
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

  const requests = data?.requests || [];
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-bdr px-4 py-3">
        <div className="flex flex-wrap gap-2" aria-label="Deletion request filter">
          {filters.map((filter) => (
            <button key={filter.id} className={chipClass(status === filter.id)} type="button" onClick={() => setStatus(filter.id)}>
              {filter.label}{filter.id !== 'all' && data ? ` (${data.counts[filter.id]})` : ''}
            </button>
          ))}
        </div>
        <p className="text-xs text-soft-text">Approving deletes the account immediately.</p>
      </div>
      {loading && !data ? <PanelMessage>Loading deletion requests...</PanelMessage> : requests.length === 0 ? <PanelMessage>No {status === 'all' ? '' : status} deletion requests.</PanelMessage> : (
        <div className="overflow-x-auto border-t border-bdr">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-bg text-xs uppercase text-soft-text">
              <tr>
                <th className="px-4 py-3 font-extrabold">Account</th>
                <th className="px-4 py-3 font-extrabold">Reason</th>
                <th className="px-4 py-3 font-extrabold">Requested</th>
                <th className="px-4 py-3 font-extrabold">Status</th>
                <th className="px-4 py-3 font-extrabold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-bdr">
              {requests.map((request) => (
                <tr key={request.id} className="bg-card align-top">
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

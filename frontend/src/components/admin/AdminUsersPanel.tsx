import { useCallback, useEffect, useMemo, useState } from 'react';
import { deleteAdminUser, fetchAdminUsers, suspendAdminUser, updateAdminUser } from '../../lib/api';
import type { AdminUserRow } from '../../lib/api';
import { bulkButtonClass, bulkDangerButtonClass, buttonClass, dangerButtonClass, dateText, reportBulk, runBulk, selectCellClass } from './adminShared';
import { AdminSearch, AdminToolbar, BulkBar, FilterSelect, FilterTabs, PanelMessage, Pager, Pill, SelectBox } from './adminUi';
import { useDebouncedValue, useRowSelection } from './adminHooks';
import type { AdminPanelProps } from './adminShared';

type Role = 'candidate' | 'employer' | 'admin';
type StatusFilter = 'all' | 'active' | 'suspended' | 'deletion';
const roleLabels: Record<Role, string> = { candidate: 'Candidates', employer: 'Employers', admin: 'Admins' };
const statusOptions: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'Any status' },
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'deletion', label: 'Deletion requested' },
];

function matchesStatus(user: AdminUserRow, status: StatusFilter): boolean {
  if (status === 'active') return !user.suspended;
  if (status === 'suspended') return Boolean(user.suspended);
  if (status === 'deletion') return Boolean(user.deletion_requested);
  return true;
}

export default function AdminUsersPanel({ getToken, notify, onViewResumes }: AdminPanelProps & { onViewResumes: (email: string) => void }) {
  const [role, setRole] = useState<Role>('candidate');
  const [query, setQuery] = useState('');
  const search = useDebouncedValue(query.trim());
  const [status, setStatus] = useState<StatusFilter>('all');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<{ users: AdminUserRow[]; has_more: boolean; limit: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchAdminUsers(await getToken(), { role, q: search, offset }));
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Unable to load users.', 'error');
    } finally {
      setLoading(false);
    }
  }, [getToken, notify, role, search, offset]);

  useEffect(() => {
    // Loading data from the server; the state updates happen after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // A new search term starts again from the first page.
  const [lastSearch, setLastSearch] = useState(search);
  if (lastSearch !== search) {
    setLastSearch(search);
    setOffset(0);
  }

  const users = useMemo(() => (data?.users || []).filter((user) => matchesStatus(user, status)), [data, status]);
  // Administrator accounts cannot be suspended or deleted, so they are never selectable.
  const selectableIds = useMemo(() => users.filter((user) => user.role !== 'admin').map((user) => user.id), [users]);
  const selection = useRowSelection(selectableIds);
  const selectable = role !== 'admin';

  const act = async (userId: string, action: (token: string) => Promise<unknown>, success: string) => {
    setBusyId(userId);
    try {
      await action(await getToken());
      notify(success, 'success');
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Unable to update the user.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const bulk = async (action: (token: string, user: AdminUserRow) => Promise<unknown>, done: string) => {
    const chosen = users.filter((user) => selection.selected.includes(user.id));
    setBulkBusy(true);
    try {
      const token = await getToken();
      reportBulk(notify, await runBulk(chosen, (user) => action(token, user)), done);
      selection.clear();
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Unable to update the selected users.', 'error');
    } finally {
      setBulkBusy(false);
    }
  };

  const bulkSuspend = (suspending: boolean) => {
    const count = selection.selected.length;
    const prompt = suspending
      ? `Suspend ${count} selected ${count === 1 ? 'account' : 'accounts'}? They will be signed out and unable to log in until reactivated.`
      : `Reactivate ${count} selected ${count === 1 ? 'account' : 'accounts'}?`;
    if (window.confirm(prompt)) void bulk((token, user) => suspendAdminUser(token, user.id, suspending), suspending ? 'Suspended' : 'Reactivated');
  };
  const bulkDelete = () => {
    const count = selection.selected.length;
    const typed = window.prompt(`Permanently delete ${count} selected ${count === 1 ? 'account' : 'accounts'} and all of their data (resumes, applications, messages, job posts)? This cannot be undone.\n\nType DELETE to confirm.`);
    if (typed === 'DELETE') void bulk((token, user) => deleteAdminUser(token, user.id), 'Deleted');
  };

  const editEmail = (user: AdminUserRow) => {
    const email = window.prompt('New email address', user.email);
    if (email && email !== user.email) void act(user.id, (token) => updateAdminUser(token, { user_id: user.id, email }), 'Email updated.');
  };
  const resetPassword = (user: AdminUserRow) => {
    const password = window.prompt(`New password for ${user.email} (minimum 8 characters)`);
    if (password) void act(user.id, (token) => updateAdminUser(token, { user_id: user.id, password }), 'Password updated.');
  };
  const toggleSuspend = (user: AdminUserRow) => {
    const suspending = !user.suspended;
    const prompt = suspending
      ? `Suspend ${user.email}? They will be signed out and unable to log in until reactivated.`
      : `Reactivate ${user.email}? They will be able to log in again.`;
    if (window.confirm(prompt)) {
      void act(user.id, (token) => suspendAdminUser(token, user.id, suspending), suspending ? 'Account suspended.' : 'Account reactivated.');
    }
  };
  const remove = (user: AdminUserRow) => {
    const typed = window.prompt(`Permanently delete ${user.email} and all of their data (resumes, applications, messages, job posts)? This cannot be undone.\n\nType DELETE to confirm.`);
    if (typed === 'DELETE') void act(user.id, (token) => deleteAdminUser(token, user.id), 'Account deleted.');
  };

  const filtered = status !== 'all' || Boolean(search);
  return (
    <div>
      <AdminToolbar aside={<AdminSearch value={query} onChange={setQuery} placeholder="Search name or email" />}>
        <FilterTabs label="User role" items={(Object.keys(roleLabels) as Role[]).map((item) => ({ id: item, label: roleLabels[item] }))} value={role} onChange={(item) => { setRole(item); setOffset(0); selection.clear(); }} />
        <FilterSelect label="Status" value={status} options={statusOptions} onChange={setStatus} />
      </AdminToolbar>
      {selectable && (
        <BulkBar count={selection.selected.length} onClear={selection.clear} busy={bulkBusy}>
          <button className={bulkButtonClass} type="button" disabled={bulkBusy} onClick={() => bulkSuspend(true)}>Suspend</button>
          <button className={bulkButtonClass} type="button" disabled={bulkBusy} onClick={() => bulkSuspend(false)}>Reactivate</button>
          <button className={bulkDangerButtonClass} type="button" disabled={bulkBusy} onClick={bulkDelete}>Delete</button>
        </BulkBar>
      )}
      {loading && !data ? <PanelMessage>Loading users...</PanelMessage> : users.length === 0 ? <PanelMessage>No {filtered ? 'matching ' : ''}{roleLabels[role].toLowerCase()} found.</PanelMessage> : (
        <div className="overflow-x-auto border-t border-bdr">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-bg text-xs uppercase text-soft-text">
              <tr>
                {selectable && (
                  <th className={selectCellClass}>
                    <SelectBox label="Select all users on this page" checked={selection.allSelected} indeterminate={selection.someSelected} disabled={selectableIds.length === 0} onChange={selection.toggleAll} />
                  </th>
                )}
                <th className="px-4 py-3 font-extrabold">User</th>
                <th className="px-4 py-3 font-extrabold">{role === 'employer' ? 'Company' : role === 'candidate' ? 'Resumes' : 'Role'}</th>
                <th className="px-4 py-3 font-extrabold">Status</th>
                <th className="px-4 py-3 font-extrabold">Joined</th>
                <th className="px-4 py-3 font-extrabold">Manage</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-bdr">
              {users.map((user) => (
                <tr key={user.id} className={`align-top ${selection.isSelected(user.id) ? 'bg-rust-l/50' : 'bg-card'}`}>
                  {selectable && (
                    <td className={selectCellClass}>
                      {user.role !== 'admin' && <SelectBox label={`Select ${user.email}`} checked={selection.isSelected(user.id)} onChange={() => selection.toggle(user.id)} />}
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <div className="font-bold text-dark">{`${user.first_name} ${user.last_name}`.trim() || '-'}</div>
                    <div className="text-xs text-soft-text">{user.email}</div>
                  </td>
                  <td className="px-4 py-3 text-mid">
                    {role === 'employer' ? user.company_name || '-' : role === 'candidate' ? (
                      user.resume_count ? <button className="font-bold text-rust hover:underline" type="button" onClick={() => onViewResumes(user.email)}>{user.resume_count} on file</button> : 'None'
                    ) : 'Administrator'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {user.suspended ? <Pill tone="bad">Suspended</Pill> : <Pill tone="good">Active</Pill>}
                      {user.deletion_requested && <Pill tone="warn">Deletion requested</Pill>}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-mid">{dateText(user.created_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      <button className={buttonClass} type="button" disabled={busyId === user.id} onClick={() => editEmail(user)}>Email</button>
                      <button className={buttonClass} type="button" disabled={busyId === user.id} onClick={() => resetPassword(user)}>Password</button>
                      {user.role !== 'admin' && (
                        <>
                          <button className={buttonClass} type="button" disabled={busyId === user.id} onClick={() => toggleSuspend(user)}>{user.suspended ? 'Reactivate' : 'Suspend'}</button>
                          <button className={dangerButtonClass} type="button" disabled={busyId === user.id} onClick={() => remove(user)}>Delete</button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && <Pager offset={offset} limit={data.limit} hasMore={data.has_more} onPage={setOffset} />}
    </div>
  );
}

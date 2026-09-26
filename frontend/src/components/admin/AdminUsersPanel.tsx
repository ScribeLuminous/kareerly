import { useCallback, useEffect, useState } from 'react';
import { deleteAdminUser, fetchAdminUsers, suspendAdminUser, updateAdminUser } from '../../lib/api';
import type { AdminUserRow } from '../../lib/api';
import { buttonClass, chipClass, dangerButtonClass, dateText } from './adminShared';
import { PanelMessage, Pager, Pill, SearchBox } from './adminUi';
import type { AdminPanelProps } from './adminShared';

type Role = 'candidate' | 'employer' | 'admin';
const roleLabels: Record<Role, string> = { candidate: 'Candidates', employer: 'Employers', admin: 'Admins' };

export default function AdminUsersPanel({ getToken, notify, onViewResumes }: AdminPanelProps & { onViewResumes: (email: string) => void }) {
  const [role, setRole] = useState<Role>('candidate');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<{ users: AdminUserRow[]; has_more: boolean; limit: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

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

  const users = data?.users || [];
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-bdr px-4 py-3">
        <div className="flex flex-wrap gap-2" aria-label="User role filter">
          {(Object.keys(roleLabels) as Role[]).map((item) => (
            <button key={item} className={chipClass(role === item)} type="button" onClick={() => { setRole(item); setOffset(0); }}>{roleLabels[item]}</button>
          ))}
        </div>
        <SearchBox value={query} onChange={setQuery} onSubmit={() => { setSearch(query.trim()); setOffset(0); }} placeholder="Search name or email" />
      </div>
      {loading && !data ? <PanelMessage>Loading users...</PanelMessage> : users.length === 0 ? <PanelMessage>No {roleLabels[role].toLowerCase()} found.</PanelMessage> : (
        <div className="overflow-x-auto border-t border-bdr">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-bg text-xs uppercase text-soft">
              <tr>
                <th className="px-4 py-3 font-extrabold">User</th>
                <th className="px-4 py-3 font-extrabold">{role === 'employer' ? 'Company' : role === 'candidate' ? 'Resumes' : 'Role'}</th>
                <th className="px-4 py-3 font-extrabold">Status</th>
                <th className="px-4 py-3 font-extrabold">Joined</th>
                <th className="px-4 py-3 font-extrabold">Manage</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-bdr">
              {users.map((user) => (
                <tr key={user.id} className="bg-card align-top">
                  <td className="px-4 py-3">
                    <div className="font-bold text-dark">{`${user.first_name} ${user.last_name}`.trim() || '-'}</div>
                    <div className="text-xs text-soft">{user.email}</div>
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

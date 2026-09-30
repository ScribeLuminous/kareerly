import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { AdminUserRow } from '../../lib/api';
import { buttonClass } from './adminShared';

type Role = AdminUserRow['role'];
export type UserEditChanges = { first_name?: string; last_name?: string; email?: string; role?: Role };

const roleOptions: Array<{ value: Role; label: string }> = [
  { value: 'candidate', label: 'Candidate' },
  { value: 'employer', label: 'Employer' },
  { value: 'admin', label: 'Administrator' },
];
const inputClass = 'w-full rounded-lg border border-bdr bg-card px-3 py-2.5 text-base text-dark focus:border-rust focus:outline-none disabled:bg-bg disabled:text-soft-text sm:text-sm';

/** Modal form for an admin to change a user's name, email and role. */
export default function AdminUserEditDialog({ user, isSelf, busy, onSave, onClose }: {
  user: AdminUserRow;
  isSelf: boolean;
  busy: boolean;
  onSave: (changes: UserEditChanges) => void;
  onClose: () => void;
}) {
  const [firstName, setFirstName] = useState(user.first_name || '');
  const [lastName, setLastName] = useState(user.last_name || '');
  const [email, setEmail] = useState(user.email || '');
  const [role, setRole] = useState<Role>(user.role);
  const [error, setError] = useState('');
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const changes: UserEditChanges = {};
    if (firstName.trim() !== (user.first_name || '')) changes.first_name = firstName.trim();
    if (lastName.trim() !== (user.last_name || '')) changes.last_name = lastName.trim();
    if (email.trim().toLowerCase() !== (user.email || '').toLowerCase()) changes.email = email.trim();
    if (role !== user.role) changes.role = role;
    if (!firstName.trim()) {
      setError('First name is required.');
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      setError('Enter a valid email address.');
      return;
    }
    if (Object.keys(changes).length === 0) {
      onClose();
      return;
    }
    if (changes.role && !window.confirm(`Change ${user.email} from ${user.role} to ${changes.role}? Their access changes the next time they sign in.`)) return;
    onSave(changes);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-dark/50 sm:items-center sm:p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-card p-5 shadow-xl sm:max-w-md sm:rounded-2xl" role="dialog" aria-modal="true" aria-labelledby="admin-user-edit-title" onSubmit={submit} noValidate>
        <h3 id="admin-user-edit-title" className="text-lg font-extrabold text-dark">Manage profile</h3>
        <p className="mb-4 text-xs text-soft-text">Changes apply to the account immediately.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs font-bold text-soft-text">First name
            <input ref={firstRef} className={`${inputClass} mt-1`} value={firstName} onChange={(event) => setFirstName(event.target.value)} autoComplete="off" />
          </label>
          <label className="block text-xs font-bold text-soft-text">Last name
            <input className={`${inputClass} mt-1`} value={lastName} onChange={(event) => setLastName(event.target.value)} autoComplete="off" />
          </label>
        </div>
        <label className="mt-3 block text-xs font-bold text-soft-text">Email
          <input className={`${inputClass} mt-1`} type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="off" />
        </label>
        <label className="mt-3 block text-xs font-bold text-soft-text">Role
          <select className={`${inputClass} mt-1`} value={role} onChange={(event) => setRole(event.target.value as Role)} disabled={isSelf}>
            {roleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          {isSelf && <span className="mt-1 block font-normal">You cannot change your own role.</span>}
        </label>
        {error && <div className="mt-3 rounded-lg border border-red bg-red-l px-3 py-2 text-xs font-semibold text-red" role="alert">{error}</div>}
        <div className="mt-5 flex justify-end gap-2">
          <button className={`${buttonClass} px-4 py-2.5 text-sm`} type="button" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="rounded-lg bg-rust px-4 py-2.5 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
        </div>
      </form>
    </div>
  );
}

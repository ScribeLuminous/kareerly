import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import Logo from '../components/Logo';
import { fetchAdminOverview } from '../lib/api';
import type { AdminOverview } from '../lib/api';
import { supabase } from '../lib/supabase';
import type { KareerlyUser } from '../lib/auth';

type AdminDashboardProps = {
  admin: KareerlyUser | null;
  onHome: () => void;
  onLogout: () => void;
};

type AdminTab = 'users' | 'jobs' | 'applications' | 'messages' | 'evidence';

const tabs: Array<{ id: AdminTab; label: string }> = [
  { id: 'users', label: 'Users' },
  { id: 'jobs', label: 'Job Posts' },
  { id: 'applications', label: 'Applications' },
  { id: 'messages', label: 'Messages' },
  { id: 'evidence', label: 'Evidence' },
];

function valueText(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function dateText(value: unknown): string {
  if (typeof value !== 'string' || !value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 16);
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function truncate(value: unknown, max = 86): string {
  const text = valueText(value);
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function StatusPill({ value }: { value: unknown }) {
  const text = valueText(value);
  const normalized = text.toLowerCase();
  const className = normalized.includes('active') || normalized.includes('accepted') || normalized.includes('hired')
    ? 'border-green bg-green-l text-green'
    : normalized.includes('pending') || normalized.includes('draft') || normalized.includes('interview')
      ? 'border-yellow bg-yellow-l text-yellow'
      : normalized.includes('rejected') || normalized.includes('declined') || normalized.includes('withdrawn')
        ? 'border-red bg-red-l text-red'
        : 'border-bdr bg-bg text-mid';

  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-bold ${className}`}>{text}</span>;
}

function AdminTable({
  rows,
  columns,
  empty,
}: {
  rows: Array<Record<string, unknown>>;
  columns: Array<{ key: string; label: string; render?: (row: Record<string, unknown>) => ReactNode }>;
  empty: string;
}) {
  return (
    <div className="overflow-x-auto border-t border-bdr">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-bg text-xs uppercase text-soft">
          <tr>
            {columns.map((column) => (
              <th key={column.key} className="whitespace-nowrap px-4 py-3 font-extrabold">{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-bdr">
          {rows.length > 0 ? rows.map((row, index) => (
            <tr key={String(row.id || index)} className="bg-card align-top">
              {columns.map((column) => (
                <td key={column.key} className="max-w-[360px] px-4 py-3 text-mid">
                  {column.render ? column.render(row) : truncate(row[column.key])}
                </td>
              ))}
            </tr>
          )) : (
            <tr>
              <td className="px-4 py-8 text-center text-soft" colSpan={columns.length}>{empty}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function AdminDashboard({ admin, onHome, onLogout }: AdminDashboardProps) {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [activeTab, setActiveTab] = useState<AdminTab>('users');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      const token = data.session?.access_token;
      if (!token) throw new Error('Admin session is missing. Please log in again.');
      setOverview(await fetchAdminOverview(token));
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to load admin dashboard.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const metricCards = useMemo(() => {
    if (!overview) return [];
    return [
      ['Users', overview.counts.users],
      ['Candidates', overview.counts.candidate_profiles],
      ['Employers', overview.counts.employer_profiles],
      ['Job Posts', overview.counts.job_posts],
      ['Applications', overview.counts.applications],
      ['Messages', overview.counts.messages],
      ['Evidence', overview.counts.evidence_records],
    ];
  }, [overview]);

  const currentRows = overview?.recent[
    activeTab === 'users' ? 'profiles' : activeTab === 'jobs' ? 'job_posts' : activeTab
  ] || [];

  const columns = useMemo(() => {
    if (activeTab === 'users') {
      return [
        { key: 'email', label: 'Email' },
        { key: 'role', label: 'Role', render: (row: Record<string, unknown>) => <StatusPill value={row.role} /> },
        { key: 'first_name', label: 'First Name' },
        { key: 'last_name', label: 'Last Name' },
        { key: 'created_at', label: 'Created', render: (row: Record<string, unknown>) => dateText(row.created_at) },
      ];
    }
    if (activeTab === 'jobs') {
      return [
        { key: 'job_title', label: 'Title' },
        { key: 'company_name', label: 'Company' },
        { key: 'posting_status', label: 'Status', render: (row: Record<string, unknown>) => <StatusPill value={row.posting_status} /> },
        { key: 'job_id', label: 'Job ID' },
        { key: 'updated_at', label: 'Updated', render: (row: Record<string, unknown>) => dateText(row.updated_at || row.created_at) },
      ];
    }
    if (activeTab === 'applications') {
      return [
        { key: 'job_title', label: 'Role' },
        { key: 'company_name', label: 'Company' },
        { key: 'status', label: 'Status', render: (row: Record<string, unknown>) => <StatusPill value={row.status} /> },
        { key: 'message_request_state', label: 'Message' },
        { key: 'updated_at', label: 'Updated', render: (row: Record<string, unknown>) => dateText(row.updated_at || row.applied_at) },
      ];
    }
    if (activeTab === 'messages') {
      return [
        { key: 'sender_role', label: 'Sender', render: (row: Record<string, unknown>) => <StatusPill value={row.sender_role} /> },
        { key: 'message_kind', label: 'Kind' },
        { key: 'message_text', label: 'Message', render: (row: Record<string, unknown>) => truncate(row.message_text, 120) },
        { key: 'application_id', label: 'Application' },
        { key: 'created_at', label: 'Sent', render: (row: Record<string, unknown>) => dateText(row.created_at) },
      ];
    }
    return [
      { key: 'skill_name', label: 'Skill' },
      { key: 'status', label: 'Status', render: (row: Record<string, unknown>) => <StatusPill value={row.status} /> },
      { key: 'progress_percent', label: 'Progress' },
      { key: 'evidence_filename', label: 'Evidence File' },
      { key: 'updated_at', label: 'Updated', render: (row: Record<string, unknown>) => dateText(row.updated_at || row.evidence_uploaded_at) },
    ];
  }, [activeTab]);

  return (
    <main className="min-h-screen bg-bg text-dark">
      <header className="border-b border-bdr bg-card">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4">
          <button type="button" onClick={onHome} className="flex items-center">
            <Logo size="header" />
          </button>
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <div className="text-sm font-extrabold">{admin?.name || 'Admin'}</div>
              <div className="text-xs text-soft">{admin?.email}</div>
            </div>
            <button className="rounded-lg border border-bdr px-3 py-2 text-sm font-bold text-mid hover:border-rust hover:text-rust" type="button" onClick={() => void loadOverview()}>
              Refresh
            </button>
            <button className="rounded-lg bg-rust px-3 py-2 text-sm font-bold text-white hover:opacity-90" type="button" onClick={onLogout}>
              Logout
            </button>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-5 py-6">
        <div className="mb-5">
          <h1 className="font-display text-3xl font-extrabold">Admin Panel</h1>
          <p className="mt-1 text-sm text-soft">Monitor accounts, employer jobs, applications, messages, and candidate evidence records.</p>
        </div>

        {error && (
          <div className="mb-5 rounded-lg border border-red bg-red-l px-4 py-3 text-sm font-semibold text-red">
            {error}
          </div>
        )}

        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-7">
          {metricCards.map(([label, value]) => (
            <div key={label} className="rounded-lg border border-bdr bg-card px-4 py-3">
              <div className="text-xs font-bold uppercase text-soft">{label}</div>
              <div className="mt-1 text-2xl font-extrabold text-dark">{value}</div>
            </div>
          ))}
          {loading && !overview && (
            <div className="rounded-lg border border-bdr bg-card px-4 py-6 text-sm font-semibold text-soft sm:col-span-2 lg:col-span-7">
              Loading admin data...
            </div>
          )}
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`rounded-lg border px-3 py-2 text-sm font-bold ${activeTab === tab.id ? 'border-rust bg-rust text-white' : 'border-bdr bg-card text-mid hover:border-rust hover:text-rust'}`}
              type="button"
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="rounded-lg border border-bdr bg-card">
          <div className="flex items-center justify-between px-4 py-3">
            <h2 className="text-base font-extrabold">{tabs.find((tab) => tab.id === activeTab)?.label}</h2>
            <span className="text-xs font-semibold text-soft">{currentRows.length} recent records</span>
          </div>
          <AdminTable rows={currentRows} columns={columns} empty={`No ${activeTab} records found.`} />
        </div>
      </section>
    </main>
  );
}

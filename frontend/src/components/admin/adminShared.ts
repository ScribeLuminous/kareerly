export type AdminNotice = (message: string, type?: 'success' | 'error') => void;
export type AdminPanelProps = { getToken: () => Promise<string>; notify: AdminNotice };

export const buttonClass = 'rounded border border-bdr px-2 py-1 text-xs font-bold text-mid hover:border-rust hover:text-rust disabled:opacity-50';
export const dangerButtonClass = 'rounded border border-red px-2 py-1 text-xs font-bold text-red hover:bg-red-l disabled:opacity-50';
export const chipClass = (active: boolean) =>
  `rounded-lg border px-3 py-2 text-sm font-bold ${active ? 'border-dark bg-dark text-white' : 'border-bdr bg-card text-mid hover:border-dark'}`;

export function dateText(value: unknown): string {
  if (typeof value !== 'string' || !value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 16);
  return date.toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function fileSize(bytes?: number | null): string {
  if (!bytes) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

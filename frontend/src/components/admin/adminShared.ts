export type AdminNotice = (message: string, type?: 'success' | 'error') => void;
export type AdminPanelProps = { getToken: () => Promise<string>; notify: AdminNotice };

export const buttonClass = 'rounded border border-bdr px-2 py-1 text-xs font-bold text-mid hover:border-rust hover:text-rust disabled:opacity-50';
export const dangerButtonClass = 'rounded border border-red px-2 py-1 text-xs font-bold text-red hover:bg-red-l disabled:opacity-50';
export const selectCellClass = 'w-10 px-4 py-3';
export const bulkButtonClass = 'rounded-md border border-bdr bg-card px-2.5 py-1.5 text-xs font-bold text-mid hover:border-rust hover:text-rust disabled:opacity-50';
export const bulkDangerButtonClass = 'rounded-md border border-red bg-card px-2.5 py-1.5 text-xs font-bold text-red hover:bg-red-l disabled:opacity-50';

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

export type BulkResult = { ok: number; failed: string[] };

/**
 * Runs one admin action per selected item, one at a time so the backend is not
 * flooded, and keeps going past failures so a single bad row does not stop the batch.
 */
export async function runBulk<T>(items: T[], action: (item: T) => Promise<unknown>): Promise<BulkResult> {
  const result: BulkResult = { ok: 0, failed: [] };
  for (const item of items) {
    try {
      await action(item);
      result.ok += 1;
    } catch (error) {
      result.failed.push(error instanceof Error ? error.message : 'Unknown error');
    }
  }
  return result;
}

export function reportBulk(notify: AdminNotice, result: BulkResult, done: string) {
  if (result.failed.length === 0) {
    notify(`${done} ${result.ok} ${result.ok === 1 ? 'item' : 'items'}.`, 'success');
    return;
  }
  const reasons = Array.from(new Set(result.failed)).slice(0, 2).join(' ');
  notify(`${done} ${result.ok}, ${result.failed.length} failed. ${reasons}`, 'error');
}

/** Case-insensitive match of a search term against any of the given values. */
export function matchesSearch(term: string, ...values: unknown[]): boolean {
  const needle = term.trim().toLowerCase();
  if (!needle) return true;
  return values.some((value) => value !== null && value !== undefined && String(value).toLowerCase().includes(needle));
}

/** Downloads rows as a CSV file named after the table. */
export function downloadCsv(filename: string, columns: Array<{ key: string; label: string }>, rows: Array<Record<string, unknown>>) {
  const cell = (value: unknown) => {
    const text = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [columns.map((column) => cell(column.label)).join(','), ...rows.map((row) => columns.map((column) => cell(row[column.key])).join(','))];
  const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

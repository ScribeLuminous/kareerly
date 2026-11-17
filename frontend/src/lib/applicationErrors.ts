// Errors the application functions (submit_job_application,
// withdraw_job_application, respond_to_message_request) raise on purpose;
// their messages are written for the candidate.
const READABLE_APPLICATION_ERROR_CODES = new Set(['23505', 'P0002', '22023', '42501']);

/** The message to show for a failed application action. */
export function applicationErrorMessage(error: unknown, fallback: string): string {
  const record = error && typeof error === 'object' ? error as { code?: unknown; message?: unknown } : {};
  const code = typeof record.code === 'string' ? record.code : '';
  const message = typeof record.message === 'string' ? record.message.trim() : '';
  if (code === '23505') return 'You have already applied for this job.';
  return READABLE_APPLICATION_ERROR_CODES.has(code) && message ? message : fallback;
}

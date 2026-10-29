// Deadlines for Candidate Assessments. No imports of the app's data layer, so
// the employer rules and tests can use it on its own.

type DueFields = { status: 'pending' | 'submitted' | 'reviewed'; dueAt?: string | null };

// ---------- Deadlines ----------
// Deadlines are picked as a calendar day and last until the end of that day in
// Philippine time, which is how candidates and employers read them.

export const DEFAULT_ASSESSMENT_DAYS = 7;
const MIN_DUE_DAYS = 1;
const MAX_DUE_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

const manilaDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' });
const manilaDueFormat = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' });
const manilaDueTimeFormat = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

/** A calendar day (YYYY-MM-DD, Philippine time) this many days from now. */
export function assessmentDueDateIn(days: number, now: Date = new Date()): string {
  return manilaDate.format(new Date(now.getTime() + days * DAY_MS));
}

export const defaultAssessmentDueDate = (now?: Date) => assessmentDueDateIn(DEFAULT_ASSESSMENT_DAYS, now);
export const earliestAssessmentDueDate = (now?: Date) => assessmentDueDateIn(MIN_DUE_DAYS, now);
export const latestAssessmentDueDate = (now?: Date) => assessmentDueDateIn(MAX_DUE_DAYS - 1, now);

/** The instant the chosen day ends, as the timestamp the database stores. */
export function dueDateToTimestamp(date: string): string {
  return new Date(`${date}T23:59:00+08:00`).toISOString();
}

/** Why a chosen day is not allowed (the database enforces the same limits), or '' when it is fine. */
export function assessmentDueDateProblem(date: string, now: Date = new Date()): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T23:59:00+08:00`))) return 'Choose a deadline.';
  if (date < earliestAssessmentDueDate(now)) return 'Give the candidate at least one full day to respond.';
  if (date > latestAssessmentDueDate(now)) return 'The deadline can be at most 90 days away.';
  return '';
}

/** The calendar day (YYYY-MM-DD, Philippine time) a stored deadline falls on. */
export const dueDayOf = (dueAt: string): string => manilaDate.format(new Date(dueAt));

export type AssessmentDueState = 'none' | 'open' | 'overdue';

/** Whether the candidate can still answer. Only an assessment still waiting for an answer can be overdue. */
export function assessmentDueState(assessment: DueFields | null, now: number = Date.now()): AssessmentDueState {
  if (!assessment || assessment.status !== 'pending' || !assessment.dueAt) return 'none';
  return Date.parse(assessment.dueAt) < now ? 'overdue' : 'open';
}

export function formatAssessmentDue(dueAt: string, withTime = false): string {
  return (withTime ? manilaDueTimeFormat : manilaDueFormat).format(new Date(dueAt));
}

/** "Due Nov 3, 2026", "Overdue since Nov 3, 2026", or '' when there is no deadline to show. */
export function assessmentDueLabel(assessment: DueFields | null, now?: number): string {
  const state = assessmentDueState(assessment, now);
  if (state === 'none' || !assessment?.dueAt) return '';
  return state === 'overdue' ? `Overdue since ${formatAssessmentDue(assessment.dueAt)}` : `Due ${formatAssessmentDue(assessment.dueAt)}`;
}


/** What a candidate's application row says about its assessment. */
export function candidateAssessmentNote(assessment: (DueFields & { dueAt?: string | null }) | null, now?: number): string {
  if (!assessment) return '';
  if (assessment.status !== 'pending') return 'Submitted';
  const state = assessmentDueState(assessment, now);
  if (state === 'overdue' && assessment.dueAt) return `Deadline passed on ${formatAssessmentDue(assessment.dueAt)}`;
  return assessment.dueAt ? `Action required · due ${formatAssessmentDue(assessment.dueAt)}` : 'Action required';
}

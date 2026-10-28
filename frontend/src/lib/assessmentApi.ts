import { assessmentDueLabel } from './assessmentDeadline';
import { supabase } from './supabase';

export * from './assessmentDeadline';

export type AssessmentStatus = 'pending' | 'submitted' | 'reviewed';
export type AssessmentQuestion = {
  id: string;
  sourceCriterionId: string;
  name: string;
  description: string;
  question: string;
  required: boolean;
  weight: number;
  position: number;
  response: string;
};
export type CandidateAssessment = {
  id: string;
  applicationId: string;
  rubricId: string;
  status: AssessmentStatus;
  sentAt: string;
  /** When the candidate must answer by; null on assessments sent before deadlines existed. */
  dueAt: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  questions: AssessmentQuestion[];
};

type AssessmentRow = { id: string; application_id: string; rubric_id: string; status: AssessmentStatus; sent_at: string; due_at: string | null; submitted_at: string | null; reviewed_at: string | null };
type SnapshotRow = { id: string; assessment_id: string; source_criterion_id: string; name: string; description: string; question: string; is_required: boolean; weight: number; position: number };
type ResponseRow = { assessment_id: string; criterion_snapshot_id: string; response_text: string };

function assert(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

export async function loadAssessments(applicationIds: string[]): Promise<Map<string, CandidateAssessment>> {
  const byApplication = new Map<string, CandidateAssessment>();
  if (applicationIds.length === 0) return byApplication;
  const result = await supabase.from('candidate_assessments').select('id,application_id,rubric_id,status,sent_at,due_at,submitted_at,reviewed_at').in('application_id', applicationIds);
  assert(result.error);
  const assessments = (result.data || []) as AssessmentRow[];
  if (!assessments.length) return byApplication;
  const ids = assessments.map((row) => row.id);
  const [snapshotsResult, responsesResult] = await Promise.all([
    supabase.from('assessment_criterion_snapshots').select('*').in('assessment_id', ids).order('position'),
    supabase.from('candidate_assessment_responses').select('*').in('assessment_id', ids),
  ]);
  assert(snapshotsResult.error);
  assert(responsesResult.error);
  const responses = new Map(((responsesResult.data || []) as ResponseRow[]).map((row) => [row.criterion_snapshot_id, row.response_text]));
  const snapshots = (snapshotsResult.data || []) as SnapshotRow[];
  assessments.forEach((row) => byApplication.set(row.application_id, {
    id: row.id,
    applicationId: row.application_id,
    rubricId: row.rubric_id,
    status: row.status,
    sentAt: row.sent_at,
    dueAt: row.due_at,
    submittedAt: row.submitted_at,
    reviewedAt: row.reviewed_at,
    questions: snapshots.filter((item) => item.assessment_id === row.id).map((item) => ({
      id: item.id,
      sourceCriterionId: item.source_criterion_id,
      name: item.name,
      description: item.description,
      question: item.question,
      required: item.is_required,
      weight: item.weight,
      position: item.position,
      response: responses.get(item.id) || '',
    })),
  }));
  return byApplication;
}

/** Sends the assessment. Without a deadline the database gives the candidate DEFAULT_ASSESSMENT_DAYS days. */
export async function sendAssessment(applicationId: string, dueAt?: string | null): Promise<void> {
  const { error } = await supabase.rpc('send_candidate_assessment', { target_application_id: applicationId, requested_due_at: dueAt ?? null });
  assert(error);
}

export async function extendAssessmentDeadline(assessmentId: string, dueAt: string): Promise<void> {
  const { error } = await supabase.rpc('extend_assessment_deadline', { target_assessment_id: assessmentId, new_due_at: dueAt });
  assert(error);
}

export async function saveAssessment(assessmentId: string, responses: Record<string, string>, submit: boolean): Promise<void> {
  const answers = Object.entries(responses).map(([criterion_snapshot_id, response_text]) => ({ criterion_snapshot_id, response_text }));
  const { error } = await supabase.rpc('save_candidate_assessment', { target_assessment_id: assessmentId, answers, submit });
  assert(error);
}

/** Records that a reviewer opened a link from a candidate's answer. It records the click, not what was concluded. */
export async function logAssessmentLinkOpened(assessmentId: string, url: string): Promise<void> {
  const { error } = await supabase.rpc('log_assessment_link_opened', { target_assessment_id: assessmentId, opened_url: url });
  assert(error);
}

export function assessmentStatusLabel(assessment: CandidateAssessment | null): string {
  if (!assessment) return 'Not sent';
  if (assessment.status === 'pending') {
    const due = assessmentDueLabel(assessment);
    return due ? `Awaiting response · ${due.charAt(0).toLowerCase()}${due.slice(1)}` : 'Awaiting response';
  }
  if (assessment.status === 'submitted') return 'Submitted';
  return 'Reviewed';
}

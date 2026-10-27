import { authenticatedRequest } from './api';
import { supabase } from './supabase';

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
  submittedAt: string | null;
  reviewedAt: string | null;
  questions: AssessmentQuestion[];
};

type AssessmentRow = { id: string; application_id: string; rubric_id: string; status: AssessmentStatus; sent_at: string; submitted_at: string | null; reviewed_at: string | null };
type SnapshotRow = { id: string; assessment_id: string; source_criterion_id: string; name: string; description: string; question: string; is_required: boolean; weight: number; position: number };
type ResponseRow = { assessment_id: string; criterion_snapshot_id: string; response_text: string };

function assert(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

export async function loadAssessments(applicationIds: string[]): Promise<Map<string, CandidateAssessment>> {
  const byApplication = new Map<string, CandidateAssessment>();
  if (applicationIds.length === 0) return byApplication;
  const result = await supabase.from('candidate_assessments').select('id,application_id,rubric_id,status,sent_at,submitted_at,reviewed_at').in('application_id', applicationIds);
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

export async function sendAssessment(applicationId: string): Promise<void> {
  const { error } = await supabase.rpc('send_candidate_assessment', { target_application_id: applicationId });
  assert(error);
}

export async function saveAssessment(assessmentId: string, responses: Record<string, string>, submit: boolean): Promise<void> {
  const answers = Object.entries(responses).map(([criterion_snapshot_id, response_text]) => ({ criterion_snapshot_id, response_text }));
  const { error } = await supabase.rpc('save_candidate_assessment', { target_assessment_id: assessmentId, answers, submit });
  assert(error);
}

export function assessmentStatusLabel(assessment: CandidateAssessment | null): string {
  if (!assessment) return 'Not sent';
  if (assessment.status === 'pending') return 'Awaiting response';
  if (assessment.status === 'submitted') return 'Submitted';
  return 'Reviewed';
}

/** A model's first-pass ratings for a submitted assessment. It is a suggestion, not a scorecard: the reviewer edits and submits it. */
export type AiReviewDraft = {
  assessmentId: string;
  ratings: { criterionId: string; rating: number | null; evidence: string }[];
  summary: string;
  /** Links in the candidate's answers. The AI does not open them; the reviewer should. */
  links: string[];
};

export async function requestAiReviewDraft(applicationId: string): Promise<AiReviewDraft> {
  const payload = await authenticatedRequest(
    `/api/employer/applications/${encodeURIComponent(applicationId)}/assessment-review-draft`,
    { method: 'POST' },
    'Unable to draft a review right now. You can still rate the answers yourself.',
  );
  const draft = payload?.draft;
  return {
    assessmentId: String(draft?.assessment_id || ''),
    ratings: Array.isArray(draft?.ratings)
      ? draft.ratings.map((item: { criterion_id: string; rating: number | null; evidence?: string }) => ({
        criterionId: item.criterion_id, rating: item.rating ?? null, evidence: item.evidence || '',
      }))
      : [],
    summary: typeof draft?.summary === 'string' ? draft.summary : '',
    links: Array.isArray(draft?.links) ? draft.links.map(String) : [],
  };
}

/** Records that a reviewer submitted their scorecard on an AI draft. */
export async function approveAiReviewDraft(assessmentId: string): Promise<void> {
  const { error } = await supabase.rpc('approve_assessment_ai_draft', { target_assessment_id: assessmentId });
  assert(error);
}

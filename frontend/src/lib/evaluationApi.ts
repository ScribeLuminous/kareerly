// Structured evaluation data, read and written through Supabase. Writes go
// through database functions that check job ownership, keep rubric versions
// and record the audit trail; scores are calculated there, not here.
import { supabase } from './supabase';
import {
  parseApplicationEvaluation,
  parseEvaluationResult,
  rubricPayload,
  type ApplicationEvaluation,
  type EvaluationResult,
  type RatingDraft,
  type Rubric,
  type RubricCriterionDraft,
  type Scorecard,
} from '../pages/employer/evaluation';

type RubricRow = { id: string; job_post_id: string; version: number; created_at: string; superseded_at: string | null };
type CriterionRow = { id: string; rubric_id: string; position: number; name: string; description: string; weight: number; is_required: boolean; anchors: unknown; prompts: string[] | null; question: string };
type ScorecardRow = { id: string; application_id: string; rubric_id: string; reviewer_user_id: string; status: 'draft' | 'submitted'; summary_notes: string; updated_at: string; submitted_at: string | null };
type RatingRow = { scorecard_id: string; criterion_id: string; rating: number | null; evidence: string };

export type AuditEntry = { id: number; eventType: string; actorUserId: string | null; details: Record<string, unknown>; createdAt: string };

function fail(error: { message?: string } | null, fallback: string): never {
  throw new Error(error?.message || fallback);
}

/** Missing tables or functions: the evaluation migration is not applied yet. */
export function isEvaluationUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return /evaluation_|save_evaluation|get_application_evaluation|list_job_evaluation_summaries|PGRST202|42P01|schema cache/i.test(message);
}

async function loadCriteria(rubricIds: string[]): Promise<Map<string, Rubric['criteria']>> {
  const result = new Map<string, Rubric['criteria']>();
  if (rubricIds.length === 0) return result;
  const { data, error } = await supabase.from('evaluation_criteria').select('*').in('rubric_id', rubricIds).order('position');
  if (error) fail(error, 'Unable to load rubric criteria.');
  (data as CriterionRow[] || []).forEach((row) => {
    const list = result.get(row.rubric_id) || [];
    list.push({
      id: row.id,
      position: row.position,
      name: row.name,
      description: row.description || '',
      weight: row.weight,
      isRequired: row.is_required,
      anchors: Array.isArray(row.anchors) ? row.anchors.map(String) : [],
      prompts: row.prompts || [],
      question: row.question || row.prompts?.[0] || '',
    });
    result.set(row.rubric_id, list);
  });
  return result;
}

/** Every rubric version for the given job posts (employer_job_posts.id), newest first. */
export async function loadRubrics(jobPostIds: string[]): Promise<Rubric[]> {
  if (jobPostIds.length === 0) return [];
  const { data, error } = await supabase.from('evaluation_rubrics').select('*').in('job_post_id', jobPostIds).order('version', { ascending: false });
  if (error) fail(error, 'Unable to load evaluation rubrics.');
  const rows = (data as RubricRow[]) || [];
  const criteria = await loadCriteria(rows.map((row) => row.id));
  return rows.map((row) => ({
    id: row.id,
    jobPostId: row.job_post_id,
    version: row.version,
    createdAt: row.created_at,
    supersededAt: row.superseded_at,
    criteria: criteria.get(row.id) || [],
  }));
}

export async function saveRubric(jobPostId: string, criteria: RubricCriterionDraft[]): Promise<string> {
  const { data, error } = await supabase.rpc('save_evaluation_rubric', { target_job_post_id: jobPostId, criteria: rubricPayload(criteria) });
  if (error) fail(error, 'Unable to save the rubric.');
  return String(data);
}

export async function loadScorecards(applicationId: string): Promise<Scorecard[]> {
  const { data, error } = await supabase.from('evaluation_scorecards').select('*').eq('application_id', applicationId);
  if (error) fail(error, 'Unable to load scorecards.');
  const cards = (data as ScorecardRow[]) || [];
  const ratingsByCard = new Map<string, Record<string, RatingDraft>>();
  if (cards.length > 0) {
    const { data: ratingRows, error: ratingError } = await supabase.from('evaluation_ratings').select('*').in('scorecard_id', cards.map((card) => card.id));
    if (ratingError) fail(ratingError, 'Unable to load ratings.');
    ((ratingRows as RatingRow[]) || []).forEach((row) => {
      const ratings = ratingsByCard.get(row.scorecard_id) || {};
      ratings[row.criterion_id] = { rating: row.rating, evidence: row.evidence || '' };
      ratingsByCard.set(row.scorecard_id, ratings);
    });
  }
  return cards.map((card) => ({
    id: card.id,
    applicationId: card.application_id,
    rubricId: card.rubric_id,
    reviewerUserId: card.reviewer_user_id,
    status: card.status,
    summaryNotes: card.summary_notes || '',
    updatedAt: card.updated_at,
    submittedAt: card.submitted_at,
    ratings: ratingsByCard.get(card.id) || {},
  }));
}

export async function saveScorecard(params: { applicationId: string; rubricId: string; ratings: Record<string, RatingDraft>; summary: string; submit: boolean }): Promise<string> {
  const ratings = Object.entries(params.ratings).map(([criterionId, value]) => ({
    criterion_id: criterionId,
    rating: value.rating,
    evidence: value.evidence.trim(),
  }));
  const { data, error } = await supabase.rpc('save_evaluation_scorecard', {
    target_application_id: params.applicationId,
    target_rubric_id: params.rubricId,
    ratings,
    summary: params.summary.trim(),
    submit: params.submit,
  });
  if (error) fail(error, 'Unable to save the scorecard.');
  return String(data);
}

export async function loadApplicationEvaluation(applicationId: string): Promise<ApplicationEvaluation> {
  const { data, error } = await supabase.rpc('get_application_evaluation', { target_application_id: applicationId });
  if (error) fail(error, 'Unable to load the evaluation.');
  return parseApplicationEvaluation(data);
}

export type EvaluationSummary = { result: EvaluationResult; myScorecard: 'draft' | 'submitted' | null };

/** Results on the job's current rubric version, keyed by application id. */
export async function loadJobEvaluationSummaries(jobPostId: string): Promise<Map<string, EvaluationSummary>> {
  const { data, error } = await supabase.rpc('list_job_evaluation_summaries', { target_job_post_id: jobPostId });
  if (error) fail(error, 'Unable to load evaluation summaries.');
  const result = new Map<string, EvaluationSummary>();
  ((data as Array<{ application_id: string; result: unknown; my_scorecard_status: string | null }>) || []).forEach((row) => {
    const parsed = parseEvaluationResult(row.result);
    const mine = row.my_scorecard_status === 'draft' || row.my_scorecard_status === 'submitted' ? row.my_scorecard_status : null;
    if (parsed) result.set(String(row.application_id), { result: parsed, myScorecard: mine });
  });
  return result;
}

export async function loadAuditTrail(applicationId: string): Promise<AuditEntry[]> {
  const { data, error } = await supabase
    .from('employer_review_audit_log')
    .select('id,event_type,actor_user_id,details,created_at')
    .eq('application_id', applicationId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) fail(error, 'Unable to load the activity history.');
  return ((data as Array<{ id: number; event_type: string; actor_user_id: string | null; details: Record<string, unknown>; created_at: string }>) || []).map((row) => ({
    id: row.id,
    eventType: row.event_type,
    actorUserId: row.actor_user_id,
    details: row.details || {},
    createdAt: row.created_at,
  }));
}

export async function rubricHasScorecards(rubricId: string): Promise<boolean> {
  const { count, error } = await supabase.from('evaluation_scorecards').select('id', { count: 'exact', head: true }).eq('rubric_id', rubricId);
  if (error) fail(error, 'Unable to check the rubric.');
  if ((count || 0) > 0) return true;
  const { count: assessmentCount, error: assessmentError } = await supabase.from('candidate_assessments').select('id', { count: 'exact', head: true }).eq('rubric_id', rubricId);
  if (assessmentError) fail(assessmentError, 'Unable to check sent assessments.');
  return (assessmentCount || 0) > 0;
}

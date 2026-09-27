// Two separate measures for an applicant, never merged into one number:
//
// Profile match: what the application itself shows about the job's required
//   skills. Required skills found = the job's current required skills that
//   appear in the skills matched from the candidate's resume when they
//   applied. Percent = found / required, rounded. Nothing else goes in.
//
// Reviewed evaluation: the team's structured scorecards against the job's
//   rubric, calculated on the server (see the migration
//   20260929090000_employer_structured_evaluation.sql). It has a coverage
//   figure and a score; the score stays empty until every required
//   criterion has been rated at least once.

import { candidateDisplayName, type CandidateApplication, type CandidateStatus, type EmployerJob } from './model';

// ---------- Profile match ----------

export type ProfileMatch = {
  /** The job's required skills, in job order. */
  required: string[];
  found: string[];
  notFound: string[];
  /** found / required, 0-100; null when the job lists no required skills. */
  percent: number | null;
  /** The application recorded skill evidence at all. */
  hasEvidence: boolean;
};

const skillKey = (skill: string) => skill.trim().toLowerCase();

/**
 * Required-skill coverage from the application. When the job's list is not
 * available (an old or deleted job), falls back to the skills recorded on
 * the application at apply time, which were checked against the same job.
 */
export function profileMatch(candidate: Pick<CandidateApplication, 'matchedSkills' | 'missingSkills'>, job: Pick<EmployerJob, 'requiredSkills'> | null): ProfileMatch {
  const recordedMatched = new Set(candidate.matchedSkills.map(skillKey));
  const hasEvidence = candidate.matchedSkills.length + candidate.missingSkills.length > 0;
  const required = job && job.requiredSkills.length > 0
    ? Array.from(new Map(job.requiredSkills.map((skill) => [skillKey(skill), skill])).values())
    : [...candidate.matchedSkills, ...candidate.missingSkills];
  // With no recorded evidence nothing is "found" or "not found"; it is unknown.
  const found = hasEvidence ? required.filter((skill) => recordedMatched.has(skillKey(skill))) : [];
  const notFound = hasEvidence ? required.filter((skill) => !recordedMatched.has(skillKey(skill))) : [];
  return {
    required,
    found,
    notFound,
    percent: required.length > 0 && hasEvidence ? Math.round((100 * found.length) / required.length) : null,
    hasEvidence,
  };
}

export function profileMatchLabel(match: ProfileMatch): string {
  if (match.percent === null) return match.required.length === 0 ? 'No required skills listed' : 'No skill evidence recorded';
  return `${match.found.length} of ${match.required.length} required skills`;
}

// ---------- Rubrics ----------

export const RATING_SCALE: Array<{ value: 1 | 2 | 3 | 4; label: string }> = [
  { value: 1, label: 'Not shown' },
  { value: 2, label: 'Partly shown' },
  { value: 3, label: 'Clearly shown' },
  { value: 4, label: 'Strongly shown' },
];

export const DEFAULT_ANCHORS = [
  'No job-relevant evidence of this in what was reviewed.',
  'Some evidence, with gaps or only with help.',
  'Clear evidence at the level this role needs.',
  'Strong, specific evidence beyond what this role needs.',
];

export type RubricCriterionDraft = {
  key: string;
  name: string;
  description: string;
  weight: number;
  isRequired: boolean;
  anchors: string[];
  prompts: string[];
};

export type RubricCriterion = Omit<RubricCriterionDraft, 'key'> & { id: string; position: number };

export type Rubric = {
  id: string;
  jobPostId: string;
  version: number;
  createdAt: string;
  supersededAt: string | null;
  criteria: RubricCriterion[];
};

let draftCounter = 0;
export const newDraftKey = () => `draft-${Date.now()}-${draftCounter++}`;

export function emptyCriterion(): RubricCriterionDraft {
  return { key: newDraftKey(), name: '', description: '', weight: 2, isRequired: true, anchors: [...DEFAULT_ANCHORS], prompts: [''] };
}

/** A starting point built from the job itself; employers edit it before saving. */
export function starterRubric(job: Pick<EmployerJob, 'requiredSkills' | 'responsibilities'>): RubricCriterionDraft[] {
  const fromSkills = job.requiredSkills.slice(0, 4).map((skill) => ({
    ...emptyCriterion(),
    name: skill,
    description: `Can apply ${skill} to the work this role does.`,
    weight: 3,
    prompts: [`Tell us about a time you used ${skill}. What did you do and what was the result?`],
  }));
  const fromDuties = job.responsibilities.slice(0, 2).map((duty) => ({
    ...emptyCriterion(),
    name: duty.length > 60 ? `${duty.slice(0, 57)}…` : duty,
    description: `Shows they can: ${duty}`,
    weight: 2,
    isRequired: false,
    prompts: [`How would you approach this part of the role: ${duty}?`],
  }));
  const criteria = [...fromSkills, ...fromDuties];
  return criteria.length > 0 ? criteria : [emptyCriterion()];
}

export function rubricToDraft(rubric: Rubric): RubricCriterionDraft[] {
  return rubric.criteria.map((criterion) => ({
    key: criterion.id,
    name: criterion.name,
    description: criterion.description,
    weight: criterion.weight,
    isRequired: criterion.isRequired,
    anchors: criterion.anchors.length === 4 ? [...criterion.anchors] : [...DEFAULT_ANCHORS],
    prompts: criterion.prompts.length > 0 ? [...criterion.prompts] : [''],
  }));
}

export function validateRubricDraft(criteria: RubricCriterionDraft[]): string | null {
  if (criteria.length === 0) return 'Add at least one criterion.';
  if (criteria.length > 12) return 'Use at most 12 criteria.';
  const names = new Set<string>();
  for (const criterion of criteria) {
    const name = criterion.name.trim();
    if (!name) return 'Every criterion needs a name.';
    if (names.has(name.toLowerCase())) return `"${name}" appears twice. Merge or rename it.`;
    names.add(name.toLowerCase());
    if (!Number.isInteger(criterion.weight) || criterion.weight < 1 || criterion.weight > 5) return 'Weights run from 1 to 5.';
    if (criterion.anchors.some((anchor) => !anchor.trim())) return `Give all four rating anchors for "${name}".`;
  }
  if (!criteria.some((criterion) => criterion.isRequired)) return 'Mark at least one criterion as required.';
  return null;
}

export function rubricPayload(criteria: RubricCriterionDraft[]) {
  return criteria.map((criterion) => ({
    name: criterion.name.trim(),
    description: criterion.description.trim(),
    weight: criterion.weight,
    is_required: criterion.isRequired,
    anchors: criterion.anchors.map((anchor) => anchor.trim()),
    prompts: criterion.prompts.map((prompt) => prompt.trim()).filter(Boolean),
  }));
}

/** Share of the total weight each criterion carries, as whole percents. */
export function weightShares(criteria: Array<{ weight: number }>): number[] {
  const total = criteria.reduce((sum, criterion) => sum + criterion.weight, 0);
  return criteria.map((criterion) => (total > 0 ? Math.round((100 * criterion.weight) / total) : 0));
}

// ---------- Scorecards and results ----------

export type RatingDraft = { rating: number | null; evidence: string };

export type Scorecard = {
  id: string;
  applicationId: string;
  rubricId: string;
  reviewerUserId: string;
  status: 'draft' | 'submitted';
  summaryNotes: string;
  updatedAt: string;
  submittedAt: string | null;
  ratings: Record<string, RatingDraft>;
};

export type CriterionResult = {
  criterionId: string;
  name: string;
  weight: number;
  isRequired: boolean;
  ratingCount: number;
  notAssessedCount: number;
  meanRating: number | null;
  spread: number | null;
};

export type EvaluationResult = {
  rubricId: string;
  rubricVersion: number;
  submittedScorecards: number;
  criteriaCount: number;
  assessedCount: number;
  requiredCount: number;
  requiredAssessed: number;
  coveragePercent: number;
  isComplete: boolean;
  /** Null until every required criterion has a rating. */
  score: number | null;
  criteria: CriterionResult[];
};

export type ApplicationEvaluation = {
  currentRubricId: string | null;
  /** Newest rubric version first; each computed with its own weights. */
  versions: EvaluationResult[];
};

const num = (value: unknown): number | null => (value === null || value === undefined || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null);

export function parseEvaluationResult(raw: unknown): EvaluationResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const criteria = Array.isArray(row.criteria) ? row.criteria : [];
  return {
    rubricId: String(row.rubric_id || ''),
    rubricVersion: num(row.rubric_version) || 1,
    submittedScorecards: num(row.submitted_scorecards) || 0,
    criteriaCount: num(row.criteria_count) || 0,
    assessedCount: num(row.assessed_count) || 0,
    requiredCount: num(row.required_count) || 0,
    requiredAssessed: num(row.required_assessed) || 0,
    coveragePercent: num(row.coverage_percent) || 0,
    isComplete: row.is_complete === true,
    score: num(row.score),
    criteria: criteria.map((item) => {
      const criterion = (item || {}) as Record<string, unknown>;
      return {
        criterionId: String(criterion.criterion_id || ''),
        name: String(criterion.name || ''),
        weight: num(criterion.weight) || 1,
        isRequired: criterion.is_required !== false,
        ratingCount: num(criterion.rating_count) || 0,
        notAssessedCount: num(criterion.not_assessed_count) || 0,
        meanRating: num(criterion.mean_rating),
        spread: num(criterion.spread),
      };
    }),
  };
}

export function parseApplicationEvaluation(raw: unknown): ApplicationEvaluation {
  const row = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const versions = Array.isArray(row.versions) ? row.versions.map(parseEvaluationResult).filter((item): item is EvaluationResult => item !== null) : [];
  return { currentRubricId: row.current_rubric_id ? String(row.current_rubric_id) : null, versions };
}

/** Criteria that still need a rating before a score can be published. */
export function unassessedRequired(result: EvaluationResult | null): string[] {
  if (!result) return [];
  return result.criteria.filter((criterion) => criterion.isRequired && criterion.ratingCount === 0).map((criterion) => criterion.name);
}

/** Reviewers who differ by 2+ points on a criterion should talk before deciding. */
export function disagreements(result: EvaluationResult | null): string[] {
  if (!result) return [];
  return result.criteria.filter((criterion) => (criterion.spread || 0) >= 2).map((criterion) => criterion.name);
}

export function evaluationLabel(result: EvaluationResult | null, hasRubric: boolean): string {
  if (!hasRubric) return 'No rubric yet';
  if (!result || result.submittedScorecards === 0) return 'Not reviewed yet';
  if (result.score === null) return `In progress · ${result.coveragePercent}% covered`;
  return `${result.score} / 100 · ${result.coveragePercent}% covered`;
}

// ---------- List view ----------

export type ApplicantSort = 'applied-oldest' | 'applied-newest' | 'activity' | 'profile-match' | 'reviewed';

export const APPLICANT_SORTS: Array<{ value: ApplicantSort; label: string }> = [
  { value: 'applied-oldest', label: 'Applied, oldest first' },
  { value: 'applied-newest', label: 'Applied, newest first' },
  { value: 'activity', label: 'Last activity' },
  { value: 'profile-match', label: 'Profile match' },
  { value: 'reviewed', label: 'Reviewed evaluation' },
];

type Sortable = { candidate: CandidateApplication; profile: ProfileMatch; evaluation: EvaluationResult | null };

const byDate = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

/**
 * Sorts applicants to one job. Unscored applicants keep their place after
 * scored ones rather than being ranked as zero; ties fall back to the
 * application date so the order is stable.
 */
export function sortApplicants<T extends Sortable>(rows: T[], sort: ApplicantSort): T[] {
  const applied = (row: T) => row.candidate.appliedDate || '';
  const scoreOrder = (value: (row: T) => number | null) => (left: T, right: T) => {
    const a = value(left);
    const b = value(right);
    if (a === null && b === null) return byDate(applied(left), applied(right));
    if (a === null) return 1;
    if (b === null) return -1;
    return b - a || byDate(applied(left), applied(right));
  };
  const sorted = [...rows];
  if (sort === 'applied-oldest') sorted.sort((left, right) => byDate(applied(left), applied(right)));
  if (sort === 'applied-newest') sorted.sort((left, right) => byDate(applied(right), applied(left)));
  if (sort === 'activity') sorted.sort((left, right) => byDate(right.candidate.lastActivity, left.candidate.lastActivity));
  if (sort === 'profile-match') sorted.sort(scoreOrder((row) => row.profile.percent));
  if (sort === 'reviewed') sorted.sort(scoreOrder((row) => row.evaluation?.score ?? null));
  return sorted;
}

export type NextAction = { label: string; detail: string };

/** The next step open to a person reviewing this applicant; never automatic. */
export function nextAction(status: CandidateStatus, messageState: CandidateApplication['messageRequestState'], evaluation: EvaluationResult | null, hasRubric: boolean, reviewedByMe: boolean): NextAction {
  if (status === 'Withdrawn') return { label: 'No action', detail: 'Withdrawn by the candidate.' };
  if (status === 'Hired' || status === 'Rejected') return { label: 'Closed', detail: `${status} is final.` };
  if (!hasRubric) return { label: 'Set up a rubric', detail: 'Agree the criteria for this job before scoring anyone.' };
  if (status === 'Interviewing' && messageState === 'none') return { label: 'Send message request', detail: 'Arrange the interview with the candidate.' };
  if (!reviewedByMe) return { label: 'Complete your scorecard', detail: 'Rate each criterion from the evidence, or mark it not assessed.' };
  const missing = unassessedRequired(evaluation);
  if (missing.length > 0) return { label: 'Gather evidence', detail: `Not yet assessed: ${missing.join(', ')}.` };
  if (status === 'Pending') return { label: 'Decide the next stage', detail: 'Shortlist, interview or decline, based on the evidence.' };
  if (status === 'Shortlisted') return { label: 'Decide on an interview', detail: 'Move to Interviewing or decline.' };
  return { label: 'Record the outcome', detail: 'Mark as hired or decline when the team has decided.' };
}

// ---------- Candidates page filters ----------

export type CandidateFilters = {
  jobId: string;
  status: 'all' | CandidateStatus;
  search: string;
  sort: ApplicantSort;
};

export const DEFAULT_CANDIDATE_FILTERS: CandidateFilters = { jobId: '', status: 'all', search: '', sort: 'applied-oldest' };

/** Applicants in the order and filter the page shows; the review uses it to step between them. */
export function visibleApplicants(applications: CandidateApplication[], jobs: EmployerJob[], filters: CandidateFilters, summaries: Map<string, { result: EvaluationResult }>): CandidateApplication[] {
  const job = jobs.find((item) => item.id === filters.jobId) || null;
  const query = filters.search.trim().toLowerCase();
  const rows = applications
    .filter((candidate) => candidate.jobId === filters.jobId)
    .filter((candidate) => filters.status === 'all' || candidate.status === filters.status)
    .filter((candidate) => {
      if (!query) return true;
      return [candidate.publicId, candidateDisplayName(candidate), candidate.status, ...candidate.matchedSkills, ...candidate.missingSkills]
        .join(' ')
        .toLowerCase()
        .includes(query);
    })
    .map((candidate) => ({ candidate, profile: profileMatch(candidate, job), evaluation: summaries.get(candidate.id)?.result || null }));
  return sortApplicants(rows, filters.sort).map((row) => row.candidate);
}


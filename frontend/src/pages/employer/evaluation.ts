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

import { assessmentDueState, formatAssessmentDue } from '../../lib/assessmentDeadline';
import { candidateDisplayName, type CandidateApplication, type CandidateStatus, type EmployerJob } from './model';
import { STRONG_MATCH_PERCENT } from './insights/matchTiers';

// ---------- Profile match ----------

export type ProfileMatch = {
  /** The job's required skills, in job order. */
  required: string[];
  found: string[];
  notFound: string[];
  /** The candidate's fit score for this job when they applied (0-100), or null when none was saved. */
  percent: number | null;
  /** The application recorded skill evidence at all. */
  hasEvidence: boolean;
};

const skillKey = (skill: string) => skill.trim().toLowerCase();

/**
 * The one match figure an employer sees: the candidate's own fit score for the
 * job, saved when they applied. It is the same number the candidate saw (for
 * example "89% Fit Now"), so the two sides never show different percentages.
 * It is null when the application did not record a score.
 *
 * Beside it, the skills found and not found come from the evidence saved with
 * the application: the same matched and missing lists behind the candidate's
 * "You have ..." chips. They are listed by name, not turned into a second
 * percentage, and they are not re-derived by comparing the job's own wording
 * with the saved names, which showed a strong match as 0 of 3 because the
 * matching service records canonical names ("HTML And CSS") that rarely equal
 * what an employer typed ("HTML", "CSS").
 *
 * With no saved evidence nothing is "found" or "not found"; it is unknown, and
 * the job's own list is returned only so the screen can say what was required.
 */
export function profileMatch(candidate: Pick<CandidateApplication, 'matchedSkills' | 'missingSkills'> & { applyTimeRankingScore?: number | null }, job: Pick<EmployerJob, 'requiredSkills'> | null): ProfileMatch {
  const unique = (skills: string[]) => Array.from(new Map(skills.map((skill) => [skillKey(skill), skill])).values());
  const score = candidate.applyTimeRankingScore;
  const percent = typeof score === 'number' && Number.isFinite(score) ? Math.round(score) : null;
  const hasEvidence = candidate.matchedSkills.length + candidate.missingSkills.length > 0;
  if (!hasEvidence) {
    return { required: unique(job?.requiredSkills || []), found: [], notFound: [], percent, hasEvidence: false };
  }
  const found = unique(candidate.matchedSkills);
  const foundKeys = new Set(found.map(skillKey));
  const notFound = unique(candidate.missingSkills).filter((skill) => !foundKeys.has(skillKey(skill)));
  return { required: [...found, ...notFound], found, notFound, percent, hasEvidence: true };
}

/** The quick filter on the Candidates page: applicants at or above this match score. */
export const HIGH_MATCH_PERCENT = STRONG_MATCH_PERCENT;

/** Short match figure for lists, e.g. "Match 80%". */
export function matchScoreLabel(match: ProfileMatch): string {
  return match.percent === null ? 'Match n/a' : `Match ${match.percent}%`;
}

export function matchScoreBadgeClass(match: ProfileMatch): string {
  if (match.percent === null) return 'k-badge k-badge-outline';
  if (match.percent >= HIGH_MATCH_PERCENT) return 'k-badge k-badge-success';
  return 'k-badge k-badge-warn';
}

/** The required skills found in the application, by name (a count would read as a second percentage). */
export function profileMatchLabel(match: ProfileMatch): string {
  if (!match.hasEvidence) return match.required.length === 0 ? 'No required skills listed' : 'No skill evidence recorded';
  if (match.found.length === 0) return 'None found';
  const shown = match.found.slice(0, 3).join(', ');
  return match.found.length > 3 ? `${shown} +${match.found.length - 3}` : shown;
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
  question: string;
};

export type RubricCriterion = Omit<RubricCriterionDraft, 'key'> & { id: string; position: number };

export type Rubric = {
  id: string;
  jobPostId: string;
  version: number;
  createdAt: string;
  supersededAt: string | null;
  /** The assessment template this version was applied from, if any. */
  templateId?: string | null;
  criteria: RubricCriterion[];
};

/** A reusable Candidate Assessment an employer can apply to any of their jobs. */
export type AssessmentTemplate = {
  id: string;
  name: string;
  description: string;
  criteria: RubricCriterionDraft[];
  updatedAt: string;
};

let draftCounter = 0;
export const newDraftKey = () => `draft-${Date.now()}-${draftCounter++}`;

export function emptyCriterion(): RubricCriterionDraft {
  return { key: newDraftKey(), name: '', description: '', weight: 2, isRequired: true, anchors: [...DEFAULT_ANCHORS], prompts: [''], question: '' };
}

/** "Excel" → "Excel skills", but "Leadership Skills" stays as is. */
const skillsPhrase = (skill: string) => (/\bskills?$/i.test(skill) ? skill : `${skill} skills`);

// Starter questions, rotated so a draft doesn't repeat one sentence for every
// skill. Each asks for a specific example, which is what the rating anchors
// look for.
const SKILL_QUESTIONS: Array<(skill: string, role: string) => string> = [
  (skill) => `Describe a specific time your ${skillsPhrase(skill)} made a difference at work or in school. What was the situation, what did you do, and what was the result?`,
  (skill) => `What is the most challenging ${skill} task you have handled? How did you approach it, and what would you do differently now?`,
  (skill, role) => `Give an example of how you have used ${skill}. How would you apply it in your first month as ${role}?`,
  (skill) => `Tell us about a mistake or setback involving ${skill}. How did you handle it, and what did you learn?`,
];

const DUTY_QUESTIONS: Array<(duty: string, role: string) => string> = [
  (duty, role) => `As ${role}, part of your work would be: ${duty}. How would you go about it, and how would you know it went well?`,
  (duty) => `Tell us about a time you handled work like this: ${duty}. If you haven't yet, how would you get up to speed quickly?`,
];

/** "Hotel Front Desk Agent" → "a Hotel Front Desk Agent"; falls back to "a member of this team". */
function roleWithArticle(title: string | undefined): string {
  const role = (title || '').trim();
  if (!role) return 'a member of this team';
  return `${/^[aeiou]/i.test(role) ? 'an' : 'a'} ${role}`;
}

/** Lower-cases a leading word like "Check" without touching acronyms like "SQL". */
function asClause(duty: string): string {
  const text = duty.trim().replace(/[.;:]+$/, '');
  return /^[A-Z][a-z]/.test(text) ? text[0].toLowerCase() + text.slice(1) : text;
}

/** True when the job has the skills or duties a starter draft is built from. */
export function canDraftFromJob(job: Pick<EmployerJob, 'requiredSkills' | 'responsibilities'>): boolean {
  return job.requiredSkills.some((skill) => skill.trim()) || job.responsibilities.some((duty) => duty.trim());
}

/**
 * A starting draft built from the job: up to 4 required skills (weight 3,
 * required) and up to 2 responsibilities (weight 2, optional). Employers
 * review and edit it before saving; nothing is saved until they do.
 */
export function starterRubric(job: Pick<EmployerJob, 'requiredSkills' | 'responsibilities'> & { title?: string }): RubricCriterionDraft[] {
  const role = roleWithArticle(job.title);
  const skills = job.requiredSkills.map((skill) => skill.trim()).filter(Boolean).slice(0, 4);
  const duties = job.responsibilities.map((duty) => duty.trim()).filter(Boolean).slice(0, 2);
  const fromSkills = skills.map((skill, index) => ({
    ...emptyCriterion(),
    name: skill,
    description: `Gives a specific, relevant example of ${skill} and explains their own part and the result.`,
    weight: 3,
    prompts: [],
    question: SKILL_QUESTIONS[index % SKILL_QUESTIONS.length](skill, role),
  }));
  const fromDuties = duties.map((duty, index) => ({
    ...emptyCriterion(),
    name: duty.length > 60 ? `${duty.slice(0, 57)}…` : duty,
    description: `Gives a practical, well-reasoned approach to: ${asClause(duty)}.`,
    weight: 2,
    isRequired: false,
    prompts: [],
    question: DUTY_QUESTIONS[index % DUTY_QUESTIONS.length](asClause(duty), role),
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
    question: criterion.question || criterion.prompts[0] || '',
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
    if (!criterion.question.trim()) return `Add an assessment question for "${name}".`;
    if (criterion.question.length > 1000) return `Keep the question for "${name}" under 1000 characters.`;
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
    question: criterion.question.trim(),
  }));
}

/** Template criteria as stored (the save_evaluation_rubric payload) back into editor drafts. */
export function templateCriteriaToDraft(raw: unknown): RubricCriterionDraft[] {
  const list = Array.isArray(raw) ? raw : [];
  return list.map((item) => {
    const row = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const anchors = Array.isArray(row.anchors) ? row.anchors.map(String) : [];
    const prompts = Array.isArray(row.prompts) ? row.prompts.map(String) : [];
    return {
      key: newDraftKey(),
      name: String(row.name || ''),
      description: String(row.description || ''),
      weight: Number(row.weight) >= 1 && Number(row.weight) <= 5 ? Number(row.weight) : 2,
      isRequired: row.is_required !== false,
      anchors: anchors.length === 4 ? anchors : [...DEFAULT_ANCHORS],
      prompts: prompts.length > 0 ? prompts : [''],
      question: String(row.question || prompts[0] || ''),
    };
  });
}

/**
 * Several templates merged into one assessment, in the order given. A
 * criterion whose name already appeared is left out, so combining two
 * templates that both ask about "Communication" asks once.
 */
export function combineTemplates(templates: Array<Pick<AssessmentTemplate, 'criteria'>>): RubricCriterionDraft[] {
  const seen = new Set<string>();
  const combined: RubricCriterionDraft[] = [];
  templates.forEach((template) => template.criteria.forEach((criterion) => {
    const key = criterion.name.trim().toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    combined.push({ ...criterion, key: newDraftKey(), anchors: [...criterion.anchors], prompts: [...criterion.prompts] });
  }));
  return combined;
}

export type CriterionSummary = {
  key: string;
  index: number;
  name: string;
  share: number;
  isRequired: boolean;
  question: string;
  /** What still needs doing before this criterion can be saved; empty when ready. */
  issues: string[];
};

/** One line per criterion, so the whole assessment reads at a glance. */
export function summarizeCriteria(criteria: RubricCriterionDraft[]): { rows: CriterionSummary[]; required: number; ready: number; problem: string | null } {
  const shares = weightShares(criteria);
  const names = new Map<string, number>();
  criteria.forEach((criterion) => {
    const name = criterion.name.trim().toLowerCase();
    if (name) names.set(name, (names.get(name) || 0) + 1);
  });
  const rows = criteria.map((criterion, index) => {
    const issues: string[] = [];
    if (!criterion.name.trim()) issues.push('Needs a name');
    else if ((names.get(criterion.name.trim().toLowerCase()) || 0) > 1) issues.push('Duplicate name');
    if (!criterion.question.trim()) issues.push('Needs a question');
    if (criterion.anchors.some((anchor) => !anchor.trim())) issues.push('Rating guidance incomplete');
    return { key: criterion.key, index, name: criterion.name.trim(), share: shares[index], isRequired: criterion.isRequired, question: criterion.question.trim(), issues };
  });
  return {
    rows,
    required: criteria.filter((criterion) => criterion.isRequired).length,
    ready: rows.filter((row) => row.issues.length === 0).length,
    problem: validateRubricDraft(criteria),
  };
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
  { value: 'profile-match', label: 'Match score' },
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

type AssessmentState = { status: 'pending' | 'submitted' | 'reviewed'; dueAt?: string | null } | null;

/**
 * The next step once the Candidate Assessment is part of the flow: a scorecard
 * can only start after the candidate submits, so earlier stages point at the
 * assessment instead.
 */
export function assessmentAwareAction(status: CandidateStatus, messageState: CandidateApplication['messageRequestState'], evaluation: EvaluationResult | null, hasRubric: boolean, reviewedByMe: boolean, assessment: AssessmentState): NextAction {
  if (status === 'Withdrawn' || status === 'Hired' || status === 'Rejected') return nextAction(status, messageState, evaluation, hasRubric, reviewedByMe);
  if (!hasRubric) return { label: 'Set up the assessment', detail: 'Add the questions and criteria for this job.' };
  if (status === 'Pending') return { label: 'Shortlist to send the assessment', detail: 'Shortlisting sends the Candidate Assessment.' };
  if (!assessment) return { label: 'Send Assessment', detail: 'The candidate has not received the assessment yet.' };
  if (assessment.status === 'pending') {
    return assessmentDueState(assessment) === 'overdue'
      ? { label: 'Deadline passed', detail: 'The candidate did not submit in time. Extend the deadline or decline.' }
      : { label: 'Awaiting candidate response', detail: assessment.dueAt ? `The candidate can answer until ${formatAssessmentDue(assessment.dueAt)}.` : 'The candidate can save a draft and submit when ready.' };
  }
  if (assessment.status === 'submitted' && !reviewedByMe) return { label: 'Review the assessment', detail: 'Rate the submitted answers on your scorecard.' };
  return nextAction(status, messageState, evaluation, hasRubric, reviewedByMe);
}

// ---------- Bulk stage changes ----------

export type CandidateBulkAction = 'shortlisted' | 'send-assessment' | 'interviewing' | 'hired' | 'rejected';

export const CANDIDATE_BULK_LABEL: Record<CandidateBulkAction, string> = {
  shortlisted: 'Shortlist',
  'send-assessment': 'Send Assessment',
  interviewing: 'Move to Interviewing',
  hired: 'Mark as hired',
  rejected: 'Decline',
};

/**
 * Why this applicant can't take the bulk action, or null when it can. Mirrors
 * the stage rules the database enforces (set_application_stage and
 * send_candidate_assessment).
 */
export function candidateActionBlocker(action: CandidateBulkAction, candidate: Pick<CandidateApplication, 'status'>, assessment: AssessmentState, hasRubric: boolean): string | null {
  const { status } = candidate;
  if (status === 'Hired' || status === 'Rejected' || status === 'Withdrawn') return 'already closed';
  if (action === 'shortlisted') return status === 'Pending' ? null : 'already past Pending';
  if (action === 'send-assessment') {
    if (!hasRubric) return 'no assessment set up for this job';
    if (assessment) return 'assessment already sent';
    return status === 'Pending' || status === 'Shortlisted' || status === 'Interviewing' ? null : 'not eligible';
  }
  // Declining for no response is allowed once the deadline has passed with nothing submitted.
  const unansweredPastDeadline = assessment?.status === 'pending' && assessmentDueState(assessment) === 'overdue';
  if (action === 'interviewing') {
    if (status === 'Interviewing') return 'already interviewing';
    if (status === 'Pending') return 'shortlist first';
    return assessment?.status === 'reviewed' ? null : 'assessment not reviewed yet';
  }
  if (action === 'hired') return status === 'Interviewing' ? null : 'not interviewing yet';
  if (status === 'Interviewing') return null;
  if (unansweredPastDeadline) return null;
  if (assessment?.status === 'pending' && assessment.dueAt) return `the candidate has until ${formatAssessmentDue(assessment.dueAt)}`;
  return assessment?.status === 'reviewed' ? null : 'assessment not reviewed yet';
}

// ---------- Candidates page filters ----------

export type CandidateFilters = {
  jobId: string;
  status: 'all' | CandidateStatus;
  search: string;
  sort: ApplicantSort;
  /** Only applicants with a match score of at least HIGH_MATCH_PERCENT. */
  highMatch: boolean;
};

export const DEFAULT_CANDIDATE_FILTERS: CandidateFilters = { jobId: '', status: 'all', search: '', sort: 'applied-oldest', highMatch: false };

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
    .map((candidate) => ({ candidate, profile: profileMatch(candidate, job), evaluation: summaries.get(candidate.id)?.result || null }))
    .filter((row) => !filters.highMatch || (row.profile.percent !== null && row.profile.percent >= HIGH_MATCH_PERCENT));
  return sortApplicants(rows, filters.sort).map((row) => row.candidate);
}


/** Four-point descriptive score; unanswered criteria have no effect on the denominator. */
export function weightedRating(criteria: Array<{ weight: number; meanRating: number | null }>): number | null {
  const assessed = criteria.filter((item) => item.meanRating !== null && Number.isFinite(item.meanRating));
  const weight = assessed.reduce((sum, item) => sum + item.weight, 0);
  return weight ? assessed.reduce((sum, item) => sum + item.weight * (item.meanRating as number), 0) / weight : null;
}

export function assessmentStatusLabel(assessment: { status: 'pending' | 'submitted' | 'reviewed' } | null): string {
  if (!assessment) return 'Not sent';
  return assessment.status === 'pending' ? 'Awaiting response' : assessment.status === 'submitted' ? 'Submitted' : 'Reviewed';
}

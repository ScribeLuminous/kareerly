// Pure helpers for the Skills page (Gaps and Learning tabs). The rules
// themselves (tiers, order, display limits) come from the backend's
// skill_gap_config.py with every gaps response; nothing here re-ranks skills.
import type { GapJobInput, GapRules, GapSkill, GapTier, SkillGapReport } from '../../types';
import {
  classifySkillCategory,
  isClaimedSkill,
  knownValue,
  normalizeSkill,
  SKILL_PROGRESS_PERCENT,
  skillRecordKey,
  type ClaimedSkill,
  type DashboardApplication,
  type DashboardGap,
  type DashboardJob,
  type SkillProgressRecord,
  type SkillProgressStatus,
} from './model';

export type GapProgress = 'missing' | 'in_progress' | 'completed';
/** Why a skill left the open lists: the candidate has it, or marked it Done. */
export type GapCompletion = 'owned' | 'done' | null;
type JobRef = { job_id: string; job_source: 'internal' | 'employer' };

export function gapProgress(status: SkillProgressStatus | undefined): GapProgress {
  if (status === 'completed' || status === 'evidenced' || status === 'covered') return 'completed';
  if (status === 'started' || status === 'in_progress') return 'in_progress';
  return 'missing';
}

/** The taxonomy ID in a canonical gap key; "" for a skill with no taxonomy entry (CUSTOM:<name>). */
export function taxonomyIdOf(skillId: string): string {
  return skillId.startsWith('CUSTOM:') ? '' : skillId;
}

/** The key skill progress and "I already have this skill" are stored under (as model.skillRecordKey). */
export function gapRecordKey(skill: { taxonomy_skill_id: string; skill_name: string }): string {
  return (skill.taxonomy_skill_id || normalizeSkill(skill.skill_name)).toUpperCase();
}

export function gapCompletion(
  skill: Pick<GapSkill, 'taxonomy_skill_id' | 'skill_name'>,
  claimed: Record<string, ClaimedSkill>,
  progress: Record<string, SkillProgressRecord>,
): GapCompletion {
  if (isClaimedSkill(claimed, { skillId: skill.taxonomy_skill_id || undefined, skill: skill.skill_name })) return 'owned';
  const status = progress[gapRecordKey(skill)]?.status;
  return status === 'completed' || status === 'evidenced' ? 'done' : null;
}

/**
 * Skills with uploaded proof (a certificate, course completion or work sample).
 * Matching counts them as the candidate's skills, like the ones they claimed.
 */
export function provenSkills(progress: Record<string, SkillProgressRecord>): Record<string, ClaimedSkill> {
  return Object.fromEntries(Object.entries(progress)
    .filter(([, record]) => record.status === 'evidenced' && record.skillName.trim())
    .map(([key, record]) => [key, { skillId: record.skillId, skillName: record.skillName, claimedAt: record.evidenceUploadedAt || '' }]));
}

type ProofFile = { fileName?: string; uploadedAt?: string };

/** Records proof for the skill an upload names, adding a progress record when the skill has none. */
export function withSkillProof(progress: Record<string, SkillProgressRecord>, skillName: string, proof: ProofFile): Record<string, SkillProgressRecord> {
  const name = skillName.trim().slice(0, 200);
  if (!name) return progress;
  const wanted = normalizeSkill(name);
  const key = Object.keys(progress).find((existingKey) => normalizeSkill(progress[existingKey].skillName) === wanted)
    || skillRecordKey({ skill: name }).slice(0, 200);
  const existing = progress[key];
  const category = existing?.category || classifySkillCategory(name);
  return {
    ...progress,
    [key]: {
      ...existing,
      skillName: existing?.skillName || name,
      category,
      categoryName: existing?.categoryName || category,
      status: 'evidenced',
      progressPercent: SKILL_PROGRESS_PERCENT.evidenced,
      evidenceFilename: proof.fileName,
      evidenceUploadedAt: proof.uploadedAt,
    },
  };
}

/** Deleted proof: the skills it proved go back to Done without proof and stop counting in matching. */
export function withoutProof(progress: Record<string, SkillProgressRecord>, proof: ProofFile): Record<string, SkillProgressRecord> {
  let changed = false;
  const next = { ...progress };
  Object.entries(progress).forEach(([key, record]) => {
    if (record.status !== 'evidenced' || !proof.fileName || record.evidenceFilename !== proof.fileName || record.evidenceUploadedAt !== proof.uploadedAt) return;
    changed = true;
    next[key] = { ...record, status: 'completed', progressPercent: SKILL_PROGRESS_PERCENT.completed, evidenceFilename: undefined, evidenceUploadedAt: undefined };
  });
  return changed ? next : progress;
}

/** The matches as the gaps endpoint reads them: identity, score and missing skills. */
export function gapJobInputs(jobs: DashboardJob[]): GapJobInput[] {
  return jobs.filter((job) => job.id).map((job) => ({
    job_id: job.id,
    job_source: job.jobSource,
    title: job.title,
    company: knownValue(job.company),
    match_pct: job.hasMatchScore ? Math.max(0, Math.min(100, job.matchScore)) : 0,
    match_type: job.matchCategory === 'fit-now' ? 'fit_now' : 'aspiration',
    missing_required: job.missingSkills,
    missing_nice: job.missingPreferredSkills || [],
  }));
}

/** Saved jobs carry their source from the match list; a saved job outside the matches is sent as is and left out by the backend. */
export function savedJobRefs(savedIds: Set<string>, jobs: DashboardJob[]): JobRef[] {
  const sourceById = new Map(jobs.map((job) => [job.id, job.jobSource]));
  return Array.from(savedIds).filter(Boolean).sort().map((id) => ({ job_id: id, job_source: sourceById.get(id) || 'internal' }));
}

export function appliedJobRefs(applications: DashboardApplication[]): JobRef[] {
  return applications
    .filter((app) => app.status !== 'Withdrawn' && app.jobId)
    .map((app) => ({ job_id: app.jobId, job_source: app.jobSource }));
}

export type TierSection = {
  tier: GapTier;
  label: string;
  rule: string;
  /** Open skills in this tier (after search). */
  total: number;
  visible: GapSkill[];
  hidden: number;
  /** A tier whose limit is 0 shows only its heading, count and a "Show N skills" button. */
  headingOnly: boolean;
  /** The limit applies, so the tier can expand or collapse. */
  limited: boolean;
};

export function searchSkills(skills: GapSkill[], query: string): GapSkill[] {
  const needle = query.trim().toLowerCase();
  return needle ? skills.filter((skill) => skill.skill_name.toLowerCase().includes(needle)) : skills;
}

/**
 * The open skills under the three tier headings with each tier's display limit.
 * While searching, limits are ignored and empty tiers are hidden; an empty tier
 * is never shown.
 */
export function buildTierSections(open: GapSkill[], rules: GapRules, expanded: Partial<Record<GapTier, boolean>>, query = ''): TierSection[] {
  const searching = query.trim().length > 0;
  return rules.tiers.flatMap((tier) => {
    const matching = searchSkills(open.filter((skill) => skill.tier === tier.id), query);
    if (matching.length === 0) return [];
    const limit = rules.display.tier_limits[tier.id] ?? matching.length;
    const showAll = searching || Boolean(expanded[tier.id]);
    const visible = showAll ? matching : matching.slice(0, limit);
    return [{
      tier: tier.id,
      label: tier.label,
      rule: tier.rule,
      total: matching.length,
      visible,
      hidden: matching.length - visible.length,
      headingOnly: visible.length === 0,
      limited: !searching && matching.length > limit,
    }];
  });
}

/** Skill rows shown before any "Show more" is pressed. */
export function defaultVisibleRows(open: GapSkill[], rules: GapRules): number {
  return buildTierSections(open, rules, {}).reduce((sum, section) => sum + section.visible.length, 0);
}

export function showSkillSearch(openCount: number, rules: GapRules): boolean {
  return openCount > rules.display.search_min_open_gaps;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** "Required by 2 jobs", "Required by 1 job · nice to have for 2", "Nice to have for 3 jobs". */
export function requirementSummary(skill: Pick<GapSkill, 'required_jobs' | 'nice_jobs'>): string {
  if (skill.required_jobs > 0) {
    return `Required by ${plural(skill.required_jobs, 'job')}${skill.nice_jobs > 0 ? ` · nice to have for ${skill.nice_jobs}` : ''}`;
  }
  return `Nice to have for ${plural(skill.nice_jobs, 'job')}`;
}

/** One sentence saying why the skill sits in its tier, from the same counts as the rule. */
export function gapExplanation(skill: Pick<GapSkill, 'tier' | 'required_jobs' | 'nice_jobs' | 'jobs_needing'>): string {
  const more = skill.nice_jobs > 0 ? `, and nice to have for ${skill.nice_jobs} more` : '';
  if (skill.tier === 'close_first') {
    return `Required by ${skill.required_jobs} of your jobs${more}, so learning it once helps all ${skill.jobs_needing} at the same time.`;
  }
  if (skill.tier === 'worth_next' && skill.required_jobs > 0) {
    return `Required by 1 of your jobs${more}, so it is the next most useful skill to build.`;
  }
  if (skill.tier === 'worth_next') {
    return `Nice to have for ${skill.nice_jobs} of your jobs, so it can strengthen all ${skill.nice_jobs} applications.`;
  }
  return 'Nice to have for 1 job, so build it after the skills above.';
}

export function matchTypeLabel(type: 'fit_now' | 'aspiration'): string {
  return type === 'fit_now' ? 'Fit-Now' : 'Aspiration';
}

export function requirementLabel(requirement: 'required' | 'nice_to_have'): string {
  return requirement === 'required' ? 'Required' : 'Nice to have';
}

/** "A, B and 3 more" for headings that must stay on one line. */
export function titleList(titles: string[], max = 3): string {
  const distinct = Array.from(new Set(titles.filter(Boolean)));
  if (distinct.length <= max) return distinct.join(', ');
  return `${distinct.slice(0, max).join(', ')} and ${distinct.length - max} more`;
}

export function openAndCompleted(
  report: SkillGapReport | null,
  claimed: Record<string, ClaimedSkill>,
  progress: Record<string, SkillProgressRecord>,
): { open: GapSkill[]; completed: Array<{ skill: GapSkill; reason: Exclude<GapCompletion, null> }> } {
  const open: GapSkill[] = [];
  const completed: Array<{ skill: GapSkill; reason: Exclude<GapCompletion, null> }> = [];
  (report?.skills || []).forEach((skill) => {
    const reason = gapCompletion(skill, claimed, progress);
    if (reason) completed.push({ skill, reason });
    else open.push(skill);
  });
  return { open, completed };
}

/** The gap shape the claim, progress and proof handlers already take. */
export function toDashboardGap(skill: GapSkill): DashboardGap {
  return {
    skill: skill.skill_name,
    skillId: skill.taxonomy_skill_id || undefined,
    affectedCount: skill.jobs_needing,
    optional: skill.required_jobs === 0,
    category: classifySkillCategory(skill.skill_name),
    relatedJobs: Array.from(new Set(skill.jobs.map((job) => job.title).filter(Boolean))),
  };
}

// Claimed skills, skill progress and course completions, saved per user in
// Supabase so they follow the candidate across devices and reach the backend.
// Tables: candidate_claimed_skills, candidate_skill_progress and
// candidate_course_completions (migration 20261022090000_candidate_progress_sync.sql).
import type { ClaimedSkill, CourseCompletion, SkillCategory, SkillProgressRecord, SkillProgressStatus } from '../pages/candidate/model';
import { supabase } from './supabase';

export type CandidateProgress = {
  claimedSkills: Record<string, ClaimedSkill>;
  skillProgress: Record<string, SkillProgressRecord>;
  courseCompletions: Record<string, CourseCompletion>;
};

export type ProgressPart = keyof CandidateProgress;
export const PROGRESS_PARTS: ProgressPart[] = ['claimedSkills', 'skillProgress', 'courseCompletions'];

/** How the dashboard keys a skill and guesses its category (passed in to keep this module free of UI code). */
export type ProgressHelpers = {
  keyOf: (skill: { skillId?: string | null; skill: string }) => string;
  categoryOf: (skillName: string) => SkillCategory;
};

const SKILL_CATEGORIES: SkillCategory[] = ['Core Office Tools', 'Programming & Scripting', 'Statistical Analysis', 'Data Visualization', 'Data Engineering', 'Other'];
const SKILL_STATUSES: SkillProgressStatus[] = ['missing', 'started', 'in_progress', 'completed', 'evidenced', 'covered'];

type ClaimedSkillRow = { skill_key: string; skill_id: string | null; skill_name: string; claimed_at: string | null };
type SkillProgressRow = {
  skill_key: string | null;
  skill_id: string | null;
  skill_name: string;
  category_name: string | null;
  status: string | null;
  progress_percent: number | null;
  selected_resource_id: string | null;
  evidence_filename: string | null;
  evidence_uploaded_at: string | null;
  updated_at?: string | null;
};
type CourseCompletionRow = { resource_id: string; status: string; marked_at: string | null; evidence_id: string | null };

const TABLES: Record<ProgressPart, { table: string; owner: string; key: string }> = {
  claimedSkills: { table: 'candidate_claimed_skills', owner: 'user_id', key: 'skill_key' },
  skillProgress: { table: 'candidate_skill_progress', owner: 'candidate_id', key: 'skill_key' },
  courseCompletions: { table: 'candidate_course_completions', owner: 'user_id', key: 'resource_id' },
};

// Row shapes written for each part, without the owner column. Fixed property
// order, so two rows can be compared by their JSON.
function claimedSkillRow(key: string, item: ClaimedSkill) {
  return { skill_key: key, skill_id: item.skillId || null, skill_name: item.skillName, claimed_at: item.claimedAt || null };
}

function skillProgressRow(key: string, record: SkillProgressRecord) {
  return {
    skill_key: key,
    skill_id: record.skillId || null,
    skill_name: record.skillName,
    category_name: record.categoryName || record.category || null,
    status: record.status,
    progress_percent: record.progressPercent,
    selected_resource_id: record.selectedResourceId || null,
    evidence_filename: record.evidenceFilename || null,
    evidence_uploaded_at: record.evidenceUploadedAt || null,
  };
}

function courseCompletionRow(key: string, item: CourseCompletion) {
  return { resource_id: key, status: item.status, marked_at: item.markedAt || null, evidence_id: item.evidenceId || null };
}

type ProgressItem = ClaimedSkill | SkillProgressRecord | CourseCompletion;
type RowOf = (key: string, value: ProgressItem) => Record<string, unknown>;

const ROW_OF: Record<ProgressPart, RowOf> = {
  claimedSkills: claimedSkillRow as RowOf,
  skillProgress: skillProgressRow as RowOf,
  courseCompletions: courseCompletionRow as RowOf,
};

function rowToClaimedSkill(row: ClaimedSkillRow): ClaimedSkill {
  return { skillId: row.skill_id || undefined, skillName: row.skill_name, claimedAt: row.claimed_at || '' };
}

function rowToSkillProgress(row: SkillProgressRow, helpers: ProgressHelpers): SkillProgressRecord {
  const status = SKILL_STATUSES.includes(row.status as SkillProgressStatus) ? row.status as SkillProgressStatus : 'missing';
  const category = SKILL_CATEGORIES.includes(row.category_name as SkillCategory)
    ? row.category_name as SkillCategory
    : helpers.categoryOf(row.skill_name);
  return {
    skillId: row.skill_id || undefined,
    skillName: row.skill_name,
    category,
    categoryName: row.category_name || category,
    status,
    progressPercent: typeof row.progress_percent === 'number' ? row.progress_percent : 0,
    selectedResourceId: row.selected_resource_id || undefined,
    evidenceFilename: row.evidence_filename || undefined,
    evidenceUploadedAt: row.evidence_uploaded_at || undefined,
  };
}

function rowToCourseCompletion(row: CourseCompletionRow): CourseCompletion {
  return {
    status: row.status === 'evidenced' ? 'evidenced' : 'completed',
    markedAt: row.marked_at || '',
    ...(row.evidence_id ? { evidenceId: row.evidence_id } : {}),
  };
}

/**
 * Skill progress rows keyed as the dashboard keys them. Rows the backend wrote
 * on resume upload have no skill_key, so theirs is derived; when a skill has
 * both, the dashboard's own row wins, else the most recently updated one.
 */
export function skillProgressFromRows(rows: SkillProgressRow[], helpers: ProgressHelpers): Record<string, SkillProgressRecord> {
  const chosen = new Map<string, SkillProgressRow>();
  rows.forEach((row) => {
    if (!row.skill_name && !row.skill_key) return;
    const key = row.skill_key || helpers.keyOf({ skillId: row.skill_id, skill: row.skill_name });
    if (!key) return;
    const current = chosen.get(key);
    const better = !current
      || (Boolean(row.skill_key) && !current.skill_key)
      || (Boolean(row.skill_key) === Boolean(current.skill_key) && (row.updated_at || '') > (current.updated_at || ''));
    if (better) chosen.set(key, row);
  });
  return Object.fromEntries(Array.from(chosen, ([key, row]) => [key, rowToSkillProgress(row, helpers)]));
}

function loadError(part: string, message: string) {
  return new Error(`Unable to load your saved ${part}: ${message}`);
}

/** Everything saved for this user. Throws when any part cannot be read, so the caller never mistakes a failure for "nothing saved". */
export async function loadCandidateProgress(userId: string, helpers: ProgressHelpers): Promise<CandidateProgress> {
  const [claimed, progress, courses] = await Promise.all([
    supabase.from(TABLES.claimedSkills.table)
      .select('skill_key,skill_id,skill_name,claimed_at')
      .eq(TABLES.claimedSkills.owner, userId),
    supabase.from(TABLES.skillProgress.table)
      .select('skill_key,skill_id,skill_name,category_name,status,progress_percent,selected_resource_id,evidence_filename,evidence_uploaded_at,updated_at')
      .eq(TABLES.skillProgress.owner, userId),
    supabase.from(TABLES.courseCompletions.table)
      .select('resource_id,status,marked_at,evidence_id')
      .eq(TABLES.courseCompletions.owner, userId),
  ]);
  if (claimed.error) throw loadError('skills', claimed.error.message);
  if (progress.error) throw loadError('skill progress', progress.error.message);
  if (courses.error) throw loadError('course progress', courses.error.message);
  return {
    claimedSkills: Object.fromEntries(((claimed.data || []) as ClaimedSkillRow[])
      .filter((row) => row.skill_key && row.skill_name)
      .map((row) => [row.skill_key, rowToClaimedSkill(row)])),
    skillProgress: skillProgressFromRows((progress.data || []) as SkillProgressRow[], helpers),
    courseCompletions: Object.fromEntries(((courses.data || []) as CourseCompletionRow[])
      .filter((row) => row.resource_id)
      .map((row) => [row.resource_id, rowToCourseCompletion(row)])),
  };
}

export type ProgressChanges<T = ProgressItem> = { upserts: Record<string, T>; deletes: string[] };

/** What changed between the saved copy and the current one, compared as the rows that would be written. */
export function diffProgressPart(part: ProgressPart, saved: CandidateProgress, current: CandidateProgress): ProgressChanges {
  const toRow = ROW_OF[part];
  const upserts: Record<string, ProgressItem> = {};
  const savedPart: Record<string, ProgressItem> = saved[part];
  const currentPart: Record<string, ProgressItem> = current[part];
  Object.entries(currentPart).forEach(([key, value]) => {
    const before = savedPart[key];
    if (!before || JSON.stringify(toRow(key, before)) !== JSON.stringify(toRow(key, value))) upserts[key] = value;
  });
  const deletes = Object.keys(savedPart).filter((key) => !(key in currentPart));
  return { upserts, deletes };
}

export function hasProgressChanges(changes: ProgressChanges<unknown>): boolean {
  return changes.deletes.length > 0 || Object.keys(changes.upserts).length > 0;
}

/** The saved copy once one part's changes have been written. */
export function applyProgressChanges(saved: CandidateProgress, part: ProgressPart, changes: ProgressChanges): CandidateProgress {
  const next: Record<string, ProgressItem> = { ...saved[part], ...changes.upserts };
  changes.deletes.forEach((key) => { delete next[key]; });
  return { ...saved, [part]: next };
}

const PART_LABEL: Record<ProgressPart, string> = {
  claimedSkills: 'list of skills you already have',
  skillProgress: 'skill progress',
  courseCompletions: 'course progress',
};

/** Writes one part's changes. Throws with a message fit to show the candidate. */
export async function saveProgressChanges(userId: string, part: ProgressPart, changes: ProgressChanges): Promise<void> {
  const { table, owner, key } = TABLES[part];
  const toRow = ROW_OF[part];
  const rows = Object.entries(changes.upserts).map(([itemKey, value]) => ({ [owner]: userId, ...toRow(itemKey, value) }));
  if (rows.length > 0) {
    const { error } = await supabase.from(table).upsert(rows, { onConflict: `${owner},${key}` });
    if (error) throw new Error(`Unable to save your ${PART_LABEL[part]}: ${error.message}`);
  }
  if (changes.deletes.length > 0) {
    const { error } = await supabase.from(table).delete().eq(owner, userId).in(key, changes.deletes);
    if (error) throw new Error(`Unable to save your ${PART_LABEL[part]}: ${error.message}`);
  }
}

// Data saved by earlier versions of the dashboard in this browser only. It is
// read once, merged under what the account already has, and removed once saved.
export function legacyProgressStorageKeys(userKey: string): Record<ProgressPart, string> {
  return {
    claimedSkills: `kareerly.claimedSkills.${userKey}`,
    skillProgress: `kareerly.skillProgress.${userKey}`,
    courseCompletions: `kareerly.courseCompletions.${userKey}`,
  };
}

type StorageLike = Pick<Storage, 'getItem' | 'removeItem'>;

export function readLegacyProgress(storage: StorageLike | null | undefined, userKey: string): CandidateProgress {
  const keys = legacyProgressStorageKeys(userKey);
  const read = (storageKey: string) => {
    try {
      const parsed: unknown = JSON.parse(storage?.getItem(storageKey) || 'null');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  };
  // Old entries without a date are dated now, as the columns require one.
  const now = new Date().toISOString();
  const claimedSkills = Object.fromEntries(Object.entries(read(keys.claimedSkills) as Record<string, ClaimedSkill>)
    .filter(([, item]) => item && typeof item.skillName === 'string' && item.skillName.trim())
    .map(([key, item]) => [key, { ...item, claimedAt: item.claimedAt || now }]));
  const skillProgress = Object.fromEntries(Object.entries(read(keys.skillProgress) as Record<string, SkillProgressRecord>)
    .filter(([, item]) => item && typeof item.skillName === 'string' && item.skillName.trim() && SKILL_STATUSES.includes(item.status)));
  const courseCompletions = Object.fromEntries(Object.entries(read(keys.courseCompletions) as Record<string, CourseCompletion>)
    .filter(([, item]) => item && (item.status === 'completed' || item.status === 'evidenced'))
    .map(([key, item]) => [key, { ...item, markedAt: item.markedAt || now }]));
  return { claimedSkills, skillProgress, courseCompletions };
}

export function hasLegacyProgress(legacy: CandidateProgress): boolean {
  return PROGRESS_PARTS.some((part) => Object.keys(legacy[part]).length > 0);
}

export function clearLegacyProgress(storage: StorageLike | null | undefined, userKey: string): void {
  Object.values(legacyProgressStorageKeys(userKey)).forEach((storageKey) => {
    try {
      storage?.removeItem(storageKey);
    } catch {
      // Storage can be unavailable (private mode); nothing to clear then.
    }
  });
}

/**
 * What the dashboard shows after loading: the account's saved data wins; this
 * browser's old data fills in what the account lacks; anything already in
 * memory (records built from the current skill gaps) fills in the rest.
 */
export function mergeLoadedProgress<T>(current: Record<string, T>, legacy: Record<string, T>, saved: Record<string, T>): Record<string, T> {
  return { ...current, ...legacy, ...saved };
}

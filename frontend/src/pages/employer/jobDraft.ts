import { useMemo, useSyncExternalStore } from 'react';
import { emptyJobForm, MIN_EMPLOYER_SALARY, parseSalaryInput, toSalaryInputValue, type EmployerJob, type JobFormState } from './model';

/**
 * Unsaved work in the job editor, kept in this browser so leaving the page,
 * switching tabs or closing the window never loses it. Nothing here reaches
 * candidates: a job only changes through Save draft or Post job.
 */
export type JobEditorDraft = {
  form: JobFormState;
  requiredSkills: string[];
  niceSkills: string[];
  requiredSkillInput: string;
  niceSkillInput: string;
};

export type StoredJobDraft = JobEditorDraft & { savedAt: string };

const KEY_PREFIX = 'kareerly:employer-job-draft';

/** One slot per employer and job; '' is the new posting. */
export function jobDraftKey(employerId: string, jobId = ''): string {
  return `${KEY_PREFIX}:${employerId || 'anonymous'}:${jobId || 'new'}`;
}

export type JobLocation = { city: string; province: string };

/**
 * The editor's starting point: the saved job, or a blank posting placed where
 * the company is (from its profile) until the employer changes it.
 */
export function jobToDraft(job: EmployerJob | null, companyLocation: JobLocation = { city: '', province: '' }): JobEditorDraft {
  if (!job) {
    return {
      form: { ...emptyJobForm, city: companyLocation.city.trim(), province: companyLocation.province.trim() },
      requiredSkills: [],
      niceSkills: [],
      requiredSkillInput: '',
      niceSkillInput: '',
    };
  }
  return {
    form: {
      title: job.title,
      category: job.category,
      subcategory: job.subcategory,
      experienceLevel: job.experienceLevel,
      description: job.description,
      responsibilities: job.responsibilities.join('\n'),
      qualifications: job.qualifications.join('\n'),
      workSetup: job.workSetup,
      employmentType: job.employmentType,
      city: job.city,
      province: job.province,
      salaryRange: toSalaryInputValue(job.salaryRange),
      deadline: job.deadline,
      status: job.status,
    },
    requiredSkills: job.requiredSkills,
    niceSkills: job.niceToHaveSkills,
    requiredSkillInput: '',
    niceSkillInput: '',
  };
}

/** Comparable form of a draft, ignoring when it was saved. */
export function jobDraftSignature(draft: JobEditorDraft): string {
  return JSON.stringify([draft.form, draft.requiredSkills, draft.niceSkills, draft.requiredSkillInput, draft.niceSkillInput]);
}

/** Whether a new posting has anything worth keeping. */
export function hasJobDraftContent(draft: JobEditorDraft): boolean {
  const fields = (Object.keys(draft.form) as Array<keyof JobFormState>).filter((field) => field !== 'status');
  // An untouched salary is stored as "-".
  return fields.some((field) => draft.form[field].replace(/^-$/, '').trim() !== '')
    || draft.requiredSkills.length > 0
    || draft.niceSkills.length > 0
    || draft.requiredSkillInput.trim() !== ''
    || draft.niceSkillInput.trim() !== '';
}

/**
 * What blocks Save draft. Drafts stay hidden from candidates, so they can be
 * saved half-filled; the title is kept so the draft can be found again.
 */
export function validateDraftSave(draft: JobEditorDraft): string | null {
  return draft.form.title.trim() ? null : 'Add a job title to save a draft.';
}

/** What still blocks posting, or null when the job is ready. */
export function validateJobDraft(draft: JobEditorDraft): string | null {
  const { form } = draft;
  if (!form.title.trim()) return 'Add a job title.';
  if (!form.category.trim()) return 'Choose a category.';
  if (!form.subcategory.trim()) return 'Choose a sub-category.';
  if (!form.experienceLevel.trim()) return 'Choose an experience level.';
  if (!form.workSetup.trim()) return 'Choose a work setup.';
  if (!form.city.trim()) return 'Add the city or municipality.';
  if (!form.province.trim()) return 'Choose a province.';
  if (!form.deadline.trim()) return 'Set an application deadline.';
  if (!form.salaryRange.trim()) return 'Add a salary range.';
  const { minimum, maximum } = parseSalaryInput(form.salaryRange);
  if (!minimum || !maximum) return 'Enter both a minimum and a maximum salary.';
  if (minimum < MIN_EMPLOYER_SALARY) return `The minimum salary must be at least ₱${MIN_EMPLOYER_SALARY.toLocaleString('en-PH')}.`;
  if (maximum < minimum) return 'The maximum salary must be at least the minimum.';
  if (!form.description.trim()) return 'Add a short description of the role.';
  if (!form.responsibilities.trim()) return 'Add at least one responsibility.';
  if (draft.requiredSkills.length === 0) return 'Add at least one required skill.';
  return null;
}

/** Adds comma-separated skills, skipping ones already there (any case); null when nothing is new. */
export function addSkills(current: string[], raw: string): string[] | null {
  const seen = new Set(current.map((skill) => skill.toLowerCase()));
  const added: string[] = [];
  raw.split(',').map((skill) => skill.trim()).filter(Boolean).forEach((skill) => {
    if (seen.has(skill.toLowerCase())) return;
    seen.add(skill.toLowerCase());
    added.push(skill);
  });
  return added.length > 0 ? [...current, ...added] : null;
}

/** Reads a stored draft back, filling anything missing from the fallback form. */
export function parseJobDraft(raw: string | null, fallback: JobFormState): StoredJobDraft | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<StoredJobDraft> | null;
    if (!value || typeof value !== 'object' || !value.form || typeof value.form !== 'object') return null;
    const strings = (list: unknown) => (Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string') : []);
    const savedForm = value.form as Record<string, unknown>;
    const form = { ...fallback };
    (Object.keys(fallback) as Array<keyof JobFormState>).forEach((field) => {
      if (typeof savedForm[field] === 'string') (form as Record<string, string>)[field] = savedForm[field];
    });
    return {
      form,
      requiredSkills: strings(value.requiredSkills),
      niceSkills: strings(value.niceSkills),
      requiredSkillInput: typeof value.requiredSkillInput === 'string' ? value.requiredSkillInput : '',
      niceSkillInput: typeof value.niceSkillInput === 'string' ? value.niceSkillInput : '',
      savedAt: typeof value.savedAt === 'string' ? value.savedAt : '',
    };
  } catch {
    return null;
  }
}

// Storage can be unavailable (private windows, blocked site data); drafts then
// last only as long as the page.
const listeners = new Set<() => void>();

function rawJobDraft(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function readJobDraft(key: string, fallback: JobFormState): StoredJobDraft | null {
  return parseJobDraft(rawJobDraft(key), fallback);
}

export function writeJobDraft(key: string, draft: JobEditorDraft): void {
  try {
    window.localStorage.setItem(key, JSON.stringify({ ...draft, savedAt: new Date().toISOString() }));
  } catch {
    return;
  }
  listeners.forEach((listener) => listener());
}

export function clearJobDraft(key: string): void {
  if (rawJobDraft(key) === null) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    return;
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Another tab editing or posting the same draft.
  const onStorage = (event: StorageEvent) => {
    if (!event.key || event.key.startsWith(KEY_PREFIX)) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** The draft kept on this device under `key`, kept current as it changes. */
export function useStoredJobDraft(key: string): StoredJobDraft | null {
  const raw = useSyncExternalStore(subscribe, () => rawJobDraft(key), () => null);
  return useMemo(() => parseJobDraft(raw, emptyJobForm), [raw]);
}

/** "just now", "5 minutes ago", or a date, for when a draft was last kept. */
export function draftSavedLabel(savedAt: string, now = Date.now()): string {
  const time = Date.parse(savedAt);
  if (Number.isNaN(time)) return '';
  const minutes = Math.floor((now - time) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  return new Date(time).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
}

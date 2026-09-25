import type { JobMatchRunResults, ResumeAnalysisResult, SelectedSkill, SurveyAnswers } from '../types';

// A guest's Steps 1-4 live only in memory. They are kept here until the guest
// signs up or logs in, so the report can then be saved to the new account even
// when signing up needs an email confirmation that opens a new tab.
const STORAGE_KEY = 'kareerly.guestOnboarding';
// Long enough to confirm an email; short enough that a shared computer does not
// hand one guest's resume to whoever signs in days later.
export const GUEST_ONBOARDING_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type GuestOnboarding = {
  analysis: ResumeAnalysisResult;
  selectedSkills: SelectedSkill[];
  surveyAnswers: SurveyAnswers | null;
  matchResults: JobMatchRunResults | null;
  file: File | null;
};

type StoredFile = { name: string; type: string; base64: string };
type StoredGuestOnboarding = Omit<GuestOnboarding, 'file'> & { savedAt: number; file: StoredFile | null };

type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStorage(): KeyValueStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

async function encodeFile(file: File): Promise<StoredFile> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return { name: file.name, type: file.type, base64: btoa(binary) };
}

function decodeFile(stored: StoredFile): File {
  const binary = atob(stored.base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new File([bytes], stored.name, { type: stored.type });
}

function write(storage: KeyValueStorage, value: StoredGuestOnboarding): boolean {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** Keep a guest's report until they sign up or log in. Returns whether it was stored. */
export async function stashGuestOnboarding(
  data: GuestOnboarding,
  storage: KeyValueStorage | null = defaultStorage(),
  now = Date.now(),
): Promise<boolean> {
  if (!storage) return false;
  const base = {
    analysis: data.analysis,
    selectedSkills: data.selectedSkills,
    surveyAnswers: data.surveyAnswers,
    matchResults: data.matchResults,
    savedAt: now,
  };
  const file = data.file ? await encodeFile(data.file).catch(() => null) : null;
  // A resume too large for browser storage still leaves its analysis and report.
  return (file !== null && write(storage, { ...base, file })) || write(storage, { ...base, file: null });
}

export function readGuestOnboarding(
  storage: KeyValueStorage | null = defaultStorage(),
  now = Date.now(),
): GuestOnboarding | null {
  if (!storage) return null;
  let stored: StoredGuestOnboarding | null;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    stored = raw ? JSON.parse(raw) as StoredGuestOnboarding : null;
  } catch {
    stored = null;
  }
  if (!stored?.analysis || typeof stored.savedAt !== 'number' || now - stored.savedAt > GUEST_ONBOARDING_MAX_AGE_MS) {
    if (stored) clearGuestOnboarding(storage);
    return null;
  }
  let file: File | null;
  try {
    file = stored.file ? decodeFile(stored.file) : null;
  } catch {
    file = null;
  }
  return {
    analysis: stored.analysis,
    selectedSkills: Array.isArray(stored.selectedSkills) ? stored.selectedSkills : [],
    surveyAnswers: stored.surveyAnswers || null,
    matchResults: stored.matchResults || null,
    file,
  };
}

export function clearGuestOnboarding(storage: KeyValueStorage | null = defaultStorage()) {
  try {
    storage?.removeItem(STORAGE_KEY);
  } catch {
    // Storage may be blocked; nothing was kept then.
  }
}

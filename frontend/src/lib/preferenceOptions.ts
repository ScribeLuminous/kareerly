import { careerAreaOptions, confirmedSkillsInCareerArea, getCareerAreaLabel, maxJobLevel } from './careerAreas';
import type { CappedJobLevel, CareerAreaRules, JobLevelThresholds } from './careerAreas';
import { describeLocationPreference } from './regionPreference';
import type { SurveyAnswers } from '../types';

export type PreferenceOption = { value: string; label: string };

export const jobLevelOptions: PreferenceOption[] = [
  { value: 'entry', label: 'Entry-level (first job/junior)' },
  { value: 'mid', label: 'Mid-level (2-5 years experience)' },
  { value: 'senior', label: 'Senior (5+ years experience)' },
  { value: 'unsure', label: "I'm not sure" },
];

// Job levels from lowest to highest; "I'm not sure" is outside the order and never locked.
const JOB_LEVEL_ORDER = ['entry', 'mid', 'senior'];

export type JobLevelState = {
  /** The highest open level, or null when every level is open. */
  maxLevel: CappedJobLevel | null;
  /** Confirmed skills in the chosen area. */
  confirmedCount: number;
  /** The job level to keep selected. */
  role: string;
  /** Job levels shown but not selectable. */
  disabledValues: string[];
};

/**
 * The Step 3 job level for an area, capped by the confirmed skills in it (see
 * maxJobLevel). A locked selection falls to the highest open level; with only
 * entry-level open, entry-level is selected unless "I'm not sure" is.
 * Unlocking keeps whatever is selected and re-enables the levels.
 */
export function jobLevelState(
  industry: string,
  role: string,
  confirmedSkillIds: Array<string | null | undefined>,
  rules: CareerAreaRules | null,
): JobLevelState {
  const maxLevel = maxJobLevel(industry, confirmedSkillIds, rules);
  const confirmedCount = rules ? confirmedSkillsInCareerArea(industry, confirmedSkillIds, rules.areas).length : 0;
  if (!maxLevel) return { maxLevel, confirmedCount, role, disabledValues: [] };
  const disabledValues = JOB_LEVEL_ORDER.slice(JOB_LEVEL_ORDER.indexOf(maxLevel) + 1);
  const pickEntry = maxLevel === 'entry' && !role;
  return {
    maxLevel,
    confirmedCount,
    role: disabledValues.includes(role) || pickEntry ? maxLevel : role,
    disabledValues,
  };
}

function skills(count: number): string {
  return `${count} confirmed skill${count === 1 ? '' : 's'}`;
}

/**
 * The Step 3 note for a capped job level, split around the "Add skills in
 * Step 2" link: `${lead} Add skills in Step 2 ${tail}`. Null when every level is open.
 */
export function jobLevelLockNote(
  state: JobLevelState,
  areaLabel: string,
  thresholds: JobLevelThresholds,
): { lead: string; tail: string } | null {
  if (state.maxLevel === 'entry') {
    const reason = state.confirmedCount === 0
      ? `no confirmed skills in ${areaLabel} yet`
      : `only ${skills(state.confirmedCount)} in ${areaLabel}`;
    return {
      lead: `Locked to entry-level because you have ${reason}.`,
      tail: `to unlock other levels: mid-level needs ${thresholds.mid}, senior needs ${thresholds.senior}.`,
    };
  }
  if (state.maxLevel === 'mid') {
    return {
      lead: `Senior is locked because you have ${skills(state.confirmedCount)} in ${areaLabel}.`,
      tail: `to unlock it: senior needs ${thresholds.senior}.`,
    };
  }
  return null;
}

export const workSetupOptions: PreferenceOption[] = [
  { value: 'remote', label: '100% Work from Home' },
  { value: 'hybrid', label: 'Hybrid (mix of remote & office)' },
  { value: 'onsite', label: 'On-site (office only)' },
  { value: 'flexible', label: 'Flexible - no preference' },
];

export const salaryOptions: PreferenceOption[] = [
  { value: '15-35', label: 'PHP 15,000 - PHP 35,000/month' },
  { value: '35-50', label: 'PHP 35,001 - PHP 50,000/month' },
  { value: '50+', label: 'PHP 50,001 - more' },
  { value: 'unsure', label: "I'm not sure" },
];

// Ranges offered before, kept so reports generated with them still read well.
const legacySalaryOptions: PreferenceOption[] = [
  { value: '20-30', label: 'PHP 20,000 - PHP 30,000/month' },
  { value: '30-50', label: 'PHP 30,000 - PHP 50,000/month' },
  { value: '50-80', label: 'PHP 50,000 - PHP 80,000/month' },
  { value: '80+', label: 'PHP 80,000+/month' },
];

export const careerAreaPreferenceOptions: PreferenceOption[] = careerAreaOptions.map((option) => ({
  value: option.value,
  label: option.label,
}));

export type PreferenceSummaryItem = { label: string; value: string };

function optionLabel(options: PreferenceOption[], value: string): string {
  const trimmed = value.trim();
  return options.find((option) => option.value === trimmed.toLowerCase())?.label || trimmed;
}

/**
 * The Step 3 answers a report was generated with, keyed like SurveyAnswers.
 * The backend echoes the preferences it used, so the report never shows answers
 * that were changed afterwards without generating a new report.
 */
export function answersFromPreferencesUsed(preferences: unknown): SurveyAnswers | null {
  if (!preferences || typeof preferences !== 'object') return null;
  const record = preferences as Record<string, unknown>;
  const text = (...keys: string[]) => {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '';
  };
  const answers: SurveyAnswers = {
    industry: text('industry'),
    role: text('role_level', 'role', 'target_role'),
    setup: text('work_setup'),
    salary: text('salary_expectation', 'salary'),
    skill: text('skill_to_develop'),
  };
  // Present only on reports generated with the region question.
  const locationScope = text('location_scope');
  if (locationScope) {
    answers.locationScope = locationScope;
    answers.region = text('region');
  }
  return Object.values(answers).some(Boolean) ? answers : null;
}

/** User-facing lines for the answers given; an optional answer appears only when supplied. */
export function summarizePreferences(answers: SurveyAnswers | null | undefined): PreferenceSummaryItem[] {
  if (!answers) return [];
  const items: PreferenceSummaryItem[] = [];
  if (answers.industry?.trim()) items.push({ label: 'Career area', value: getCareerAreaLabel(answers.industry) });
  if (answers.role?.trim()) items.push({ label: 'Target job level', value: optionLabel(jobLevelOptions, answers.role) });
  if (answers.setup?.trim()) items.push({ label: 'Work setup', value: optionLabel(workSetupOptions, answers.setup) });
  if (answers.locationScope?.trim()) items.push({ label: 'Location', value: describeLocationPreference(answers) });
  if (answers.salary?.trim()) items.push({ label: 'Salary expectation', value: optionLabel([...salaryOptions, ...legacySalaryOptions], answers.salary) });
  if (answers.skill?.trim()) items.push({ label: 'Skill to develop', value: answers.skill.trim() });
  return items;
}

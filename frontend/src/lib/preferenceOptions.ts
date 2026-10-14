import { ENTRY_JOB_LEVEL, careerAreaOptions, getCareerAreaLabel, isJobLevelLocked } from './careerAreas';
import type { CareerAreaSkillMap } from './careerAreas';
import { describeLocationPreference } from './regionPreference';
import type { SurveyAnswers } from '../types';

export type PreferenceOption = { value: string; label: string };

export const jobLevelOptions: PreferenceOption[] = [
  { value: 'entry', label: 'Entry-level (first job/junior)' },
  { value: 'mid', label: 'Mid-level (2-5 years experience)' },
  { value: 'senior', label: 'Senior (5+ years experience)' },
  { value: 'unsure', label: "I'm not sure" },
];

export type JobLevelState = {
  /** True when the chosen area has none of the confirmed skills. */
  locked: boolean;
  /** The job level to keep selected. */
  role: string;
  /** Job levels shown but not selectable. */
  disabledValues: string[];
};

/**
 * The Step 3 job level for an area: locked to entry-level while the area has
 * no confirmed skills. Unlocking keeps whatever is selected (entry-level after
 * a lock) and re-enables every level.
 */
export function jobLevelState(
  industry: string,
  role: string,
  confirmedSkillIds: Array<string | null | undefined>,
  mapping: CareerAreaSkillMap | null,
): JobLevelState {
  const locked = isJobLevelLocked(industry, confirmedSkillIds, mapping);
  return {
    locked,
    role: locked ? ENTRY_JOB_LEVEL : role,
    disabledValues: locked ? jobLevelOptions.map((option) => option.value).filter((value) => value !== ENTRY_JOB_LEVEL) : [],
  };
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

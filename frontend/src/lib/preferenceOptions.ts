import { careerAreaOptions, getCareerAreaLabel } from './careerAreas';
import type { SurveyAnswers } from '../types';

export type PreferenceOption = { value: string; label: string };

export const jobLevelOptions: PreferenceOption[] = [
  { value: 'entry', label: 'Entry-level (first job/junior)' },
  { value: 'mid', label: 'Mid-level (2-5 years experience)' },
  { value: 'senior', label: 'Senior (5+ years experience)' },
  { value: 'unsure', label: "I'm not sure" },
];

export const workSetupOptions: PreferenceOption[] = [
  { value: 'remote', label: '100% Work from Home' },
  { value: 'hybrid', label: 'Hybrid (mix of remote & office)' },
  { value: 'onsite', label: 'On-site (office only)' },
  { value: 'flexible', label: 'Flexible - no preference' },
];

export const salaryOptions: PreferenceOption[] = [
  { value: '20-30', label: 'PHP 20,000 - PHP 30,000/month' },
  { value: '30-50', label: 'PHP 30,000 - PHP 50,000/month' },
  { value: '50-80', label: 'PHP 50,000 - PHP 80,000/month' },
  { value: '80+', label: 'PHP 80,000+/month' },
  { value: 'unsure', label: "I'm not sure" },
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
  return Object.values(answers).some(Boolean) ? answers : null;
}

/** User-facing lines for the answers given; an optional answer appears only when supplied. */
export function summarizePreferences(answers: SurveyAnswers | null | undefined): PreferenceSummaryItem[] {
  if (!answers) return [];
  const items: PreferenceSummaryItem[] = [];
  if (answers.industry?.trim()) items.push({ label: 'Career area', value: getCareerAreaLabel(answers.industry) });
  if (answers.role?.trim()) items.push({ label: 'Target job level', value: optionLabel(jobLevelOptions, answers.role) });
  if (answers.setup?.trim()) items.push({ label: 'Work setup', value: optionLabel(workSetupOptions, answers.setup) });
  if (answers.salary?.trim()) items.push({ label: 'Salary expectation', value: optionLabel(salaryOptions, answers.salary) });
  if (answers.skill?.trim()) items.push({ label: 'Skill to develop', value: answers.skill.trim() });
  return items;
}

import { useCallback, useEffect, useState } from 'react';
import { careerAreaOptions, getCareerAreaLabel, isLegacyCareerArea, normalizeCareerAreaValue } from '../../lib/careerAreas';
import type { SurveyAnswers } from '../../types';
import LocationPreferenceQuestion from '../../components/LocationPreferenceQuestion';
import type { LocationPreferenceValue } from '../../components/LocationPreferenceQuestion';
import { isLocationPreferenceComplete } from '../../lib/regionPreference';
import { normalizeSkill, salaryLabels, setupLabels } from './model';
import { FormField } from './common';

export function PreferencesPage({
  surveyAnswers,
  profileLocation,
  extraPreferences,
  skillNames,
  isLoading,
  onUpdateExtra,
  onUpdateSkills,
  onSave,
  onReset,
}: {
  surveyAnswers: SurveyAnswers;
  /** The saved profile location; undefined until account settings have loaded. */
  profileLocation: string | undefined;
  extraPreferences: { jobLevel: string; preferredLocation: string };
  skillNames: string[];
  isLoading: boolean;
  onUpdateExtra: (next: { jobLevel: string; preferredLocation: string }) => void;
  onUpdateSkills: (skills: string[]) => void;
  onSave: (answers: SurveyAnswers) => void;
  onReset: () => void;
}) {
  const [draft, setDraft] = useState<SurveyAnswers>(surveyAnswers);
  const [skillInput, setSkillInput] = useState('');

  useEffect(() => {
    setDraft(surveyAnswers);
  }, [surveyAnswers]);

  const updateLocation = useCallback((next: LocationPreferenceValue) => {
    setDraft((current) => ({ ...current, locationScope: next.locationScope, region: next.region }));
  }, []);

  const addSkill = () => {
    const next = skillInput.trim();
    if (!next) return;
    if (skillNames.some((item) => normalizeSkill(item) === normalizeSkill(next))) return;
    onUpdateSkills([...skillNames, next]);
    setSkillInput('');
  };

  const removeSkill = (value: string) => {
    const key = normalizeSkill(value);
    onUpdateSkills(skillNames.filter((item) => normalizeSkill(item) !== key));
  };

  return (
    <div>
      <div className="cand-page-header">
        <h1 className="cand-page-title">Career Preferences</h1>
        <p className="cand-page-subtitle">Refine your Aspiration-Based job matches and upskilling recommendations</p>
      </div>

      <div className="cand-card">
        <div className="cand-form-grid">
          <FormField label="Career Area of Interest">
            <select className="cand-form-select" value={normalizeCareerAreaValue(draft.industry)} onChange={(event) => setDraft((current) => ({ ...current, industry: event.target.value }))}>
              {/* A saved broad area from before the split stays selected until another is chosen. */}
              {isLegacyCareerArea(draft.industry) && (
                <option value={normalizeCareerAreaValue(draft.industry)}>{getCareerAreaLabel(draft.industry)} (saved choice)</option>
              )}
              {careerAreaOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </FormField>
          <FormField label="Target Role">
            <input className="cand-form-input" value={draft.role} onChange={(event) => setDraft((current) => ({ ...current, role: event.target.value }))} />
          </FormField>
          <FormField label="Job Level">
            <select
              className="cand-form-select"
              value={extraPreferences.jobLevel}
              onChange={(event) => onUpdateExtra({ ...extraPreferences, jobLevel: event.target.value })}
            >
              <option>Entry Level</option>
              <option>Junior</option>
              <option>Mid-Level</option>
              <option>Senior</option>
              <option>Trainee / Intern</option>
            </select>
          </FormField>
          <FormField label="Work Setup">
            <select className="cand-form-select" value={draft.setup} onChange={(event) => setDraft((current) => ({ ...current, setup: event.target.value }))}>
              {Object.entries(setupLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </FormField>
          <FormField label="Salary Expectation">
            <select className="cand-form-select" value={draft.salary} onChange={(event) => setDraft((current) => ({ ...current, salary: event.target.value }))}>
              {Object.entries(salaryLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </FormField>
        </div>

        <div className="mb-4">
          <LocationPreferenceQuestion
            scope={draft.locationScope}
            region={draft.region}
            onChange={updateLocation}
            isSignedIn
            profileLocation={profileLocation}
            name="dashboard-location-scope"
          />
        </div>

        <FormField label="Skill Development Interest">
          <textarea className="cand-form-textarea" value={draft.skill} onChange={(event) => setDraft((current) => ({ ...current, skill: event.target.value }))} />
        </FormField>

        <div className="cand-card mt-4 border border-amber bg-amber-l px-4 py-3 text-xs text-amber">
          Your career area decides which jobs appear as Aspiration matches; job level, work setup and salary order them. Fit-Now matches depend only on your resume and confirmed skills.
        </div>

        <div className="mt-4">
          <div className="mb-2 text-xs font-bold uppercase text-soft-text">Confirmed Skills</div>
          <div className="cand-skill-chip-grid">
            {skillNames.map((skill) => (
              <button key={skill} className="cand-skill-chip selected" type="button" onClick={() => removeSkill(skill)}>
                {skill} x
              </button>
            ))}
          </div>
          <div className="cand-skill-add-row">
            <input
              value={skillInput}
              className="cand-form-input"
              placeholder="Add a missing skill..."
              onChange={(event) => setSkillInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  addSkill();
                }
              }}
            />
            <button className="cand-btn-secondary" type="button" onClick={addSkill}>
              Add
            </button>
          </div>
        </div>

        <div className="cand-form-actions">
          <button className="cand-btn-primary" type="button" disabled={isLoading || !isLocationPreferenceComplete(draft)} onClick={() => onSave(draft)}>
            {isLoading ? 'Saving and Refreshing...' : 'Save Preferences'}
          </button>
          <button className="cand-btn-secondary" type="button" onClick={onReset}>
            Reset Changes
          </button>
        </div>
      </div>
    </div>
  );
}

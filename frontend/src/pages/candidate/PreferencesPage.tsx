import { useCallback, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faXmark } from '@fortawesome/free-solid-svg-icons';
import { careerAreaOptions, getCareerAreaLabel, isLegacyCareerArea, normalizeCareerAreaValue } from '../../lib/careerAreas';
import type { SurveyAnswers } from '../../types';
import LocationPreferenceQuestion from '../../components/LocationPreferenceQuestion';
import type { LocationPreferenceValue } from '../../components/LocationPreferenceQuestion';
import { isLocationPreferenceComplete } from '../../lib/regionPreference';
import { employmentTypeLabels, normalizeSkill, salaryLabels, setupLabels } from './model';
import { FormField, PageHeader } from './common';

type PreferencesPageProps = {
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
};

/** Keyed by the saved answers in the workspace, so a save or reset starts a fresh draft. */
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
}: PreferencesPageProps) {
  const [draft, setDraft] = useState<SurveyAnswers>(surveyAnswers);
  const [skillInput, setSkillInput] = useState('');
  // Skills and job level update the workspace straight away; they are saved with the form.
  const [touched, setTouched] = useState(false);

  const updateLocation = useCallback((next: LocationPreferenceValue) => {
    setDraft((current) => ({ ...current, locationScope: next.locationScope, region: next.region }));
  }, []);

  const addSkill = () => {
    const next = skillInput.trim();
    if (!next) return;
    if (skillNames.some((item) => normalizeSkill(item) === normalizeSkill(next))) return;
    onUpdateSkills([...skillNames, next]);
    setSkillInput('');
    setTouched(true);
  };

  const removeSkill = (value: string) => {
    const key = normalizeSkill(value);
    onUpdateSkills(skillNames.filter((item) => normalizeSkill(item) !== key));
    setTouched(true);
  };

  const dirty = touched || JSON.stringify(draft) !== JSON.stringify(surveyAnswers);
  const canSave = !isLoading && isLocationPreferenceComplete(draft);

  return (
    <div className="k-page k-page-narrow">
      <PageHeader title="Preferences" />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (canSave) onSave(draft);
        }}
      >
        <section className="k-section" aria-labelledby="pref-goal">
          <h2 id="pref-goal" className="k-section-title mb-3">What you want</h2>
          <div className="k-form-grid">
            <FormField label="Career area" help="Decides which jobs appear as Aspiration matches." className="k-span-2">
              <select className="k-select" value={normalizeCareerAreaValue(draft.industry)} onChange={(event) => setDraft((current) => ({ ...current, industry: event.target.value }))}>
                {/* A saved broad area from before the split stays selected until another is chosen. */}
                {isLegacyCareerArea(draft.industry) && (
                  <option value={normalizeCareerAreaValue(draft.industry)}>{getCareerAreaLabel(draft.industry)} (saved choice)</option>
                )}
                {careerAreaOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Target role">
              <input className="k-input" value={draft.role} autoComplete="organization-title" onChange={(event) => setDraft((current) => ({ ...current, role: event.target.value }))} />
            </FormField>
            <FormField label="Job level">
              <select
                className="k-select"
                value={extraPreferences.jobLevel}
                onChange={(event) => {
                  onUpdateExtra({ ...extraPreferences, jobLevel: event.target.value });
                  setTouched(true);
                }}
              >
                <option value="" disabled>Choose a level</option>
                <option>Entry Level</option>
                <option>Junior</option>
                <option>Mid-Level</option>
                <option>Senior</option>
                <option>Trainee / Intern</option>
              </select>
            </FormField>
          </div>
        </section>

        <section className="k-section" aria-labelledby="pref-conditions">
          <h2 id="pref-conditions" className="k-section-title mb-3">Where and how</h2>
          <div className="k-form-grid">
            <FormField label="Work Setup">
              <select className="k-select" value={draft.setup} onChange={(event) => setDraft((current) => ({ ...current, setup: event.target.value }))}>
                {Object.entries(setupLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Employment type">
              <select className="k-select" value={draft.employmentType || 'any'} onChange={(event) => setDraft((current) => ({ ...current, employmentType: event.target.value }))}>
                {Object.entries(employmentTypeLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Salary expectation">
              <select className="k-select" value={draft.salary} onChange={(event) => setDraft((current) => ({ ...current, salary: event.target.value }))}>
                {Object.entries(salaryLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </FormField>
          </div>
          <div className="mt-4">
            <LocationPreferenceQuestion
              scope={draft.locationScope}
              region={draft.region}
              onChange={updateLocation}
              isSignedIn
              profileLocation={profileLocation}
              name="dashboard-location-scope"
            />
          </div>
          <p className="k-help mt-3">Job level, work setup, employment type and salary order your Aspiration matches. Fit Now matches use only your resume and skills; a job that doesn't match a preference is marked, not hidden.</p>
        </section>

        <section className="k-section" aria-labelledby="pref-skills">
          <div className="k-section-head">
            <h2 id="pref-skills" className="k-section-title">Your skills</h2>
            <span className="k-meta">{skillNames.length}</span>
          </div>
          <ul className="k-chip-row gap-1.5" aria-label="Confirmed skills">
            {skillNames.map((skill) => (
              <li key={skill}>
                <span className="k-skill pr-1">
                  {skill}
                  <button className="inline-flex h-8 w-8 items-center justify-center rounded-full text-mid hover:bg-cream-d hover:text-dark" type="button" onClick={() => removeSkill(skill)} aria-label={`Remove ${skill}`}>
                    <FontAwesomeIcon icon={faXmark} className="h-3 w-3" aria-hidden="true" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex gap-2">
            <label className="min-w-0 flex-1">
              <span className="sr-only">Add a skill</span>
              <input
                value={skillInput}
                className="k-input"
                placeholder="Add a skill"
                onChange={(event) => setSkillInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addSkill();
                  }
                }}
              />
            </label>
            <button className="k-btn k-btn-secondary" type="button" onClick={addSkill} disabled={!skillInput.trim()}>Add</button>
          </div>
        </section>

        <section className="k-section" aria-labelledby="pref-growth">
          <h2 id="pref-growth" className="k-section-title mb-3">Development interest</h2>
          <FormField label="Skills you want to grow (optional)">
            <textarea className="k-textarea min-h-[88px]" value={draft.skill} onChange={(event) => setDraft((current) => ({ ...current, skill: event.target.value }))} />
          </FormField>
        </section>

        <div className={`k-savebar ${dirty ? '' : 'k-savebar-idle'}`}>
          <span className="k-meta mr-auto hidden sm:inline">{dirty ? 'Unsaved changes' : 'All changes saved'}</span>
          {dirty && (
            <button
              className="k-btn k-btn-ghost"
              type="button"
              onClick={() => {
                onReset();
                setDraft(surveyAnswers);
                setTouched(false);
              }}
            >
              Reset
            </button>
          )}
          <button className="k-btn k-btn-primary" type="submit" disabled={!canSave || !dirty}>
            {isLoading ? 'Saving…' : 'Save and refresh matches'}
          </button>
        </div>
      </form>
    </div>
  );
}

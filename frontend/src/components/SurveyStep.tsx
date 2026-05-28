import { useEffect, useMemo, useState } from 'react';
import {
  faArrowLeft,
  faArrowRight,
  faCirclePlus,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useOnboarding } from '../hooks/useOnboarding';
import type { SelectedSkill, SurveyAnswers } from '../types';
import { buildMatchPayloadFromAnalysis, runJobMatches, searchSkills } from '../lib/api';

type SurveyStepProps = {
  isLoggedIn: boolean;
};

const defaultAnswers: SurveyAnswers = {
  industry: '',
  role: '',
  setup: '',
  salary: '',
  skill: '',
};

const ONBOARDING_SKILL_LIMIT = 10;

function dedupeSkills(skills: SelectedSkill[]): SelectedSkill[] {
  const seen = new Set<string>();
  const cleaned: SelectedSkill[] = [];

  for (const skill of skills) {
    const skillId = skill.skill_id?.trim().toUpperCase();
    const skillName = skill.skill_name?.trim();
    if (!skillId || !skillName || seen.has(skillId)) continue;
    seen.add(skillId);
    cleaned.push({
      ...skill,
      skill_id: skillId,
      skill_name: skillName,
    });
  }

  return cleaned;
}

export default function SurveyStep({ isLoggedIn }: SurveyStepProps) {
  const {
    state,
    setSurveyAnswers,
    setSelectedSkills,
    setMatchResults,
    setLimitedReport,
    setLoading,
    setError,
    goToStep,
  } = useOnboarding();

  const [answers, setAnswers] = useState<SurveyAnswers>(state.surveyAnswers || defaultAnswers);
  const [skillQuery, setSkillQuery] = useState('');
  const [isSearchingSkills, setIsSearchingSkills] = useState(false);

  useEffect(() => {
    if (state.surveyAnswers) {
      setAnswers(state.surveyAnswers);
    }
  }, [state.surveyAnswers]);

  const isPreferencesComplete = Boolean(answers.industry && answers.role && answers.setup && answers.salary && answers.skill);
  const selectedSkills = state.selectedSkills || [];
  const displayedSkills = selectedSkills.slice(0, ONBOARDING_SKILL_LIMIT);
  const hiddenSkillCount = Math.max(0, selectedSkills.length - displayedSkills.length);
  const selectedSkillIds = selectedSkills.map((skill) => skill.skill_id);
  const extractedSkillIds = state.resumeAnalysis?.normalized_for_matching?.skill_ids || [];
  const canContinueToPreferences = Boolean(state.resumeAnalysis && (isLoggedIn ? selectedSkillIds.length > 0 : extractedSkillIds.length > 0));

  const selectedSkillIdSet = useMemo(() => new Set(selectedSkills.map((skill) => skill.skill_id)), [selectedSkills]);
  const extractedSkillIdSet = useMemo(() => new Set(extractedSkillIds), [extractedSkillIds]);
  const additionalSkills = useMemo(
    () => selectedSkills.filter((skill) => !extractedSkillIdSet.has(skill.skill_id)),
    [selectedSkills, extractedSkillIdSet],
  );

  const handleChange = (field: keyof SurveyAnswers, value: string) => {
    setAnswers((prev) => ({ ...prev, [field]: value }));
  };

  const handleContinueToPreferences = () => {
    if (!state.resumeAnalysis) {
      setError('Resume analysis is missing. Please go back to Step 1 and analyze your resume again.');
      return;
    }

    const resumeText = state.resumeAnalysis.normalized_for_matching?.resume_text_for_matching?.trim() || '';
    if (!resumeText) {
      setError('No resume text was returned for matching. Please upload and analyze your resume again.');
      return;
    }

    if (!canContinueToPreferences) {
      setError('No skills are available for matching yet.');
      return;
    }

    setError(null);
    goToStep(3);
  };

  const handleRunMatching = async () => {
    if (!state.resumeAnalysis) {
      setError('Resume analysis is missing. Please complete Steps 1 and 2 again.');
      return;
    }

    if (!isPreferencesComplete) {
      setError('Please answer all preference questions before generating your report.');
      return;
    }

    const finalCandidateSkillIds = isLoggedIn
      ? (selectedSkillIds.length > 0 ? selectedSkillIds : extractedSkillIds)
      : extractedSkillIds;

    if (finalCandidateSkillIds.length === 0) {
      setError('No skills were selected for matching. Please review your extracted skills first.');
      return;
    }

    setSurveyAnswers(answers);
    setLoading(true);
    setError(null);

    try {
      const payload = buildMatchPayloadFromAnalysis({
        analysis: state.resumeAnalysis,
        answers,
        userMode: isLoggedIn ? 'registered' : 'guest',
        viewMode: 'initial',
      });

      const results = await runJobMatches({
        ...payload,
        candidate_skill_ids: finalCandidateSkillIds,
      });

      setMatchResults(results);
      setLimitedReport(results.limited_report);
      goToStep(4);
    } catch (error) {
      setError(error instanceof Error ? `Job matching failed: ${error.message}` : 'Job matching failed.');
    } finally {
      setLoading(false);
    }
  };

  const removeSkill = (skillId: string) => {
    if (!isLoggedIn) return;
    setSelectedSkills(selectedSkills.filter((skill) => skill.skill_id !== skillId));
  };

  const addSkill = (skill: SelectedSkill) => {
    if (!isLoggedIn) return;
    if (!skill.skill_id) return;
    if (selectedSkillIdSet.has(skill.skill_id)) return;
    setSelectedSkills([...selectedSkills, skill]);
    setSkillQuery('');
  };

  const handleAddSkillFromQuery = async () => {
    if (!isLoggedIn || state.step !== 2) return;

    const query = skillQuery.trim();
    if (!query) {
      setError('Type a skill first before adding.');
      return;
    }

    setIsSearchingSkills(true);
    try {
      const response = await searchSkills(query);
      const results = dedupeSkills(
        (response.results || []).map((skill) => ({
          skill_id: skill.skill_id,
          skill_name: skill.skill_name,
          skill_category: skill.skill_category,
          skill_subcategory: skill.skill_subcategory,
        })),
      );
      const normalizedQuery = query.toLowerCase();
      const bestMatch = results.find(
        (skill) =>
          skill.skill_name.toLowerCase() === normalizedQuery ||
          skill.skill_id.toLowerCase() === normalizedQuery,
      ) || results[0];

      if (!bestMatch) {
        setError('No matching skills found. Try a different keyword.');
        return;
      }

      if (selectedSkillIdSet.has(bestMatch.skill_id)) {
        setError('That skill is already added.');
        return;
      }

      addSkill(bestMatch);
      setError(null);
    } catch {
      setError('Skill search failed. Please try again.');
    } finally {
      setIsSearchingSkills(false);
    }
  };

  if (state.step === 2) {
    return (
      <section className="mx-auto w-full max-w-5xl px-6 py-12">
        <div className="mb-8">
          <h2 className="font-display text-2xl font-bold text-dark mb-2">Step 2: Review Extracted Skills</h2>
          <p className="text-sm text-soft">Review up to 10 extracted skills before setting your preferences.</p>
        </div>

        {!state.resumeAnalysis && (
          <div className="mb-4 rounded-lg border border-red bg-red-l p-3 text-sm font-medium text-red">
            Resume analysis is missing. Go back to Step 1 and analyze your resume first.
          </div>
        )}

        {!isLoggedIn && (
          <div className="mb-4 rounded-lg border border-bdr bg-bg p-3 text-xs text-mid italic">
            Guest users can view extracted skills. Sign up or log in to edit your skills before matching.
          </div>
        )}

        <div className="mb-6 rounded-[28px] border border-bdr bg-card p-6 sm:p-8">
          <div className="text-sm font-bold text-dark mb-3">Selected skills for matching</div>

          {displayedSkills.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {displayedSkills.map((skill) => (
                <span
                  key={skill.skill_id}
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-semibold ${
                    isLoggedIn ? 'border-bdr bg-bg text-mid' : 'border-bdr bg-bg text-soft'
                  }`}
                  title={skill.skill_id}
                >
                  <span className="text-dark">{skill.skill_name || skill.skill_id}</span>
                  {!isLoggedIn ? null : (
                    <button
                      type="button"
                      onClick={() => removeSkill(skill.skill_id)}
                      className="ml-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full text-mid transition-colors hover:bg-white hover:text-rust"
                      aria-label={`Remove ${skill.skill_name}`}
                    >
                      <FontAwesomeIcon icon={faXmark} aria-hidden="true" />
                    </button>
                  )}
                </span>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-bdr bg-bg p-3 text-sm text-soft">
              No skills selected yet. {isLoggedIn ? 'Search and add skills below.' : 'Please try another resume file.'}
            </div>
          )}

          {hiddenSkillCount > 0 && (
            <div className="mt-3 text-xs text-soft">
              Showing 10 skills during onboarding. {hiddenSkillCount} additional skill{hiddenSkillCount === 1 ? '' : 's'} are kept for matching.
            </div>
          )}

          {isLoggedIn && (
            <div className="mt-6 border-t border-bdr pt-6">
              <div className="rounded-xl border border-bdr bg-bg p-4 sm:p-5">
                <div className="mb-3 flex items-center gap-2">
                  <FontAwesomeIcon className="text-amber text-base" icon={faCirclePlus} aria-hidden="true" />
                  <div className="text-base font-display font-bold text-dark sm:text-lg">Add missing skills</div>
                </div>

                <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input
                    value={skillQuery}
                    onChange={(event) => setSkillQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void handleAddSkillFromQuery();
                      }
                    }}
                    placeholder="e.g., Python, React, AWS"
                    className="flex-1 rounded-lg border border-bdr bg-white px-3 py-2.5 text-sm text-mid outline-none transition-colors placeholder:text-soft focus:border-rust"
                  />
                  <button
                    type="button"
                    onClick={() => void handleAddSkillFromQuery()}
                    disabled={isSearchingSkills}
                    className="inline-flex min-h-[42px] items-center justify-center rounded-lg bg-forest px-4 py-2.5 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 sm:min-w-[92px]"
                  >
                    {isSearchingSkills ? 'Adding...' : 'Add'}
                  </button>
                </div>

                {additionalSkills.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {additionalSkills.map((skill) => (
                      <span
                        key={skill.skill_id}
                        className="inline-flex items-center gap-2 rounded-full border border-bdr bg-white px-3 py-2 text-sm font-semibold text-mid"
                      >
                        <span className="text-dark">{skill.skill_name || skill.skill_id}</span>
                        <button
                          type="button"
                          onClick={() => removeSkill(skill.skill_id)}
                          className="inline-flex h-5 w-5 items-center justify-center rounded-full text-mid transition-colors hover:bg-bg hover:text-rust"
                          aria-label={`Remove ${skill.skill_name}`}
                        >
                          <FontAwesomeIcon icon={faXmark} aria-hidden="true" />
                        </button>
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-soft">No additional skills added yet.</div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-4 justify-between">
          <button
            onClick={() => goToStep(1)}
            className="flex-1 rounded-lg border border-bdr bg-white px-5 py-3.5 font-semibold text-mid transition-all hover:border-rust hover:text-rust"
          >
            <span className="inline-flex items-center gap-2">
              <FontAwesomeIcon icon={faArrowLeft} aria-hidden="true" />
              <span>Back</span>
            </span>
          </button>
          <button
            onClick={handleContinueToPreferences}
            disabled={!canContinueToPreferences || state.isLoading || !state.resumeAnalysis}
            className="flex-1 rounded-lg bg-rust px-5 py-3.5 font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="inline-flex items-center gap-2">
              <span>Next</span>
              <FontAwesomeIcon icon={faArrowRight} aria-hidden="true" />
            </span>
          </button>
        </div>

        {state.error && (
          <div className="mt-4 rounded-lg border border-red bg-red-l p-3 text-sm font-medium text-red">{state.error}</div>
        )}
      </section>
    );
  }

  return (
    <section className="max-w-lg mx-auto px-6 py-12">
      <div className="mb-7">
        <h2 className="font-display text-2xl font-bold text-dark mb-2">Step 3: Your Career Preferences</h2>
        <p className="text-sm text-soft">Tell us your goals so we can generate a personalized report.</p>
      </div>

      {!state.resumeAnalysis && (
        <div className="mb-4 rounded-lg border border-red bg-red-l p-3 text-sm font-medium text-red">
          Resume analysis is missing. Please complete Steps 1 and 2 first.
        </div>
      )}

      <div className="space-y-5 mb-6">
        <Question
          label="What industry interests you most?"
          name="industry"
          value={answers.industry}
          onChange={(value) => handleChange('industry', value)}
          options={[
            { value: 'tech', label: 'Technology & Software' },
            { value: 'finance', label: 'Finance & Banking' },
            { value: 'bpo', label: 'BPO & Customer Service' },
            { value: 'healthcare', label: 'Healthcare & Medical' },
            { value: 'other', label: 'Other' },
          ]}
        />
        <Question
          label="What job level are you targeting?"
          name="role"
          value={answers.role}
          onChange={(value) => handleChange('role', value)}
          options={[
            { value: 'entry', label: 'Entry-level (first job/junior)' },
            { value: 'mid', label: 'Mid-level (2-5 years experience)' },
            { value: 'senior', label: 'Senior (5+ years experience)' },
            { value: 'unsure', label: "I'm not sure" },
          ]}
        />
        <Question
          label="What's your work setup preference?"
          name="setup"
          value={answers.setup}
          onChange={(value) => handleChange('setup', value)}
          options={[
            { value: 'remote', label: '100% Work from Home' },
            { value: 'hybrid', label: 'Hybrid (mix of remote & office)' },
            { value: 'onsite', label: 'On-site (office only)' },
            { value: 'flexible', label: 'Flexible - no preference' },
          ]}
        />
        <Question
          label="What's your salary expectation?"
          name="salary"
          value={answers.salary}
          onChange={(value) => handleChange('salary', value)}
          options={[
            { value: '20-30', label: 'PHP 20,000 - PHP 30,000/month' },
            { value: '30-50', label: 'PHP 30,000 - PHP 50,000/month' },
            { value: '50-80', label: 'PHP 50,000 - PHP 80,000/month' },
            { value: '80+', label: 'PHP 80,000+/month' },
            { value: 'unsure', label: "I'm not sure" },
          ]}
        />
        <Question
          label="What's the top skill you want to develop?"
          name="skill"
          value={answers.skill}
          onChange={(value) => handleChange('skill', value)}
          options={[
            { value: 'technical', label: 'Technical Skills (Python, Cloud)' },
            { value: 'communication', label: 'Communication & English' },
            { value: 'business', label: 'Business & Finance' },
            { value: 'creative', label: 'Creative Skills' },
            { value: 'medical', label: 'Medical' },
            { value: 'hospitality', label: 'Hospitality' },
            { value: 'other', label: 'Other' },
          ]}
        />
      </div>

      <div className="flex gap-3 justify-between">
        <button
          onClick={() => goToStep(2)}
          className="flex-1 rounded-lg border border-bdr bg-white px-5 py-3.5 font-semibold text-mid transition-all hover:border-rust hover:text-rust"
        >
          <span className="inline-flex items-center gap-2">
            <FontAwesomeIcon icon={faArrowLeft} aria-hidden="true" />
            <span>Back</span>
          </span>
        </button>
        <button
          onClick={handleRunMatching}
          disabled={!isPreferencesComplete || state.isLoading || !state.resumeAnalysis}
          className="flex-1 rounded-lg bg-rust px-5 py-3.5 font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className="inline-flex items-center gap-2">
            <span>Generate Report</span>
            <FontAwesomeIcon icon={faArrowRight} aria-hidden="true" />
          </span>
        </button>
      </div>

      {state.error && (
        <div className="mt-4 rounded-lg border border-red bg-red-l p-3 text-sm font-medium text-red">{state.error}</div>
      )}
    </section>
  );
}

type QuestionProps = {
  label: string;
  name: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
};

function Question({ label, name, value, options, onChange }: QuestionProps) {
  return (
    <div className="rounded-xl border border-bdr bg-card p-5 transition-all hover:border-rust-m">
      <label className="mb-3.5 block text-sm font-semibold text-dark">{label}</label>
      <div className="space-y-2.5">
        {options.map((option) => (
          <label
            key={option.value}
            className="flex cursor-pointer items-center gap-3 rounded-lg border border-bdr bg-white p-3 transition-all hover:border-rust hover:bg-rust-l"
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={(event) => onChange(event.target.value)}
              className="cursor-pointer accent-rust"
            />
            <span className="text-sm font-medium text-mid">{option.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

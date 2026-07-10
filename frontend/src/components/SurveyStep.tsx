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
import { buildResumeAnalysisFromMatchResults, CONFIRMED_SKILL_LIMIT, runMatchesFromResume, searchSkills } from '../lib/api';
import { getCurrentKareerlyUser } from '../lib/auth';
import { saveMatchHistory } from '../lib/userData';

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

function dedupeSkills(skills: SelectedSkill[]): SelectedSkill[] {
  const seen = new Set<string>();
  const cleaned: SelectedSkill[] = [];

  for (const skill of skills) {
    const skillId = skill.skill_id?.trim().toUpperCase() || null;
    const skillName = skill.skill_name?.trim();
    const key = skillId || `custom:${skillName.toLowerCase()}`;
    if (!skillName || seen.has(key)) continue;
    seen.add(key);
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
    setResumeAnalysis,
    setMatchResults,
    setLimitedReport,
    setLoading,
    setError,
    goToStep,
  } = useOnboarding();

  const [answers, setAnswers] = useState<SurveyAnswers>(state.surveyAnswers || defaultAnswers);
  const [skillQuery, setSkillQuery] = useState('');
  const [isSearchingSkills, setIsSearchingSkills] = useState(false);
  const [skillSearchResults, setSkillSearchResults] = useState<SelectedSkill[]>([]);
  const [hasSearchedSkills, setHasSearchedSkills] = useState(false);

  useEffect(() => {
    if (state.surveyAnswers) {
      setAnswers(state.surveyAnswers);
    }
  }, [state.surveyAnswers]);

  const isPreferencesComplete = Boolean(answers.industry && answers.role && answers.setup && answers.salary);
  const selectedSkills = (state.selectedSkills || []).slice(0, CONFIRMED_SKILL_LIMIT);
  const selectedSkillCount = selectedSkills.length;
  const isSkillLimitReached = selectedSkillCount >= CONFIRMED_SKILL_LIMIT;
  const selectedSkillIds = selectedSkills.map((skill) => skill.skill_id).filter((skillId): skillId is string => Boolean(skillId));
  const extractedSkillIds = (state.resumeAnalysis?.normalized_for_matching?.skill_ids || []).slice(0, CONFIRMED_SKILL_LIMIT);
  const canContinueToPreferences = Boolean(state.resumeAnalysis && (isLoggedIn ? selectedSkills.length > 0 : extractedSkillIds.length > 0));

  const selectedSkillIdSet = useMemo(() => new Set(selectedSkills.map((skill) => skill.skill_id).filter(Boolean)), [selectedSkills]);
  const selectedSkillNameSet = useMemo(() => new Set(selectedSkills.map((skill) => skill.skill_name.trim().toLowerCase()).filter(Boolean)), [selectedSkills]);
  const extractedSkillIdSet = useMemo(() => new Set(extractedSkillIds), [extractedSkillIds]);
  const additionalSkills = useMemo(
    () => selectedSkills.filter((skill) => !skill.skill_id || !extractedSkillIdSet.has(skill.skill_id)),
    [selectedSkills, extractedSkillIdSet],
  );
  const trimmedSkillQuery = skillQuery.trim();
  const canAddCustomSkill = trimmedSkillQuery.length > 0 && !selectedSkillNameSet.has(trimmedSkillQuery.toLowerCase()) && !isSkillLimitReached;

  useEffect(() => {
    if (!isLoggedIn || state.step !== 2) return;

    const query = skillQuery.trim();
    if (query.length < 2) {
      setSkillSearchResults([]);
      setHasSearchedSkills(false);
      setIsSearchingSkills(false);
      return;
    }

    let isCurrent = true;
    setIsSearchingSkills(true);
    const timeoutId = window.setTimeout(() => {
      searchSkills(query, 10)
        .then((response) => {
          if (!isCurrent) return;
          const results = dedupeSkills(
            (response.results || []).map((skill) => ({
              skill_id: skill.skill_id,
              skill_name: skill.preferred_label || skill.skill_name,
              skill_category: skill.category || skill.skill_category,
              skill_subcategory: skill.skill_subcategory,
              source: 'manual_search',
              is_standardized: true,
              source_metadata: {
                matched_alias: skill.matched_alias,
              },
            })),
          );
          setSkillSearchResults(results);
          setHasSearchedSkills(true);
        })
        .catch(() => {
          if (!isCurrent) return;
          setSkillSearchResults([]);
          setHasSearchedSkills(true);
        })
        .finally(() => {
          if (isCurrent) setIsSearchingSkills(false);
        });
    }, 275);

    return () => {
      isCurrent = false;
      window.clearTimeout(timeoutId);
    };
  }, [isLoggedIn, skillQuery, state.step]);

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
    setSelectedSkills(selectedSkills);
    goToStep(3);
  };

  const handleRunMatching = async () => {
    if (!state.resumeAnalysis || !state.resumeFile) {
      setError('Resume analysis is missing. Please complete Steps 1 and 2 again.');
      return;
    }

    if (!isPreferencesComplete) {
      setError('Please answer all preference questions before generating your report.');
      return;
    }

    const finalCandidateSkillIds = isLoggedIn
      ? selectedSkillIds
      : extractedSkillIds;

    if ((isLoggedIn ? selectedSkills.length : finalCandidateSkillIds.length) === 0) {
      setError('No skills were selected for matching. Please review your extracted skills first.');
      return;
    }

    if (finalCandidateSkillIds.length > CONFIRMED_SKILL_LIMIT || selectedSkills.length > CONFIRMED_SKILL_LIMIT) {
      setError(`You can confirm up to ${CONFIRMED_SKILL_LIMIT} skills.`);
      return;
    }

    setSurveyAnswers(answers);
    setLoading(true);
    setError(null);

    try {
      const results = await runMatchesFromResume({
        resumeFile: state.resumeFile,
        userMode: isLoggedIn ? 'registered' : 'guest',
        viewMode: 'initial',
        confirmedSkills: isLoggedIn ? selectedSkills : [],
        preferences: {
          industry: answers.industry,
          target_role: answers.role,
          role_level: answers.role,
          work_setup: answers.setup,
          salary_expectation: answers.salary,
          skill_to_develop: answers.skill,
        },
      });

      setResumeAnalysis(buildResumeAnalysisFromMatchResults(results));
      setMatchResults(results);
      setLimitedReport(results.limited_report);
      const user = await getCurrentKareerlyUser().catch(() => null);
      if (user?.role === 'candidate') {
        await saveMatchHistory({
          userId: user.id,
          resumeId: state.savedResumeId,
          preferences: answers,
          results,
        });
      }
      goToStep(4);
    } catch (error) {
      setError(error instanceof Error ? `Job matching failed: ${error.message}` : 'Job matching failed.');
    } finally {
      setLoading(false);
    }
  };

  const getSkillKey = (skill: SelectedSkill) => skill.skill_id || `custom:${skill.skill_name.trim().toLowerCase()}`;

  const removeSkill = (skillKey: string) => {
    if (!isLoggedIn) return;
    setSelectedSkills(selectedSkills.filter((skill) => getSkillKey(skill) !== skillKey));
  };

  const addSkill = (skill: SelectedSkill) => {
    if (!isLoggedIn) return;
    const skillId = skill.skill_id?.trim().toUpperCase() || null;
    const skillName = skill.skill_name.trim();
    if (!skillName) return;
    if ((skillId && selectedSkillIdSet.has(skillId)) || selectedSkillNameSet.has(skillName.toLowerCase())) return;
    if (isSkillLimitReached) {
      setError(null);
      return;
    }
    setSelectedSkills([
      ...selectedSkills,
      {
        ...skill,
        skill_id: skillId,
        skill_name: skillName,
        source: skill.source || (skillId ? 'manual_search' : 'custom'),
        is_standardized: skill.is_standardized ?? Boolean(skillId),
        custom_skill_name: skillId ? undefined : skillName,
        source_metadata: {
          ...(skill.source_metadata || {}),
          added_from: 'skills_search',
        },
      },
    ]);
    setSkillQuery('');
    setSkillSearchResults([]);
    setHasSearchedSkills(false);
  };

  const addCustomSkill = () => {
    const customName = skillQuery.trim();
    if (!customName || selectedSkillNameSet.has(customName.toLowerCase()) || isSkillLimitReached) return;
    addSkill({
      skill_id: null,
      skill_name: customName,
      custom_skill_name: customName,
      source: 'custom',
      is_standardized: false,
      source_metadata: {
        added_from: 'custom_skill_autocomplete',
      },
    });
  };

  if (state.step === 2) {
    return (
      <section className="mx-auto w-full max-w-5xl px-6 py-12">
        <div className="mb-8">
          <h2 className="font-display text-2xl font-bold text-dark mb-2">Step 2: Review Extracted Skills</h2>
          <p className="text-sm text-soft">Your resume may contain many skills, so Kareerly selected the 20 most relevant skills for cleaner recommendations. You can remove skills and add others from the skill search.</p>
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
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm font-bold text-dark">Selected skills for matching</div>
            <div className={`rounded-full px-3 py-1 text-xs font-extrabold ${isSkillLimitReached ? 'bg-rust text-white' : 'bg-bg text-mid'}`}>
              {selectedSkillCount} / {CONFIRMED_SKILL_LIMIT} skills selected
            </div>
          </div>

          {selectedSkills.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {selectedSkills.map((skill) => (
                <span
                  key={getSkillKey(skill)}
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-semibold ${
                    isLoggedIn ? 'border-bdr bg-bg text-mid' : 'border-bdr bg-bg text-soft'
                  }`}
                  title={skill.is_standardized === false ? 'Custom skill — not yet standardized' : skill.skill_id || skill.skill_name}
                >
                  <span className="text-dark">{skill.skill_name || skill.skill_id}</span>
                  {skill.is_standardized === false && (
                    <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold uppercase text-soft" title="Custom skill — not yet standardized">
                      Custom
                    </span>
                  )}
                  {!isLoggedIn ? null : (
                    <button
                      type="button"
                      onClick={() => removeSkill(getSkillKey(skill))}
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

          {isLoggedIn && (
            <div className="mt-6 border-t border-bdr pt-6">
              <div className="rounded-xl border border-bdr bg-bg p-4 sm:p-5">
                <div className="mb-3 flex items-center gap-2">
                  <FontAwesomeIcon className="text-amber text-base" icon={faCirclePlus} aria-hidden="true" />
                  <div className="text-base font-display font-bold text-dark sm:text-lg">Add missing skills</div>
                </div>
                <div className="mb-3 text-sm text-soft">Search and add skills to improve your profile.</div>

                <div className="relative mb-4">
                  <input
                    value={skillQuery}
                    onChange={(event) => setSkillQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        if (skillSearchResults[0] && !isSkillLimitReached) {
                          addSkill(skillSearchResults[0]);
                        } else if (canAddCustomSkill && hasSearchedSkills) {
                          addCustomSkill();
                        }
                      }
                    }}
                    disabled={isSkillLimitReached}
                    placeholder="Search ESCO skills, e.g., Python, React, AWS"
                    className="w-full rounded-lg border border-bdr bg-white px-3 py-2.5 text-sm text-mid outline-none transition-colors placeholder:text-soft focus:border-rust disabled:cursor-not-allowed disabled:bg-bg disabled:text-soft"
                  />

                  {(isSearchingSkills || hasSearchedSkills || skillSearchResults.length > 0) && skillQuery.trim().length >= 2 && !isSkillLimitReached && (
                    <div className="absolute z-20 mt-2 max-h-72 w-full overflow-y-auto rounded-xl border border-bdr bg-white py-2 shadow-lg">
                      {isSearchingSkills && (
                        <div className="px-4 py-3 text-sm text-soft">Searching skills...</div>
                      )}

                      {!isSearchingSkills && skillSearchResults.length > 0 && (
                        <div>
                          {skillSearchResults.map((skill) => {
                            const alreadySelected = Boolean(skill.skill_id && selectedSkillIdSet.has(skill.skill_id)) || selectedSkillNameSet.has(skill.skill_name.trim().toLowerCase());
                            return (
                              <button
                                key={skill.skill_id || skill.skill_name}
                                type="button"
                                onClick={() => addSkill(skill)}
                                disabled={alreadySelected || isSkillLimitReached}
                                className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left text-sm transition-colors hover:bg-bg disabled:cursor-not-allowed disabled:opacity-50"
                                title={skill.skill_id || skill.skill_name}
                              >
                                <span>
                                  <span className="block font-semibold text-dark">{skill.skill_name}</span>
                                  {typeof skill.source_metadata?.matched_alias === 'string' && skill.source_metadata.matched_alias && (
                                    <span className="block text-xs text-soft">Matched alias: {skill.source_metadata.matched_alias}</span>
                                  )}
                                </span>
                                {alreadySelected ? <span className="text-xs font-bold text-soft">Added</span> : <FontAwesomeIcon className="mt-0.5 text-forest" icon={faCirclePlus} aria-hidden="true" />}
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {!isSearchingSkills && hasSearchedSkills && skillSearchResults.length === 0 && (
                        <div>
                          <div className="px-4 py-3 text-sm text-soft">No matching standardized skill found.</div>
                          {trimmedSkillQuery && !selectedSkillNameSet.has(trimmedSkillQuery.toLowerCase()) && (
                            <button
                              type="button"
                              onClick={addCustomSkill}
                              disabled={!canAddCustomSkill}
                              className="flex w-full items-center gap-2 border-t border-bdr px-4 py-3 text-left text-sm font-semibold text-forest transition-colors hover:bg-bg disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <FontAwesomeIcon icon={faCirclePlus} aria-hidden="true" />
                              <span>+ Add &quot;{trimmedSkillQuery}&quot; as a custom skill</span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {isSkillLimitReached && (
                  <div className="mb-4 rounded-lg border border-amber bg-amber-l p-3 text-xs font-medium text-mid">
                    You can keep up to 20 skills to keep your profile focused.
                  </div>
                )}

                {additionalSkills.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {additionalSkills.map((skill) => (
                      <span
                        key={getSkillKey(skill)}
                        className="inline-flex items-center gap-2 rounded-full border border-bdr bg-white px-3 py-2 text-sm font-semibold text-mid"
                      >
                        <span className="text-dark">{skill.skill_name || skill.skill_id}</span>
                        {skill.is_standardized === false && (
                          <span className="rounded-full bg-bg px-2 py-0.5 text-[10px] font-bold uppercase text-soft" title="Custom skill — not yet standardized">
                            Custom
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => removeSkill(getSkillKey(skill))}
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
          label="Which career area interests you most?"
          name="industry"
          value={answers.industry}
          onChange={(value) => handleChange('industry', value)}
          options={[
            { value: 'tech-business-finance', label: 'Technology, Data, Business & Finance' },
            { value: 'sales-marketing-service-creative', label: 'Sales, Marketing, Customer Service & Creative Media' },
            { value: 'education-healthcare-hospitality-community', label: 'Education, Healthcare, Hospitality & Community Services' },
            { value: 'engineering-manufacturing-agriculture-logistics', label: 'Engineering, Manufacturing, Agriculture, Logistics & Field Operations' },
            { value: 'public-service-legal-protective-other', label: 'Public Service, Legal, Protective Services & Other' },
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
            <span>{state.isLoading ? 'Analyzing resume and generating job matches…' : 'Generate Report'}</span>
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

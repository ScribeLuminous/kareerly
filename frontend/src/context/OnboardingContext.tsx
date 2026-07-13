import { useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import type { OnboardingState, SelectedSkill } from '../types';
import { OnboardingContext } from './OnboardingContextCore';
import type { OnboardingContextType } from './OnboardingContextCore';

type AnalysisResults = NonNullable<OnboardingState['results']>;
const CONFIRMED_SKILL_LIMIT = 20;

const initialState: OnboardingState = {
  step: 1,
  resume: null,
  resumeFile: null,
  resumeAnalysis: undefined,
  limitedReport: undefined,
  selectedSkills: [],
  surveyAnswers: null,
  isLoading: false,
  error: null,
  results: undefined,
  matchResults: undefined,
  savedResumeId: null,
};

export const OnboardingProvider = ({ children }: { children: ReactNode }) => {
  const [state, setState] = useState<OnboardingState>(initialState);

  const setResumeFile = useCallback((file: File | null) => {
    setState(prev => ({
      ...prev,
      resumeFile: file,
      resume: null,
      resumeAnalysis: undefined,
      results: undefined,
      matchResults: undefined,
      limitedReport: undefined,
      selectedSkills: [],
      savedResumeId: null,
    }));
  }, []);

  const setParsedResume: OnboardingContextType['setParsedResume'] = useCallback((data) => {
    setState(prev => ({ ...prev, resume: data }));
  }, []);

  const setSurveyAnswers: OnboardingContextType['setSurveyAnswers'] = useCallback((answers) => {
    setState(prev => ({ ...prev, surveyAnswers: answers }));
  }, []);

  const setSelectedSkills: OnboardingContextType['setSelectedSkills'] = useCallback((skills) => {
    setState(prev => ({ ...prev, selectedSkills: skills.slice(0, CONFIRMED_SKILL_LIMIT) }));
  }, []);

  const setResumeAnalysis: OnboardingContextType['setResumeAnalysis'] = useCallback((analysis) => {
    const extractedSkills: SelectedSkill[] = analysis
      ? [
          ...(analysis.candidate_profile?.skills || []).map((skill) => ({
            skill_id: skill.skill_id,
            skill_name: skill.skill_name,
            skill_category: skill.skill_category,
            skill_subcategory: skill.skill_subcategory,
            source: skill.source || 'resume_extracted',
            source_metadata: skill.source_metadata,
            skill_priority_score: skill.skill_priority_score,
          })),
          ...(analysis.normalized_for_matching?.skill_ids || []).map((skillId, index) => ({
            skill_id: skillId,
            skill_name: analysis.normalized_for_matching?.skill_names?.[index] || skillId,
            source: 'resume_extracted',
          })),
        ]
      : [];
    const dedupedSkills = Array.from(new Map(extractedSkills.filter((skill) => skill.skill_id).map((skill) => [skill.skill_id, skill])).values())
      .sort((a, b) => (Number(b.skill_priority_score || 0) - Number(a.skill_priority_score || 0)))
      .slice(0, CONFIRMED_SKILL_LIMIT);

    setState(prev => ({
      ...prev,
      resumeAnalysis: analysis,
      selectedSkills: dedupedSkills,
      resume: analysis
        ? {
            skills: (analysis.candidate_profile?.skills || []).slice(0, CONFIRMED_SKILL_LIMIT).map((skill) => ({ name: skill.skill_name })),
            education: [],
            experience: [],
            normalized_for_matching: {
              resume_text_for_matching: analysis.normalized_for_matching?.resume_text_for_matching || '',
            },
          }
        : null,
    }));
  }, []);

  const setResults = useCallback((results: AnalysisResults) => {
    setState(prev => ({ ...prev, results }));
  }, []);

  const setMatchResults: OnboardingContextType['setMatchResults'] = useCallback((results) => {
    setState(prev => ({
      ...prev,
      matchResults: results,
      limitedReport: results?.limited_report,
    }));
  }, []);

  const setLimitedReport: OnboardingContextType['setLimitedReport'] = useCallback((report) => {
    setState(prev => ({ ...prev, limitedReport: report }));
  }, []);

  const setSavedResumeId: OnboardingContextType['setSavedResumeId'] = useCallback((resumeId) => {
    setState(prev => ({ ...prev, savedResumeId: resumeId }));
  }, []);

  const goToStep = useCallback((step: 1 | 2 | 3 | 4) => {
    setState(prev => ({ ...prev, step }));
  }, []);

  const setLoading = useCallback((loading: boolean) => {
    setState(prev => ({ ...prev, isLoading: loading }));
  }, []);

  const setError = useCallback((error: string | null) => {
    setState(prev => ({ ...prev, error }));
  }, []);

  const reset = useCallback(() => {
    setState(initialState);
  }, []);

  const value: OnboardingContextType = {
    state,
    setResumeFile,
    setParsedResume,
    setSurveyAnswers,
    setSelectedSkills,
    setResumeAnalysis,
    setResults,
    setMatchResults,
    setLimitedReport,
    setSavedResumeId,
    goToStep,
    setLoading,
    setError,
    reset,
  };

  return (
    <OnboardingContext.Provider value={value}>
      {children}
    </OnboardingContext.Provider>
  );
};

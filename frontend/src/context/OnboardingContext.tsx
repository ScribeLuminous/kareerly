import { useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import type { OnboardingState } from '../types';
import { OnboardingContext } from './OnboardingContextCore';
import type { OnboardingContextType } from './OnboardingContextCore';

type AnalysisResults = NonNullable<OnboardingState['results']>;

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
    }));
  }, []);

  const setParsedResume: OnboardingContextType['setParsedResume'] = useCallback((data) => {
    setState(prev => ({ ...prev, resume: data }));
  }, []);

  const setSurveyAnswers: OnboardingContextType['setSurveyAnswers'] = useCallback((answers) => {
    setState(prev => ({ ...prev, surveyAnswers: answers }));
  }, []);

  const setSelectedSkills: OnboardingContextType['setSelectedSkills'] = useCallback((skills) => {
    setState(prev => ({ ...prev, selectedSkills: skills }));
  }, []);

  const setResumeAnalysis: OnboardingContextType['setResumeAnalysis'] = useCallback((analysis) => {
    const extractedSkills = analysis
      ? [
          ...(analysis.candidate_profile?.skills || []).map((skill) => ({
            skill_id: skill.skill_id,
            skill_name: skill.skill_name,
            skill_category: skill.skill_category,
            skill_subcategory: skill.skill_subcategory,
          })),
          ...(analysis.normalized_for_matching?.skill_ids || []).map((skillId, index) => ({
            skill_id: skillId,
            skill_name: analysis.normalized_for_matching?.skill_names?.[index] || skillId,
          })),
        ]
      : [];
    const dedupedSkills = Array.from(new Map(extractedSkills.filter((skill) => skill.skill_id).map((skill) => [skill.skill_id, skill])).values());

    setState(prev => ({
      ...prev,
      resumeAnalysis: analysis,
      selectedSkills: dedupedSkills,
      resume: analysis
        ? {
            skills: (analysis.candidate_profile?.skills || []).map((skill) => ({ name: skill.skill_name })),
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

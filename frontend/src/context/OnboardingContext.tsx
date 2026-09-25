import { useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import type { OnboardingState, SelectedSkill } from '../types';
import { OnboardingContext } from './OnboardingContextCore';
import type { OnboardingContextType } from './OnboardingContextCore';
import { readGuestOnboarding } from '../lib/guestOnboarding';

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

// A guest's report kept across a reload or the email-confirmation tab, so it can
// be saved once they sign up or log in (see App).
function restoredGuestState(): OnboardingState {
  const guest = readGuestOnboarding();
  if (!guest) return initialState;
  return {
    ...initialState,
    step: guest.matchResults ? 4 : 2,
    resumeFile: guest.file,
    resumeAnalysis: guest.analysis,
    selectedSkills: guest.selectedSkills.slice(0, CONFIRMED_SKILL_LIMIT),
    surveyAnswers: guest.surveyAnswers,
    matchResults: guest.matchResults || undefined,
    limitedReport: guest.matchResults?.limited_report,
    resume: {
      skills: (guest.analysis.candidate_profile?.skills || []).slice(0, CONFIRMED_SKILL_LIMIT).map((skill) => ({ name: skill.skill_name })),
      education: [],
      experience: [],
      normalized_for_matching: {
        resume_text_for_matching: guest.analysis.normalized_for_matching?.resume_text_for_matching || '',
      },
    },
  };
}

export const OnboardingProvider = ({ children }: { children: ReactNode }) => {
  const [state, setState] = useState<OnboardingState>(restoredGuestState);

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

  const restoreGuestReport = useCallback(() => {
    const restored = restoredGuestState();
    if (!restored.resumeAnalysis) return false;
    setState(restored);
    return true;
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
    restoreGuestReport,
  };

  return (
    <OnboardingContext.Provider value={value}>
      {children}
    </OnboardingContext.Provider>
  );
};

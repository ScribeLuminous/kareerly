import { createContext } from 'react';
import type { JobMatchRunResults, LimitedReport, OnboardingState, ParsedResume, ResumeAnalysisResult, SelectedSkill, SurveyAnswers } from '../types';

type AnalysisResults = NonNullable<OnboardingState['results']>;

export interface OnboardingContextType {
  state: OnboardingState;
  setResumeFile: (file: File | null) => void;
  setParsedResume: (data: ParsedResume) => void;
  setSurveyAnswers: (answers: SurveyAnswers) => void;
  setSelectedSkills: (skills: SelectedSkill[]) => void;
  setResumeAnalysis: (analysis: ResumeAnalysisResult | undefined) => void;
  setResults: (results: AnalysisResults) => void;
  setMatchResults: (results: JobMatchRunResults | undefined) => void;
  setLimitedReport: (report: LimitedReport | undefined) => void;
  goToStep: (step: 1 | 2 | 3 | 4) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

export const OnboardingContext = createContext<OnboardingContextType | undefined>(undefined);

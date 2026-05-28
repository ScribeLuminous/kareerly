// User & Profile
export interface User {
  id: string;
  email: string;
  createdAt: Date;
}

export interface UserProfile {
  id: string;
  userId: string;
  industry: string;
  targetRole: string;
  workSetup: string;
  salaryExpectation: string;
  topSkillToDevelop: string;
  updatedAt: Date;
}

// Resume
export interface Resume {
  id: string;
  userId: string;
  fileName: string;
  parsedData: ParsedResume;
  createdAt: Date;
  updatedAt: Date;
}

export interface ParsedResume {
  skills: Skill[];
  education: Education[];
  experience: WorkExperience[];
  rawText?: string;
  raw_text?: string;
  cleanedText?: string;
  cleaned_text?: string;
  normalized_for_matching?: {
    resume_text_for_matching?: string;
  };
}

export interface ResumeAnalysisSkill {
  skill_id: string;
  skill_name: string;
  skill_category?: string;
  skill_subcategory?: string;
  matched_text?: string;
  source_section?: string;
  confidence?: number;
  method?: string;
}

export interface SelectedSkill {
  skill_id: string;
  skill_name: string;
  skill_category?: string;
  skill_subcategory?: string;
}

export interface ResumeAnalysisResult {
  status: string;
  raw_text_length: number;
  sections_detected: {
    skills: boolean;
    education: boolean;
    certifications: boolean;
    experience: boolean;
  };
  candidate_profile: {
    full_name?: string;
    skills: ResumeAnalysisSkill[];
    education_indicators: string[];
    certification_indicators: string[];
    experience_indicators: string[];
  };
  normalized_for_matching: {
    skill_ids: string[];
    skill_names: string[];
    resume_text_for_matching: string;
  };
  warnings: string[];
  parsedResume: ParsedResume;
  jobMatches: JobMatch[];
  skillGaps: SkillGap[];
  courseRecommendations: CourseRecommendation[];
  summary?: {
    totalMatches: number;
    topMatchTitle: string;
    topMatchScore: number;
    totalSkillGaps: number;
    totalCourses: number;
  };
}

export interface Skill {
  name: string;
  level?: 'beginner' | 'intermediate' | 'advanced';
  yearsOfExperience?: number;
}

export interface Education {
  institution: string;
  degree: string;
  field: string;
  graduationYear: number;
}

export interface WorkExperience {
  company: string;
  position: string;
  description?: string;
  startYear: number;
  endYear?: number;
  isCurrent: boolean;
}

// Job Matching
export interface JobMatch {
  id: string;
  jobId: string;
  title: string;
  company: string;
  matchScore: number;
  immediateMatch: boolean;
  aspirationalMatch: boolean;
  requiredSkills: string[];
  missingSkills: string[];
  createdAt: Date;
}

// Skill Gap
export interface SkillGap {
  id: string;
  skill: string;
  importance: 'critical' | 'high' | 'medium' | 'low';
  frequency: number; // How many target jobs require this
  targetRole?: string;
  createdAt: Date;
}

// Course / Learning
export interface Course {
  id: string;
  title: string;
  provider: string;
  skillsTargeted: string[];
  duration?: string;
  certificateAvailable: boolean;
  isFree: boolean;
  url?: string;
  difficulty?: 'beginner' | 'intermediate' | 'advanced';
}

export interface CourseRecommendation {
  id: string;
  courseId: string;
  course: Course;
  matchedSkillGaps: string[];
  recommendationScore: number;
  createdAt: Date;
}

// Survey
export interface SurveyAnswers {
  industry: string;
  role: string;
  setup: string;
  salary: string;
  skill: string;
}

export interface MatchResultItem {
  job_id: string;
  job_title: string;
  company?: string;
  location?: string;
  job_category?: string;
  job_subcategory?: string;
  work_type?: string;
  source_dataset?: string;
  required_skill_ids?: string;
  required_skills?: string;
  skill_gap_reliability?: string;
  text_similarity?: number;
  skill_coverage?: number;
  matched_skill_ids?: string[];
  missing_skill_ids?: string[];
  fit_now_score?: number;
  fit_now_percentage?: number;
  aspiration_score?: number;
  aspiration_percentage?: number;
  match_score?: number | string;
  fit_score?: number | string;
  score?: number | string;
  role_or_industry_preference?: number;
  work_setup_preference?: number;
  match_percentage?: number;
  matched_skills?: string[];
  missing_skills?: string[];
  explanation?: string;
}

export interface PrioritizedSkillGap {
  skill_id?: string;
  skill_name: string;
  skill_category?: string;
  skill_subcategory?: string;
  appears_in_top_matches?: number;
  missing_count?: number;
  severity: 'Critical' | 'High' | 'Moderate' | string;
  related_jobs?: string[];
}

export interface LearningRecommendation {
  resource_id: string;
  title: string;
  description: string;
  provider: string;
  provider_type: string;
  resource_type: string;
  level: string;
  language: string;
  delivery_mode: string;
  cost_type: string;
  estimated_duration: string;
  matched_gap_skill_ids: string[];
  skills_youll_gain: string;
  certification_score: number;
  recommendation_percentage: number;
  url: string;
}

export interface MatchAccessControl {
  user_mode: 'guest' | 'registered' | 'logged_in';
  view_mode: 'initial' | 'full';
  access_label: string;
  job_limit_per_match_type: number;
  skill_gap_limit: number;
  learning_recommendation_limit: number;
  guest_note: string;
}

export interface LimitedReport {
  fit_now_matches: MatchResultItem[];
  aspiration_matches: MatchResultItem[];
  skill_gaps: PrioritizedSkillGap[];
  learning_recommendations: LearningRecommendation[];
}

export interface JobMatchRunResults {
  fit_now_matches: MatchResultItem[];
  aspiration_matches: MatchResultItem[];
  skill_gaps: PrioritizedSkillGap[];
  learning_recommendations: LearningRecommendation[];
  access_control: MatchAccessControl;
  limited_report: LimitedReport;
  warnings?: string[];
  prioritized_skill_gaps?: PrioritizedSkillGap[];
  metadata?: {
    model_version?: string;
    total_jobs_scored?: number;
    method?: string;
  };
}

// Onboarding
export interface OnboardingState {
  step: 1 | 2 | 3 | 4;
  resume: ParsedResume | null;
  resumeFile: File | null;
  resumeAnalysis?: ResumeAnalysisResult;
  limitedReport?: LimitedReport;
  selectedSkills: SelectedSkill[];
  surveyAnswers: SurveyAnswers | null;
  isLoading: boolean;
  error: string | null;
  results?: {
    jobMatches: JobMatch[];
    skillGaps: SkillGap[];
    courseRecommendations: CourseRecommendation[];
    summary?: {
      totalMatches: number;
      topMatchTitle: string;
      topMatchScore: number;
      totalSkillGaps: number;
      totalCourses: number;
    };
  };
  matchResults?: JobMatchRunResults;
}

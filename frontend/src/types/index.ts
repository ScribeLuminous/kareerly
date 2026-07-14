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
  skill_id: string | null;
  skill_name: string;
  skill_category?: string;
  skill_subcategory?: string;
  matched_text?: string;
  source_section?: string;
  confidence?: number;
  method?: string;
  source?: 'resume_extracted' | 'manual_search' | 'confirmed_skill' | 'custom' | string;
  custom_skill_name?: string;
  is_standardized?: boolean;
  source_metadata?: Record<string, unknown>;
  skill_priority_score?: number;
}

export interface SelectedSkill {
  skill_id: string | null;
  skill_name: string;
  skill_category?: string;
  skill_subcategory?: string;
  source?: 'resume_extracted' | 'manual_search' | 'confirmed_skill' | 'custom' | string;
  custom_skill_name?: string;
  is_standardized?: boolean;
  source_metadata?: Record<string, unknown>;
  skill_priority_score?: number;
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
    education?: Array<{
      highest_educational_attainment: string;
      degree_program: string;
      school_university: string;
      year_graduated: string;
    }>;
    certifications?: Array<{
      title: string;
      issuer: string;
      year: string;
    }>;
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
  extracted_skills?: ResumeAnalysisSkill[];
  resume_text_preview?: string;
  model_used?: string;
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
  employment_type?: string;
  job_level?: string;
  salary_range_monthly_php?: string;
  job_description?: string;
  description?: string;
  responsibilities?: string[] | string;
  external_job_link_optional?: string;
  job_url?: string;
  job_source?: 'internal' | 'employer';
  source_dataset?: string;
  required_skill_ids?: string;
  must_have_skill_ids?: string;
  required_skills?: string;
  preferred_skills?: string;
  skill_gap_reliability?: string;
  text_similarity?: number | string;
  skill_coverage?: number | string;
  matched_skill_ids?: string[];
  missing_skill_ids?: string[];
  fit_now_score?: number | string;
  fit_now_percentage?: number | string;
  aspiration_score?: number | string;
  aspiration_percentage?: number | string;
  match_score?: number | string;
  fit_score?: number | string;
  employer_alignment_score?: number | string;
  employer_alignment_percentage?: number | string;
  overall_match_score?: number | string;
  overall_match_percentage?: number | string;
  score?: number | string;
  role_or_industry_preference?: number;
  work_setup_preference?: number;
  match_percentage?: number | string;
  matched_skills?: string[];
  missing_skills?: string[];
  explanation?: string;
}

export interface PrioritizedSkillGap {
  skill_id?: string;
  skill_name: string;
  skill_category?: string;
  skill_subcategory?: string;
  category_id?: string;
  category_name?: string;
  appears_in_top_matches?: number | string;
  missing_count?: number | string;
  affected_job_count?: number | string;
  match_percentage?: number | string;
  missing_percentage?: number | string;
  skill_gap_percentage?: number | string;
  affected_match_percentage?: number | string;
  frequency_score?: number | string;
  gap_severity_score?: number | string;
  priority_score?: number | string;
  requirement_importance?: string;
  requirement_importance_score?: number | string;
  preference_relevance_score?: number | string;
  learning_resource_available?: boolean;
  learning_resource_availability_score?: number | string;
  severity: 'Critical' | 'High' | 'Moderate' | string;
  related_jobs?: string[];
  affected_jobs?: string[];
  recommended_learning_resources?: LearningRecommendation[];
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
  category_name?: string;
  semantic_or_keyword_relevance?: number;
  gap_skill_name?: string;
  why_recommended?: string;
}

export interface DevelopmentProgressRecord {
  category_name?: string;
  category?: string;
  progress_score?: number | string;
  progress_percentage?: number | string;
  progress_percent?: number | string;
  percentage?: number | string;
  progress_label?: string;
  skill_records?: string[];
  related_skill_records?: string[];
  related_skills?: string[];
  missing_skills?: string[];
  covered_skills?: string[];
  supporting_evidence?: number | string;
  completed_learning?: number | string;
  in_progress_count?: number | string;
  completed_count?: number | string;
  evidence_uploaded_count?: number | string;
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
  development_progress?: DevelopmentProgressRecord[];
}

export interface JobMatchRunResults {
  fit_now_matches: MatchResultItem[];
  aspiration_matches: MatchResultItem[];
  all_fit_now_matches?: MatchResultItem[];
  all_aspiration_matches?: MatchResultItem[];
  total_qualifying_matches?: number | string;
  skill_gaps: PrioritizedSkillGap[];
  learning_recommendations: LearningRecommendation[];
  access_control: MatchAccessControl;
  limited_report: LimitedReport;
  warnings?: string[];
  prioritized_skill_gaps?: PrioritizedSkillGap[];
  development_progress?: DevelopmentProgressRecord[];
  extracted_skills?: ResumeAnalysisSkill[];
  debug_summary?: {
    extracted_skill_count?: number;
    extracted_skill_names?: string[];
    total_jobs_loaded?: number;
    total_jobs_scored?: number;
    fit_now_count?: number;
    aspiration_count?: number;
    top_10_scores?: Array<{
      job_title?: string;
      semantic_score?: number | string;
      skill_coverage?: number | string;
      matched_skills?: string[];
      missing_skills?: string[];
      final_score?: number | string;
      match_type?: string;
    }>;
  };
  resume_text_preview?: string;
  model_used?: string;
  metadata?: {
    model_version?: string;
    total_jobs_scored?: number;
    method?: string;
    jobs_source?: string;
    learning_resources_source?: string;
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
  savedResumeId?: string | null;
}

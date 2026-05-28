from typing import List, Literal, Optional

from pydantic import BaseModel, Field


class SkillItem(BaseModel):
    skill_id: str
    skill_name: str
    skill_category: Optional[str] = None
    skill_subcategory: Optional[str] = None
    matched_text: Optional[str] = None
    source_section: Optional[str] = None
    confidence: float = 0.0
    method: str = ""


class CandidateProfile(BaseModel):
    full_name: str = ""
    skills: List[SkillItem] = []
    education_indicators: List[str] = []
    certification_indicators: List[str] = []
    experience_indicators: List[str] = []


class AnalyzeResponse(BaseModel):
    status: str
    raw_text_length: int
    sections_detected: dict
    candidate_profile: CandidateProfile
    normalized_for_matching: dict
    warnings: List[str] = []


class MatchPreferences(BaseModel):
    industry: str = ""
    target_role: str = ""
    role: str = ""
    work_setup: str = ""
    salary: str = ""
    salary_expectation: str = ""
    skill_to_develop: str = ""


class RunMatchesRequest(BaseModel):
    user_mode: Literal["guest", "registered", "logged_in"] = "guest"
    view_mode: Literal["initial", "full"] = "initial"
    resume_text_for_matching: str = Field(min_length=1)
    candidate_skill_ids: List[str] = []
    preferences: MatchPreferences = Field(default_factory=MatchPreferences)

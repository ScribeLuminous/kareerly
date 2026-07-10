from __future__ import annotations

import ast
import os
import re
from collections import Counter
from functools import lru_cache
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Any, Iterable

import numpy as np
import pandas as pd
import requests
from docx import Document
from pypdf import PdfReader
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity


BASE_DIR = Path(__file__).resolve().parent
DATA_PATH = BASE_DIR / "jobs_record.csv"
DISPLAY_MARKET = "Philippines"
TOP_N = 5

REQUIRED_COLUMNS = ["job_title", "job_skills", "job_type_skills"]
OPTIONAL_DISPLAY_COLUMNS = [
    "job_title_short",
    "company_name",
    "job_location",
    "job_country",
    "job_schedule_type",
    "job_work_from_home",
    "salary_year_avg",
]

FALLBACK_JOBS = [
    {
        "job_title": "Junior Web Developer",
        "company_name": "Kareerly Demo Jobs",
        "job_country": "Philippines",
        "job_skills": "['html', 'css', 'javascript', 'react', 'git']",
        "job_type_skills": "frontend web development responsive design api integration",
    },
    {
        "job_title": "Data Analyst",
        "company_name": "Kareerly Demo Jobs",
        "job_country": "Philippines",
        "job_skills": "['python', 'sql', 'excel', 'power bi', 'tableau']",
        "job_type_skills": "analytics dashboard reporting data cleaning business intelligence",
    },
    {
        "job_title": "Customer Support Specialist",
        "company_name": "Kareerly Demo Jobs",
        "job_country": "Philippines",
        "job_skills": "['english communication', 'customer service', 'crm', 'problem solving']",
        "job_type_skills": "bpo support tickets chat email voice communication",
    },
    {
        "job_title": "Cloud Support Associate",
        "company_name": "Kareerly Demo Jobs",
        "job_country": "Philippines",
        "job_skills": "['linux', 'cloud', 'aws', 'networking', 'troubleshooting']",
        "job_type_skills": "cloud operations infrastructure support technical documentation",
    },
    {
        "job_title": "Machine Learning Assistant",
        "company_name": "Kareerly Demo Jobs",
        "job_country": "Philippines",
        "job_skills": "['python', 'machine learning', 'pandas', 'numpy', 'scikit-learn']",
        "job_type_skills": "model training data preprocessing experiments evaluation",
    },
]

COURSE_CATALOG = pd.DataFrame(
    [
        {"skill": "python", "title": "Python Programming Basics", "provider": "DICT / Online Platform", "isFree": True},
        {"skill": "sql", "title": "SQL for Data Analysis", "provider": "Online Platform", "isFree": True},
        {"skill": "excel", "title": "Excel for Workplace Analytics", "provider": "TESDA / Online Platform", "isFree": True},
        {"skill": "tableau", "title": "Data Visualization with Tableau", "provider": "Online Platform", "isFree": False},
        {"skill": "power bi", "title": "Power BI Dashboard Development", "provider": "Online Platform", "isFree": True},
        {"skill": "machine learning", "title": "Machine Learning Foundations", "provider": "Online Platform", "isFree": True},
        {"skill": "react", "title": "React Frontend Development", "provider": "Online Platform", "isFree": True},
        {"skill": "cloud", "title": "Cloud Fundamentals", "provider": "AWS / Online Platform", "isFree": True},
        {"skill": "english communication", "title": "Workplace English Communication", "provider": "TESDA / Online Platform", "isFree": True},
    ]
)

CURATED_RESUME_SKILLS: dict[str, list[str]] = {
    "AI Data Labeling": ["ai data labeling", "data labeling", "data annotation", "image annotation", "text annotation"],
    "Subtitle Transcription": ["subtitle transcription", "subtitle editing", "captioning", "closed captioning"],
    "Transcription": ["transcription", "transcribing", "audio transcription"],
    "Video Editing": ["video editing", "video/photo editing", "edit video", "editing videos"],
    "Photo Editing": ["photo editing", "image editing", "edit photos", "editing photos"],
    "QA Testing": ["qa testing", "quality assurance testing", "software testing", "app testing"],
    "Playtesting": ["playtesting", "game testing", "game playtesting"],
    "Bug Reporting": ["bug reporting", "bug reports", "detecting bugs", "detectingbugs", "defect reporting"],
    "MS Office": ["ms office", "microsoft office"],
    "Excel": ["excel", "microsoft excel"],
    "Spreadsheets": ["spreadsheet", "spreadsheets", "google sheets"],
    "Google Workspace": ["google workspace", "google docs", "google drive", "gmail"],
    "Python": ["python"],
    "React": ["react", "reactjs", "react.js"],
    "SQL": ["sql"],
}

SHORT_AMBIGUOUS_SKILLS = {"c", "r"}


def clean_text(value: Any) -> str:
    if pd.isna(value):
        return ""
    text = str(value)
    text = re.sub(
        r"(?<![A-Za-z])(?:[A-Za-z] ){2,}[A-Za-z](?![A-Za-z])",
        lambda match: match.group(0).replace(" ", ""),
        text,
    )
    return re.sub(r"\s+", " ", text.strip().lower())


def parse_skill_list(value: Any) -> list[str]:
    if pd.isna(value):
        return []

    if isinstance(value, list):
        raw_items = value
    else:
        text = str(value).strip()
        if not text:
            return []
        try:
            parsed = ast.literal_eval(text)
            raw_items = parsed if isinstance(parsed, list) else [text]
        except (SyntaxError, ValueError):
            raw_items = re.split(r",|;|\|", text)

    return sorted({clean_text(item) for item in raw_items if clean_text(item)})


def skills_to_text(skills: Iterable[str]) -> str:
    return " ".join(clean_text(skill) for skill in skills if clean_text(skill))


def load_jobs_dataset() -> pd.DataFrame:
    if DATA_PATH.exists():
        df = pd.read_csv(DATA_PATH)
    else:
        df = pd.DataFrame(FALLBACK_JOBS)

    for column in REQUIRED_COLUMNS:
        if column not in df.columns:
            df[column] = ""

    df = df.reset_index(drop=True)
    df["job_id"] = df.index
    return df


def prepare_features(df: pd.DataFrame) -> tuple[pd.DataFrame, set[str]]:
    df = df.copy()
    for column in REQUIRED_COLUMNS:
        df[column] = df[column].fillna("")

    df["skills_list"] = df["job_skills"].apply(parse_skill_list)
    df["skills_text"] = df["skills_list"].apply(skills_to_text)
    df["combined_text"] = (
        df["job_title"].map(clean_text)
        + " "
        + df["skills_text"].map(clean_text)
        + " "
        + df["job_type_skills"].map(clean_text)
    ).str.strip()

    skill_vocabulary = {skill for skills in df["skills_list"] for skill in skills}
    return df, skill_vocabulary


def train_tfidf_matcher(combined_text: Iterable[str]) -> tuple[TfidfVectorizer, Any]:
    vectorizer = TfidfVectorizer(
        stop_words="english",
        max_features=50_000,
        ngram_range=(1, 2),
        min_df=1,
    )
    x_jobs = vectorizer.fit_transform(combined_text)
    return vectorizer, x_jobs


def load_skills_reference() -> set[str]:
    """Load an optional skills reference CSV from project files/ and return a set of normalized skill strings."""
    skills_path = BASE_DIR.parent / "files" / "skills_reference.csv"
    if not skills_path.exists():
        return set()

    try:
        ref_df = pd.read_csv(skills_path, dtype=str)
    except Exception:
        return set()

    collected: set[str] = set()
    cols = [
        "skill_name",
        "esco_preferred_label",
        "esco_alternative_labels",
        "related_skills",
    ]
    for col in cols:
        if col not in ref_df.columns:
            continue
        for val in ref_df[col].fillna(""):
            for part in re.split(r";|,|\||/", str(val)):
                s = clean_text(part)
                if s:
                    collected.add(s)
    return collected


@lru_cache(maxsize=1)
def get_model_resources() -> tuple[pd.DataFrame, set[str], TfidfVectorizer, Any]:
    df = load_jobs_dataset()
    df, skill_vocabulary = prepare_features(df)
    
    try:
        skills_ref = load_skills_reference()
        if skills_ref:
            skill_vocabulary = set(skill_vocabulary) | set(skills_ref)
    except Exception:
        pass

    vectorizer, x_jobs = train_tfidf_matcher(df["combined_text"])
    return df, skill_vocabulary, vectorizer, x_jobs


def extract_resume_text(file_path: Path, filename: str) -> str:
    suffix = Path(filename).suffix.lower()
    if suffix == ".pdf":
        reader = PdfReader(str(file_path))
        return "\n".join(page.extract_text() or "" for page in reader.pages)
    if suffix == ".docx":
        document = Document(str(file_path))
        return "\n".join(paragraph.text for paragraph in document.paragraphs)
    raise ValueError("Unsupported file type. Please upload a PDF or DOCX file.")


def has_short_skill_context(skill: str, normalized_resume: str) -> bool:
    if skill == "c":
        return bool(
            re.search(r"\bc\s*(programming|language|developer|development)\b", normalized_resume)
            or re.search(r"\bprogramming languages?\s*[:\-]?\s*[^.\n]{0,80}\bc\b", normalized_resume)
            or re.search(r"\bc\s*,\s*c\+\+\b", normalized_resume)
        )
    if skill == "r":
        return bool(
            re.search(r"\br\s*(programming|language|studio|developer|development)\b", normalized_resume)
            or re.search(r"\bprogramming languages?\s*[:\-]?\s*[^.\n]{0,80}\br\b", normalized_resume)
            or re.search(r"\b(statistical|statistics|data science|analytics)\s+[^.\n]{0,80}\br\b", normalized_resume)
        )
    return True


def extract_curated_resume_skills(normalized_resume: str) -> set[str]:
    found: set[str] = set()
    for canonical_name, aliases in CURATED_RESUME_SKILLS.items():
        for alias in aliases:
            alias_text = clean_text(alias)
            if re.search(rf"(?<!\w){re.escape(alias_text)}(?!\w)", normalized_resume):
                found.add(clean_text(canonical_name))
                break
    return found


def extract_user_skills(resume_text: str, skill_vocabulary: set[str], declared_skills: Iterable[str]) -> list[str]:
    normalized_resume = f" {clean_text(resume_text)} "
    found = {
        skill
        for skill in skill_vocabulary
        if skill not in SHORT_AMBIGUOUS_SKILLS
        and len(skill) > 1
        and f" {skill} " in normalized_resume
    }
    for short_skill in SHORT_AMBIGUOUS_SKILLS:
        if f" {short_skill} " in normalized_resume and has_short_skill_context(short_skill, normalized_resume):
            found.add(short_skill)

    found.update(extract_curated_resume_skills(normalized_resume))
    found.update(clean_text(skill) for skill in declared_skills if clean_text(skill) and clean_text(skill) != "other")
    return sorted(found)


def preferences_to_text(preferences: dict[str, Any]) -> str:
    parts = [
        preferences.get("industry", ""),
        preferences.get("role", ""),
        preferences.get("setup", ""),
        preferences.get("salary", ""),
        preferences.get("skill", ""),
    ]
    return clean_text(" ".join(str(part) for part in parts))


def rank_jobs(query_text: str, df: pd.DataFrame, vectorizer: TfidfVectorizer, x_jobs: Any, top_n: int) -> pd.DataFrame:
    query_vector = vectorizer.transform([clean_text(query_text)])
    similarities = cosine_similarity(query_vector, x_jobs).flatten()
    top_indices = np.argsort(similarities)[::-1][:top_n]

    display_cols = ["job_id", "job_title", "job_skills"] + [
        col for col in OPTIONAL_DISPLAY_COLUMNS if col in df.columns
    ]
    results = df.iloc[top_indices][display_cols + ["skills_list"]].copy()
    results["match_score"] = similarities[top_indices]
    return results.reset_index(drop=True)


def build_skill_gaps(job_matches: list[dict[str, Any]]) -> list[dict[str, Any]]:
    missing_counter: Counter[str] = Counter()
    for match in job_matches:
        missing_counter.update(match["missingSkills"])

    gaps = []
    for index, (skill, frequency) in enumerate(missing_counter.most_common(8), start=1):
        if frequency >= 3:
            importance = "critical"
        elif frequency == 2:
            importance = "high"
        else:
            importance = "medium"

        gaps.append(
            {
                "id": f"gap-{index}",
                "skill": skill,
                "importance": importance,
                "frequency": frequency,
                "targetRole": job_matches[0]["title"] if job_matches else None,
                "createdAt": pd.Timestamp.utcnow().isoformat(),
            }
        )
    return gaps


def google_search(query: str, num: int = 3) -> list[dict[str, str]]:
    api_key = os.getenv("GOOGLE_CSE_API_KEY")
    search_engine_id = os.getenv("GOOGLE_CSE_ID")
    if not api_key or not search_engine_id:
        return []

    response = requests.get(
        "https://www.googleapis.com/customsearch/v1",
        params={"key": api_key, "cx": search_engine_id, "q": query, "num": num},
        timeout=8,
    )
    response.raise_for_status()
    items = response.json().get("items", [])
    return [
        {
            "title": item.get("title", ""),
            "link": item.get("link", ""),
            "snippet": item.get("snippet", ""),
        }
        for item in items
    ]


def recommend_courses(missing_skills: Iterable[str], use_live_search: bool = False) -> list[dict[str, Any]]:
    cleaned_missing = [clean_text(skill) for skill in missing_skills if clean_text(skill)]
    recommendations: list[dict[str, Any]] = []

    for index, skill in enumerate(cleaned_missing[:8], start=1):
        catalog_match = COURSE_CATALOG[COURSE_CATALOG["skill"].apply(clean_text).eq(skill)]
        if not catalog_match.empty:
            course = catalog_match.iloc[0].to_dict()
            title = str(course["title"])
            provider = str(course["provider"])
            is_free = bool(course["isFree"])
            url = None
        else:
            title = f"{skill.title()} Fundamentals"
            provider = "Online Platform"
            is_free = True
            url = None

        if use_live_search:
            live_results = google_search(f"{skill} free certification course Philippines online", num=1)
            if live_results:
                title = live_results[0]["title"] or title
                provider = "Google Programmable Search"
                url = live_results[0]["link"] or None

        recommendations.append(
            {
                "id": f"course-rec-{index}",
                "courseId": f"course-{index}",
                "course": {
                    "id": f"course-{index}",
                    "title": title,
                    "provider": provider,
                    "skillsTargeted": [skill],
                    "certificateAvailable": True,
                    "isFree": is_free,
                    "url": url,
                    "difficulty": "beginner",
                },
                "matchedSkillGaps": [skill],
                "recommendationScore": max(100 - (index - 1) * 8, 50),
                "createdAt": pd.Timestamp.utcnow().isoformat(),
            }
        )
    return recommendations


def analyze_resume_file(file_bytes: bytes, filename: str, preferences: dict[str, Any]) -> dict[str, Any]:
    with NamedTemporaryFile(delete=False, suffix=Path(filename).suffix) as temp_file:
        temp_file.write(file_bytes)
        temp_path = Path(temp_file.name)

    try:
        resume_text = clean_text(extract_resume_text(temp_path, filename))
    finally:
        temp_path.unlink(missing_ok=True)

    df, skill_vocabulary, vectorizer, x_jobs = get_model_resources()

    # allow 'skill' preference to be a comma/semicolon/pipe separated list of declared skills
    raw_declared = preferences.get("skill", "")
    if isinstance(raw_declared, str):
        declared_skills = [clean_text(s) for s in re.split(r",|;|\||/", raw_declared) if clean_text(s)]
    elif isinstance(raw_declared, (list, tuple)):
        declared_skills = [clean_text(s) for s in raw_declared if clean_text(s)]
    else:
        declared_skills = []

    user_skills = extract_user_skills(resume_text, skill_vocabulary, declared_skills)
    query_text = " ".join([resume_text, skills_to_text(user_skills), preferences_to_text(preferences)])
    ranked_jobs = rank_jobs(query_text, df, vectorizer, x_jobs, TOP_N)

    job_matches = []
    for _, row in ranked_jobs.iterrows():
        required_skills = list(row["skills_list"])
        missing_skills = [skill for skill in required_skills if skill not in user_skills]
        match_score = round(float(row["match_score"]) * 100, 1)
        job_matches.append(
            {
                "id": f"match-{int(row['job_id'])}",
                "jobId": str(int(row["job_id"])),
                "title": str(row.get("job_title_short") or row.get("job_title") or "Recommended Role"),
                "company": str(row.get("company_name") or "Available Employer"),
                "matchScore": match_score,
                "immediateMatch": match_score >= 65,
                "aspirationalMatch": match_score < 65,
                "requiredSkills": required_skills,
                "missingSkills": missing_skills,
                "createdAt": pd.Timestamp.utcnow().isoformat(),
            }
        )

    skill_gaps = build_skill_gaps(job_matches)
    all_missing = [gap["skill"] for gap in skill_gaps]
    course_recommendations = recommend_courses(
        all_missing,
        use_live_search=str(preferences.get("useGoogleSearch", "")).lower() == "true",
    )

    top_match = job_matches[0] if job_matches else None
    return {
        "parsedResume": {
            "skills": [{"name": skill} for skill in user_skills],
            "education": [],
            "experience": [],
            "rawText": resume_text[:4000],
            "normalized_for_matching": {
                "resume_text_for_matching": resume_text,
            },
        },
        "jobMatches": job_matches,
        "skillGaps": skill_gaps,
        "courseRecommendations": course_recommendations,
        "summary": {
            "totalMatches": len(job_matches),
            "topMatchTitle": top_match["title"] if top_match else "No match found",
            "topMatchScore": top_match["matchScore"] if top_match else 0,
            "totalSkillGaps": len(skill_gaps),
            "totalCourses": len(course_recommendations),
        },
    }

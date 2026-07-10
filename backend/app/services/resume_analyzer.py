import re
from typing import Dict, List

from .skill_extractor import SkillExtractor
from .resume_parser import (
    extract_resume_text,
    clean_resume_text,
    normalize_for_matching,
)


def compact_text(value: str) -> str:
    if not value:
        return ""
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def spaced_word_pattern(word: str) -> str:
    """
    Converts 'skills' into a regex that can match:
    skills
    s k i l l s
    S K I L L S
    """
    letters = [re.escape(char) for char in word.lower()]
    return r"\s*".join(letters)


def contains_flexible_keyword(text: str, keywords: List[str]) -> bool:
    if not text:
        return False

    text_lower = text.lower()
    text_compact = compact_text(text)

    for keyword in keywords:
        keyword_lower = keyword.lower().strip()
        keyword_compact = compact_text(keyword_lower)

        if keyword_lower in text_lower:
            return True

        if keyword_compact and keyword_compact in text_compact:
            return True

        pattern = spaced_word_pattern(keyword_lower)
        if re.search(pattern, text_lower, re.IGNORECASE):
            return True

    return False


SECTION_HEADINGS = [
    r"skills?",
    r"technical skills?",
    r"key skills",
    r"competenc",
    r"education",
    r"educational background",
    r"academic",
    r"certificat",
    r"licenses?",
    r"training",
    r"courses?",
    r"experience",
    r"work experience",
    r"professional experience",
    r"employment history",
    r"internship",
    r"projects?",
]

NAME_BLOCKLIST_TERMS = {
    "academic",
    "administrative",
    "assistant",
    "bachelor",
    "certification",
    "computer",
    "curriculum",
    "education",
    "engineer",
    "experience",
    "manager",
    "objective",
    "profile",
    "resume",
    "science",
    "skills",
    "summary",
    "training",
    "virtual",
    "vitae",
    "website",
}


def normalize_person_name(name: str) -> str:
    if not name:
        return ""

    compact = re.sub(r"[^A-Za-z\s\-']", " ", name)
    compact = re.sub(r"\s+", " ", compact).strip()
    if not compact:
        return ""

    def normalize_token(token: str) -> str:
        pieces = re.split(r"([\-'])", token.lower())
        return "".join(piece.capitalize() if piece not in {"-", "'"} else piece for piece in pieces)

    return " ".join(normalize_token(token) for token in compact.split(" ") if token)


def decode_letter_spaced_line(line: str) -> str:
    if not line:
        return ""

    word_tokens = re.findall(r"[A-Za-z]+", line)
    if not word_tokens:
        return ""

    single_character_tokens = sum(1 for token in word_tokens if len(token) == 1)
    if single_character_tokens / max(len(word_tokens), 1) < 0.70:
        return ""

    groups = [group.strip() for group in re.split(r"\s{2,}", line.strip()) if group.strip()]
    if len(groups) < 2:
        return ""

    decoded_words = []
    for group in groups:
        compact_word = re.sub(r"[^A-Za-z]", "", group)
        if compact_word:
            decoded_words.append(compact_word)

    if len(decoded_words) < 2:
        return ""

    return " ".join(decoded_words)


def is_plausible_person_name(value: str) -> bool:
    if not value:
        return False

    words = value.split()
    if len(words) < 2 or len(words) > 4:
        return False

    normalized_words = []
    for word in words:
        if not re.fullmatch(r"[A-Za-z][A-Za-z\-']*[A-Za-z]|[A-Za-z]", word):
            return False
        normalized_words.append(word.lower())

    if any(word in NAME_BLOCKLIST_TERMS for word in normalized_words):
        return False

    alpha_chars = re.sub(r"[^A-Za-z]", "", value)
    if len(alpha_chars) < 4:
        return False

    return True


def extract_candidate_full_name(raw_text: str, cleaned_text: str) -> str:
    raw_lines = raw_text.splitlines() if raw_text else []
    cleaned_lines = cleaned_text.splitlines() if cleaned_text else []
    candidates = raw_lines[:20] + cleaned_lines[:20]

    for line in candidates:
        source_line = line.strip()
        if not source_line:
            continue

        source_lower = source_line.lower()
        if any(marker in source_lower for marker in ["@", "http", "www", ".com", "linkedin"]):
            continue

        if re.search(r"\d", source_line):
            continue

        decoded = decode_letter_spaced_line(source_line)
        candidate_name = normalize_person_name(decoded or source_line)

        if is_plausible_person_name(candidate_name):
            return candidate_name

    return ""


def detect_resume_sections(resume_text: str) -> Dict[str, str]:
    heading_pattern = re.compile(
        r"^\s*(?P<h>(" + "|".join(SECTION_HEADINGS) + r"))\s*:?\s*$",
        re.IGNORECASE | re.MULTILINE,
    )

    positions = [
        (match.start(), match.end(), match.group("h").strip())
        for match in heading_pattern.finditer(resume_text)
    ]

    if not positions:
        return {"full_text": resume_text}

    positions.append((len(resume_text), len(resume_text), "end"))

    sections = {}

    for index in range(len(positions) - 1):
        start = positions[index][1]
        end = positions[index + 1][0]
        heading = positions[index][2]

        section_text = resume_text[start:end].strip()

        if not section_text:
            continue

        section_key = heading.lower()
        section_key = re.sub(r"\s+", " ", section_key)

        sections[section_key] = section_text

    sections["full_text"] = resume_text

    return sections


def extract_education_indicators(resume_text: str) -> List[str]:
    keywords = [
        "bachelor",
        "master",
        "phd",
        "degree",
        "diploma",
        "college",
        "university",
        "undergraduate",
        "computer science",
        "engineering",
    ]

    return [
        keyword
        for keyword in keywords
        if contains_flexible_keyword(resume_text, [keyword])
    ]


def extract_certification_indicators(resume_text: str) -> List[str]:
    keywords = [
        "certificate",
        "certification",
        "certified",
        "training",
        "course",
        "tesda",
        "coursera",
        "udemy",
        "edx",
        "cisco",
        "ibm skillsbuild",
    ]

    return [
        keyword
        for keyword in keywords
        if contains_flexible_keyword(resume_text, [keyword])
    ]


def extract_experience_indicators(resume_text: str) -> List[str]:
    indicators = []

    normal_patterns = [
        r"\d+\s+years?",
        r"\d+\s+months?",
    ]

    for pattern in normal_patterns:
        if re.search(pattern, resume_text, re.IGNORECASE):
            indicators.append(pattern)

    keywords = [
        "experience",
        "worked",
        "employed",
        "internship",
        "project",
        "responsibilities",
        "customer support",
        "virtual assistant",
        "executive assistant",
        "part time work experience",
        "full time work experience",
        "long term work experience",
    ]

    for keyword in keywords:
        if contains_flexible_keyword(resume_text, [keyword]):
            indicators.append(keyword)

    return indicators


def analyze_resume_file(file_path: str, skill_extractor: SkillExtractor) -> Dict:
    try:
        raw_text = extract_resume_text(file_path)
    except Exception as exc:
        raise ValueError(f"Could not extract readable text from resume: {exc}") from exc

    cleaned = clean_resume_text(raw_text)
    raw_text_length = len(cleaned)

    sections = detect_resume_sections(cleaned)

    sections_detected = {
        "skills": contains_flexible_keyword(
            cleaned,
            [
                "skills",
                "technical skills",
                "key skills",
                "competencies",
                "skills expertise",
                "areas of expertise",
            ],
        ),
        "education": contains_flexible_keyword(
            cleaned,
            [
                "education",
                "educational background",
                "academic background",
                "college",
                "university",
                "degree",
                "undergraduate",
            ],
        ),
        "certifications": contains_flexible_keyword(
            cleaned,
            [
                "certification",
                "certifications",
                "certificate",
                "certificates",
                "licenses",
                "training",
                "courses",
            ],
        ),
        "experience": contains_flexible_keyword(
            cleaned,
            [
                "experience",
                "work experience",
                "professional experience",
                "employment history",
                "internship",
                "projects",
                "part time work experience",
                "full time work experience",
                "long term work experience",
            ],
        ),
    }

    skills = skill_extractor.extract_skills_from_sections(sections)

    education_indicators = extract_education_indicators(cleaned)
    certification_indicators = extract_certification_indicators(cleaned)
    experience_indicators = extract_experience_indicators(cleaned)
    candidate_full_name = extract_candidate_full_name(raw_text, cleaned)

    warnings = []
    status = "success"

    if raw_text_length < 100:
        status = "warning"
        warnings.append(
            "The uploaded resume has very little readable text. It may be scanned, image-based, corrupted, or poorly formatted."
        )

    if not skills:
        warnings.append(
            "No recognizable skills were detected. Candidate should manually review and add skills."
        )

    if not education_indicators:
        warnings.append("No education indicators detected.")

    if not experience_indicators:
        warnings.append("No experience indicators detected.")

    candidate_profile = {
        "full_name": candidate_full_name,
        "skills": skills,
        "education_indicators": education_indicators,
        "certification_indicators": certification_indicators,
        "experience_indicators": experience_indicators,
    }

    normalized_for_matching = {
        "skill_ids": [skill["skill_id"] for skill in skills],
        "skill_names": [skill["skill_name"] for skill in skills],
        "resume_text_for_matching": normalize_for_matching(cleaned),
    }

    return {
        "status": status,
        "raw_text_length": raw_text_length,
        "sections_detected": sections_detected,
        "candidate_profile": candidate_profile,
        "normalized_for_matching": normalized_for_matching,
        "warnings": warnings,
    }

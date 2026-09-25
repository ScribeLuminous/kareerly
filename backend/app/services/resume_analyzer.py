import re
from typing import Dict, List

from .skill_extractor import MAX_CONFIRMED_SKILLS, SkillExtractor
from .resume_parser import (
    MAX_RESUME_BYTES,
    ResumeExtraction,
    ResumeFileError,
    clean_resume_text,
    extract_resume_document,
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
    r"certifications?",
    r"certificates?",
    r"licenses?",
    r"training",
    r"courses?",
    r"experiences?",
    r"work experiences?",
    r"professional experiences?",
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


# Words that qualify a heading without changing its kind: "CORE SKILLS",
# "RELEVANT EXPERIENCE", "ADDITIONAL TECHNICAL EXPERIENCE".
HEADING_QUALIFIERS = r"(?:(?:core|key|relevant|additional|professional|technical|work|other|related)\s+){0,2}"


SECTION_HEADING_PATTERN = re.compile(
    r"^\s*(?P<h>" + HEADING_QUALIFIERS + r"(" + "|".join(SECTION_HEADINGS) + r"))\s*:?\s*$",
    re.IGNORECASE | re.MULTILINE,
)


def split_resume_sections(resume_text: str) -> List[tuple]:
    """(heading, body) pairs in document order, the text before the first heading included.

    Unlike detect_resume_sections, a heading used twice ("EXPERIENCE" for two
    jobs) keeps both bodies, so no part of the resume is dropped.
    """
    matches = list(SECTION_HEADING_PATTERN.finditer(resume_text or ""))
    if not matches:
        return [("resume", resume_text.strip())] if (resume_text or "").strip() else []
    sections = []
    preamble = resume_text[:matches[0].start()].strip()
    if preamble:
        sections.append(("profile", preamble))
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(resume_text)
        body = resume_text[match.end():end].strip()
        if body:
            sections.append((re.sub(r"\s+", " ", match.group("h").strip().lower()), body))
    return sections


def detect_resume_sections(resume_text: str) -> Dict[str, str]:
    heading_pattern = SECTION_HEADING_PATTERN

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


DEGREE_PATTERNS = [
    (r"\bbachelor\s+of\s+science\s+in\s+computer\s+science\b", "Bachelor's Degree"),
    (r"\b(?:bachelor(?:'s)?|baccalaureate)\s+(?:of|in)\s+[A-Za-z][A-Za-z &,/()\-]{2,80}", "Bachelor's Degree"),
    (r"\b(?:master(?:'s)?|master)\s+(?:of|in)\s+[A-Za-z][A-Za-z &,/()\-]{2,80}", "Master's Degree"),
    (r"\b(?:doctor(?:ate)?|doctor)\s+(?:of|in)\s+[A-Za-z][A-Za-z &,/()\-]{2,80}", "Doctorate Degree"),
    (r"\b(?:associate(?:'s)?|associate)\s+(?:of|in)\s+[A-Za-z][A-Za-z &,/()\-]{2,80}", "Associate Degree"),
    (r"\b(?:BS|BSc|BA|AB|MS|MSc|MA|MBA|PhD)\s+(?:in\s+)?[A-Za-z][A-Za-z &,/()\-]{2,80}", "Degree"),
]

SCHOOL_PATTERN = re.compile(
    r"\b(?:"
    r"(?:University|College|Institute|Academy|School)\s+of\s+[A-Za-z][A-Za-z &'.\-]{1,80}"
    r"|[A-Za-z0-9&'.\-]+(?:\s+[A-Za-z0-9&'.\-]+){0,7}\s+"
    r"(?:University|College|Institute|Academy|School)(?:\s+of\s+[A-Za-z &'.\-]+)?"
    r")\b",
    re.IGNORECASE,
)


def _clean_extracted_line(value: str) -> str:
    value = re.sub(r"\s+", " ", value or "").strip(" \t\r\n|,;:-")
    return value.strip(" ,;:-")


def extract_education(resume_text: str, sections: Dict[str, str]) -> List[Dict[str, str]]:
    education_text = next(
        (text for heading, text in sections.items() if heading != "full_text" and any(key in heading for key in ("education", "academic"))),
        resume_text,
    )
    school = ""
    for line in education_text.splitlines():
        school_match = SCHOOL_PATTERN.search(line)
        if school_match:
            school = _clean_extracted_line(school_match.group(0))
            break

    flattened = re.sub(r"\s+", " ", education_text)
    if school:
        flattened = re.split(re.escape(school), flattened, maxsplit=1, flags=re.IGNORECASE)[0]

    degree_program = ""
    attainment = ""
    for pattern, label in DEGREE_PATTERNS:
        match = re.search(pattern, flattened, re.IGNORECASE)
        if match:
            degree_program = _clean_extracted_line(match.group(0))
            degree_program = re.split(
                r"\s+(?:CONTACT|EXPERIENCES?|SKILLS?|CERTIFICATIONS?|PROJECTS?)\b",
                degree_program,
                maxsplit=1,
                flags=re.IGNORECASE,
            )[0].strip()
            attainment = label
            break

    year = ""
    education_lines = [line.strip() for line in education_text.splitlines() if line.strip()]
    relevant_lines = []
    for index, line in enumerate(education_lines):
        if (degree_program and compact_text(line) in compact_text(degree_program)) or (school and compact_text(line) in compact_text(school)):
            relevant_lines.extend(education_lines[max(0, index - 1):index + 3])
    year_matches = re.findall(r"\b(?:19|20)\d{2}\b", " ".join(relevant_lines))
    if year_matches:
        year = year_matches[-1]

    if not any((degree_program, school, year)):
        return []
    return [{
        "highest_educational_attainment": attainment,
        "degree_program": degree_program,
        "school_university": school,
        "year_graduated": year,
    }]


def extract_certifications(resume_text: str, sections: Dict[str, str]) -> List[Dict[str, str]]:
    certification_sections = [
        text for heading, text in sections.items()
        if heading != "full_text" and any(key in heading for key in ("certificat", "license", "training", "course"))
    ]
    if not certification_sections:
        return []

    results = []
    seen = set()
    for section_text in certification_sections:
        for raw_line in section_text.splitlines():
            title = _clean_extracted_line(re.sub(r"^[\s•●▪◦*\-]+", "", raw_line))
            if len(title) < 3 or re.fullmatch(r"(?:19|20)\d{2}", title):
                continue
            normalized = title.lower()
            if normalized in seen:
                continue
            seen.add(normalized)
            year_match = re.search(r"\b(?:19|20)\d{2}\b", title)
            results.append({
                "title": re.sub(r"\s*[-–|,]?\s*\b(?:19|20)\d{2}\b.*$", "", title).strip(),
                "issuer": "",
                "year": year_match.group(0) if year_match else "",
            })
    return [item for item in results if item["title"]][:20]


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


def extract_resume_for_analysis(file_bytes: bytes, filename: str, skill_extractor: SkillExtractor) -> ResumeExtraction:
    """The document text both Step 1 and the report read, split skill names rejoined."""
    return extract_resume_document(
        file_bytes,
        filename,
        split_word_vocabulary=skill_extractor.split_word_vocabulary(),
        known_phrases=skill_extractor.known_phrases(),
    )


def prepare_resume_text(text: str) -> str:
    """The resume text that both Step 1 and matching read.

    Line breaks and capitalisation are kept: section headings ("EXPERIENCE",
    "PROJECTS") are found line by line, and matching reads each section as
    separate evidence. Older clients may send text already lowercased and
    flattened; it goes through here unchanged apart from whitespace.
    """
    return clean_resume_text(text or "")


def extract_resume_skills(text: str, skill_extractor: SkillExtractor, limit=None) -> List[Dict]:
    """Skills with evidence anywhere in the resume, ranked as Step 2 shows them.

    The first MAX_CONFIRMED_SKILLS are the Step 2 list; the rest are still
    resume evidence and count as held when matching.
    """
    return skill_extractor.extract_skills_from_sections(detect_resume_sections(text), limit=limit)


def resume_text_from_upload(file_bytes: bytes, filename: str, skill_extractor: SkillExtractor) -> tuple:
    """(prepared text, extraction) of an upload, exactly as Step 1 reads it."""
    extraction = extract_resume_for_analysis(file_bytes, filename, skill_extractor)
    return prepare_resume_text(extraction.text), extraction


def analyze_resume_file(file_path: str, skill_extractor: SkillExtractor) -> Dict:
    with open(file_path, "rb") as handle:
        file_bytes = handle.read(MAX_RESUME_BYTES + 1)
    return analyze_resume_bytes(file_bytes, file_path, skill_extractor)


def analyze_resume_bytes(file_bytes: bytes, filename: str, skill_extractor: SkillExtractor) -> Dict:
    """Step 1 analysis of an uploaded resume, read from memory (no copy is written)."""
    try:
        extraction = extract_resume_for_analysis(file_bytes, filename, skill_extractor)
    except ResumeFileError:
        raise
    except Exception as exc:
        raise ValueError(f"Could not extract readable text from resume: {exc}") from exc

    raw_text = extraction.text
    cleaned = prepare_resume_text(raw_text)
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

    all_skills = skill_extractor.extract_skills_from_sections(sections, limit=None)
    # Step 2 shows and lets the candidate edit the first twenty; the rest are
    # returned too, so nothing the resume documents is lost to the list size.
    skills = all_skills[:MAX_CONFIRMED_SKILLS]

    education_indicators = extract_education_indicators(cleaned)
    certification_indicators = extract_certification_indicators(cleaned)
    experience_indicators = extract_experience_indicators(cleaned)
    education = extract_education(cleaned, sections)
    certifications = extract_certifications(cleaned, sections)
    candidate_full_name = extract_candidate_full_name(raw_text, cleaned)

    warnings = list(extraction.warnings)
    status = "warning" if extraction.ocr_status in {"unavailable", "failed", "partial"} else "success"

    if raw_text_length < 100:
        status = "warning"
        if extraction.ocr_status not in {"unavailable", "failed"}:
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
        "education": education,
        "certifications": certifications,
    }

    normalized_for_matching = {
        "skill_ids": [skill["skill_id"] for skill in skills],
        "skill_names": [skill["skill_name"] for skill in skills],
        "all_skill_ids": [skill["skill_id"] for skill in all_skills],
        "all_skill_names": [skill["skill_name"] for skill in all_skills],
        # The same prepared text matching reads (line breaks kept), so the
        # report sees exactly what Step 1 saw, tables and text boxes included.
        "resume_text_for_matching": cleaned,
        "text_format": "prepared_resume_text_v2",
    }

    return {
        "status": status,
        "raw_text_length": raw_text_length,
        "sections_detected": sections_detected,
        "candidate_profile": candidate_profile,
        "normalized_for_matching": normalized_for_matching,
        # Every skill found, with the phrase and section that showed it.
        "resume_skill_evidence": [
            {
                "skill_id": skill["skill_id"],
                "skill_name": skill["skill_name"],
                "matched_text": skill.get("matched_text", ""),
                "source_section": skill.get("source_section", ""),
                "evidence_text": skill.get("evidence_text", ""),
                "shown_in_skill_review": index < MAX_CONFIRMED_SKILLS,
            }
            for index, skill in enumerate(all_skills)
        ],
        "warnings": warnings,
        # Only the problems reading the file (OCR, page limits), for the UI to
        # show beside the extracted skills.
        "extraction_warnings": [
            warning for warning in warnings
            if warning in extraction.warnings or warning.startswith("The uploaded resume has very little readable text")
        ],
        # How the text was read, so a saved analysis shows whether it predates
        # OCR, column ordering or .doc support (see RESUME_PARSER_VERSION).
        "extraction": extraction.metadata(),
    }

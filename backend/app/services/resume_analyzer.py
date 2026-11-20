import re
import unicodedata
from typing import Dict, List, Optional

from . import resume_fields
from .resume_fields import EMAIL, PHONE, SINGLE_DATE, URL, _is_place, find_date_ranges
from .skill_extractor import MAX_CONFIRMED_SKILLS, SkillExtractor
from .education import normalize_education_level
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
    r"(?:work|career) history",
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


# A letter in any script ("ñ" in Omaña, Peña, Cañete). \w without digits and underscore.
NAME_LETTER = r"[^\W\d_]"


def normalize_person_name(name: str) -> str:
    if not name:
        return ""

    # PDFs often carry "ñ" as "n" plus a combining tilde; compose it first.
    name = unicodedata.normalize("NFC", name)
    compact = re.sub(r"[\d_]|[^\w\s\-']", " ", name)
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

    word_tokens = re.findall(NAME_LETTER + "+", line)
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
        compact_word = re.sub(r"[\W\d_]", "", group)
        if compact_word:
            decoded_words.append(compact_word)

    if len(decoded_words) < 2:
        return ""

    return " ".join(decoded_words)


# Surname particles and initials make five-word Filipino names common:
# "Maria Cristina Dela Cruz Santos", "Juan Miguel C. De Los Reyes".
NAME_PARTICLES = {"de", "del", "dela", "delos", "los", "las", "dos", "da", "di", "van", "von", "bin", "binti", "y", "la", "le", "san", "sta", "sto", "ibn", "al", "el", "jr", "sr", "ii", "iii", "iv"}
# Labels of personal details and contact lines, never part of a name.
NAME_LABEL_TERMS = {
    # Words of skills and sidebar items ("Programming Language", "Team Leadership").
    "language", "programming", "management", "development", "communication", "leadership", "relationship",
    "planning", "networking", "growth", "design", "marketing", "sales", "services", "service", "support",
    "analysis", "technology", "information", "systems", "office", "data", "customer", "client", "team",
    "birth", "place", "nationality", "details", "license", "licence", "driving", "contact", "address", "phone",
    "email", "links", "references", "reference", "languages", "hobbies", "interests", "personal", "information",
    "website", "status", "religion", "gender", "citizenship", "height", "weight", "civil", "data", "available",
    "request", "templates", "template", "pinterest", "linkedin",
}
PERSONAL_DETAIL_LABEL = re.compile(r"^\s*(?:place of birth|date of birth|birthday|nationality|citizenship|driving licen[cs]e|civil status|religion|gender|sex)\s*:?\s*$", re.IGNORECASE)
# Job words that are not also common surnames ("Baker", "Cook", "Mason" are left out).
ROLE_WORDS_NOT_SURNAMES = {
    "guard", "assistant", "manager", "developer", "designer", "specialist", "associate", "officer", "analyst",
    "coordinator", "intern", "technician", "representative", "supervisor", "director", "consultant", "administrator",
    "clerk", "agent", "accountant", "teacher", "nurse", "caregiver", "encoder", "programmer", "trainee", "graduate",
}
NAME_LABEL = re.compile(r"^\s*(?:full\s+)?name\s*[:\-]?\s+(.+)$", re.IGNORECASE)
COUNTRY_NAMES = {"philippines", "united states", "usa", "united kingdom", "canada", "australia", "singapore", "japan", "united states of america"}


def is_plausible_person_name(value: str) -> bool:
    if not value:
        return False

    words = value.split()
    lowered = [word.lower().rstrip(".") for word in words]
    has_particle_or_initial = any(word in NAME_PARTICLES or len(word) == 1 for word in lowered)
    if len(words) < 2 or len(words) > (5 if has_particle_or_initial else 4):
        return False

    normalized_words = []
    for word in words:
        if not re.fullmatch(rf"{NAME_LETTER}(?:[\-'\w]*{NAME_LETTER})?\.?", word) or re.search(r"[\d_]", word):
            return False
        normalized_words.append(word.lower().rstrip("."))

    if any(word in NAME_BLOCKLIST_TERMS or word in NAME_LABEL_TERMS for word in normalized_words):
        return False
    if " ".join(normalized_words) in COUNTRY_NAMES:
        return False

    alpha_chars = re.sub(r"[\W\d_]", "", value)
    if len(alpha_chars) < 4:
        return False

    return True


def _name_candidates(line: str) -> List[str]:
    """Ways a line could hold a name: a "Name:" label, the part before a comma or bar ("Jane Cruz, UX Designer"), the line itself."""
    line = line.strip()
    labelled = NAME_LABEL.match(line)
    if labelled:
        return [labelled.group(1).strip()]
    # Text recognition can add a stray mark beside a name in capitals ("JUAN DELA CRUZ 3").
    words = line.split()
    while len(words) > 2 and len(words[-1]) <= 2 and not words[-1].isupper() and all(w.isupper() for w in words[:-1]):
        words = words[:-1]
    while len(words) > 2 and re.fullmatch(r"\d{1,2}|[^\w\s]{1,2}", words[-1]):
        words = words[:-1]
    line = " ".join(words)
    candidates = [line]
    first = re.split(r"\s*,\s*|\s+[|—–]\s+|\s+-\s+", line, maxsplit=1)[0]
    if first != line:
        candidates.insert(0, first)
    return candidates


def extract_candidate_full_name(raw_text: str, cleaned_text: str) -> str:
    """The candidate's name: a name-like line near the top or just above the email or phone line.

    Section headings, personal-detail labels and the value under them, places
    and countries are skipped, so "Personal details", "United States" or a
    sidebar skill is not taken for the name.
    """
    raw_lines = raw_text.splitlines() if raw_text else []
    cleaned_lines = cleaned_text.splitlines() if cleaned_text else []
    lines = []
    for line in raw_lines[:25] + cleaned_lines[:25]:
        if line.strip() and line.strip() not in lines:
            lines.append(line.strip())
    contact_lines = {index for index, line in enumerate(lines) if EMAIL.search(line) or (PHONE.search(line) and re.search(r"\d{7}", re.sub(r"\D", "", line)))}

    best = None
    for index, source_line in enumerate(lines):
        source_lower = source_line.lower()
        if any(marker in source_lower for marker in ["@", "http", "www", ".com", "linkedin"]):
            continue
        if _match_heading_line(source_line):
            continue
        if index > 0 and PERSONAL_DETAIL_LABEL.match(lines[index - 1]):
            continue
        for candidate in _name_candidates(source_line):
            if re.search(r"\d", candidate):
                continue
            decoded = decode_letter_spaced_line(candidate)
            name = normalize_person_name(decoded or candidate)
            # Many Filipino surnames are also towns ("Ilagan", "Bacus"), so only a line that reads like an
            # address ("Los Angeles, CA 90291", "Pasig City") is rejected as a place, never a bare name.
            address_like = ("," in source_line or re.search(r"\b(?:city|province|municipality)\b", source_line, re.IGNORECASE)) and _is_place(source_line)
            if not is_plausible_person_name(name) or address_like or "(" in candidate:
                continue
            if set(name.lower().split()) & ROLE_WORDS_NOT_SURNAMES:
                continue
            score = 0
            if any(index < contact <= index + 3 for contact in contact_lines):
                score += 3
            if index == 0:
                score += 3
            elif index < 3:
                score += 2
            if candidate.isupper() or candidate.istitle():
                score += 1
            rank = (score, -index)
            if best is None or rank > best[0]:
                best = (rank, name)
            break
    if best is None:
        return ""
    (score, negative_index), name = best
    # A name-like line far from the top and from any contact line is more often a sidebar item.
    if score < 2 and -negative_index >= 8:
        return ""
    return name


# Words that qualify a heading without changing its kind: "CORE SKILLS",
# "RELEVANT EXPERIENCE", "ADDITIONAL TECHNICAL EXPERIENCE".
HEADING_QUALIFIERS = r"(?:(?:core|key|relevant|additional|professional|technical|work|other|related)\s+){0,2}"


SECTION_HEADING_PATTERN = re.compile(
    r"^\s*(?P<h>" + HEADING_QUALIFIERS + r"(" + "|".join(SECTION_HEADINGS) + r"))\s*:?\s*$",
    re.IGNORECASE | re.MULTILINE,
)


# ------------------------------------------------------------
# Section headings
# ------------------------------------------------------------
# Every kind of section a resume uses, by the words of its heading. Headings
# are compared on their letters only, so "01 SUMMARY", "_SUMMARY_",
# "○ SKILLS ○" and letter-spaced "E M P L OY M E N T  H I S TO RY" match too.
# Recognising the sections Kareerly does not read (summary, references,
# languages, personal details...) matters as much as the ones it reads: each
# heading ends the section above it, so a sidebar's address, languages or
# links no longer run on into the skills or certifications before them.
SECTION_VOCABULARY: Dict[str, List[str]] = {
    "experience": [
        "experience", "experiences", "work experience", "professional experience", "relevant experience",
        "employment", "employment history", "employment record", "work history", "career history",
        "professional history", "internship", "internships", "internship experience", "practicum",
        "on the job training", "ojt", "ojt experience", "pre professional experience", "preprofessional experience",
        "volunteer experience", "volunteer work", "volunteering", "military experience", "military service",
        "professional background", "experience summary", "positions held", "work background",
    ],
    "education": [
        "education", "educational background", "educational attainment", "academic background", "academic history",
        "academic qualifications", "academics", "education and training", "schools attended", "education history",
        "academic profile", "educational qualifications",
    ],
    "skills": [
        "skills", "skill", "technical skills", "key skills", "core skills", "skills and abilities", "abilities",
        "competencies", "core competencies", "key competencies", "competences", "areas of expertise", "expertise",
        "technical proficiencies", "proficiencies", "personal skills", "soft skills", "hard skills", "computer skills",
        "it skills", "technical expertise", "skill set", "skillset", "strengths", "tools", "tools and technologies",
        "technologies", "skills summary", "skills highlights", "skills and certifications", "skills and expertise",
    ],
    "certifications": [
        "certifications", "certification", "certificates", "certificate", "licenses", "license", "licences",
        "licensure", "licenses and certifications", "certifications and licenses", "professional licenses",
        "eligibility", "civil service eligibility", "eligibilities", "credentials", "accreditations",
        "professional certifications", "certifications and training",
    ],
    "training": [
        "training", "trainings", "trainings attended", "seminars", "seminars attended", "seminars and trainings",
        "trainings and seminars", "seminars and workshops", "workshops", "courses", "course", "relevant courses",
        "coursework", "relevant coursework", "professional development", "continuing education", "short courses",
        "trainings and certifications",
    ],
    "projects": [
        "projects", "project", "academic projects", "personal projects", "key projects", "thesis", "capstone",
        "capstone project", "research", "portfolio", "publications",
    ],
    "summary": [
        "summary", "professional summary", "career summary", "profile", "professional profile", "personal profile",
        "about me", "about", "objective", "career objective", "objectives", "job objective", "personal statement",
        "executive summary", "overview", "introduction", "career goal", "career objectives",
    ],
    "achievements": [
        "achievements", "accomplishments", "awards", "honors", "honours", "awards and achievements",
        "honors and awards", "honours and awards", "awards and recognition", "recognition", "recognitions",
        "accolades", "key achievements", "awards and accomplishments", "honors and accomplishments",
        "accomplishments and awards",
    ],
    "activities": [
        "activities", "extracurricular activities", "extra curricular activities", "leadership",
        "leadership and activities", "organizations", "organisations", "affiliations", "memberships",
        "professional affiliations", "community involvement", "involvement", "student organizations",
    ],
    "languages": ["languages", "language", "language skills", "language proficiency", "dialects"],
    "interests": ["interests", "hobbies", "hobbies and interests", "personal interests"],
    "references": ["references", "character references", "referees", "reference"],
    "personal_details": [
        "personal details", "personal information", "personal data", "personal background", "details",
        "personal info", "bio data", "biodata",
    ],
    "contact": ["contact", "contact details", "contact information", "contact info", "contacts"],
    "links": ["links", "social links", "online profiles", "profiles", "social media", "websites"],
}
# Second halves of combined headings ("ACHIEVEMENTS / RESPONSIBILITIES").
HEADING_COMPANIONS = {
    "responsibilities", "activities", "honors", "honours", "awards", "licenses", "certifications", "training",
    "trainings", "interests", "abilities", "achievements", "accomplishments", "recognition", "seminars",
    "workshops", "affiliations", "leadership", "organizations", "languages", "tools", "technologies", "skills",
    "education", "experience", "projects", "hobbies", "certificates", "courses", "expertise", "competencies",
}
NEW_HEADING_QUALIFIERS = {
    "core", "key", "relevant", "additional", "professional", "technical", "work", "other", "related", "selected",
    "notable", "recent", "personal", "academic", "pre", "preprofessional",
}
MAX_HEADING_WORDS = 6


def _letters(value: str) -> str:
    return re.sub(r"[^a-z]+", "", unicodedata.normalize("NFKC", value or "").lower())


_HEADING_KIND_BY_LETTERS = {
    _letters(phrase): kind for kind, phrases in SECTION_VOCABULARY.items() for phrase in phrases
}
_COMPANION_LETTERS = {_letters(word) for word in HEADING_COMPANIONS}
_LETTER_SPACED_TOKEN = re.compile(r"^[A-Z]{1,2}$")


def section_kind(heading: str) -> str:
    """The kind of section a heading (as split_resume_sections names it) starts, or "other"."""
    heading = re.sub(r"\s*\([^)]{1,12}\)\s*$", "", heading or "")  # "on-the-job training (ojt)"
    letters = _letters(heading)
    if letters in _HEADING_KIND_BY_LETTERS:
        return _HEADING_KIND_BY_LETTERS[letters]
    words = re.findall(r"[a-z]+", unicodedata.normalize("NFKC", heading or "").lower())
    while words and words[0] in NEW_HEADING_QUALIFIERS:
        words = words[1:]
        if _letters(" ".join(words)) in _HEADING_KIND_BY_LETTERS:
            return _HEADING_KIND_BY_LETTERS[_letters(" ".join(words))]
    parts = [part for part in re.split(r"\s*(?:&|/|\+|,|\band\b)\s*", heading.lower()) if part.strip()]
    if len(parts) > 1:
        return section_kind(parts[0])
    if heading in ("profile", "resume"):
        return heading
    return "other"


def _vocabulary_heading(text: str) -> Optional[str]:
    """The heading key when ``text`` (decorations removed) is a known heading, else None."""
    printed = re.sub(r"\s+", " ", text.strip().lower())
    text = re.sub(r"\s*\([^)]{1,12}\)\s*$", "", text)  # "ON-THE-JOB TRAINING (OJT)" is read without "(OJT)"
    words = re.findall(r"[^\W\d_]+(?:[-'][^\W\d_]+)*|&|/|\+", text)
    if not words or len([w for w in words if w not in "&/+"]) > MAX_HEADING_WORDS:
        return None
    letters = _letters(text)
    if letters in _HEADING_KIND_BY_LETTERS:
        return printed
    plain = [w.lower() for w in words]
    trimmed = plain
    for _ in range(2):
        if trimmed and _letters(trimmed[0]) in NEW_HEADING_QUALIFIERS | {"pre"} or (trimmed and trimmed[0].startswith("pre-")):
            trimmed = trimmed[1:]
            if trimmed and _letters(" ".join(trimmed)) in _HEADING_KIND_BY_LETTERS:
                return printed
    parts = [p for p in re.split(r"\s*(?:&|/|\+|,|\band\b)\s*", text.lower()) if p.strip()]
    if len(parts) > 1 and _letters(parts[0]) in _HEADING_KIND_BY_LETTERS and all(
        _letters(p) in _HEADING_KIND_BY_LETTERS or _letters(p) in _COMPANION_LETTERS for p in parts[1:]
    ):
        return printed
    return None


def _strip_heading_decoration(line: str) -> str:
    """A heading line without numbering, bullets, rules or underscores around it."""
    line = line.strip()
    line = re.sub(r"^(?:\d{1,2}|[IVX]{1,4})[.)]?\s+(?=[^\W\d_])", "", line)  # "01 SUMMARY", "IV. SKILLS"
    line = re.sub(r"^(?:[^\w(]|_)+", "", line)
    return re.sub(r"(?:[^\w)]|_)+$", "", line)


def _letter_spaced_prefix(line: str) -> Optional[tuple]:
    """(heading key, rest of line) for "P R O F I L E Proactive and ..." or a whole letter-spaced heading."""
    tokens = line.split()
    run = 0
    while run < len(tokens) and _LETTER_SPACED_TOKEN.match(tokens[run]):
        run += 1
    if run < 4:
        return None
    for length in range(run, 3, -1):
        letters = "".join(tokens[:length]).lower()
        if letters in _HEADING_KIND_BY_LETTERS:
            phrase = next(p for p in SECTION_VOCABULARY[_HEADING_KIND_BY_LETTERS[letters]] if _letters(p) == letters)
            return phrase, " ".join(tokens[length:])
    return None


def _inline_heading(line: str) -> Optional[tuple]:
    """(heading key, content) when a line starts with a heading followed by its first content.

    Only capitals ("EDUCATION BS in ...") or a heading ended by a colon ("Skills: Excel, Word")
    count, and the rest must read as ordinary text, so a sentence such as "Strong work history
    in retail." is never split.
    """
    spaced = _letter_spaced_prefix(line)
    if spaced and spaced[1]:
        return spaced
    colon = re.match(r"^\s*([^:]{2,40}):\s*(\S.*)$", line)
    if colon:
        key = _vocabulary_heading(_strip_heading_decoration(colon.group(1)))
        # "Thesis: ..." or "Research: ..." label a line inside education; they do not start a section.
        if key and section_kind(key) != "projects":
            return key, colon.group(2).strip()
    words = line.split()
    for count in range(min(MAX_HEADING_WORDS, len(words) - 1), 0, -1):
        head, rest = words[:count], " ".join(words[count:])
        if not all(re.fullmatch(r"[A-Z][A-Z&/\-]*|&|/", word) for word in head):
            continue
        if not re.search(r"[a-z]", rest):
            continue
        key = _vocabulary_heading(" ".join(head))
        if key:
            return key, re.sub(r"^[\W_]+(?=[A-Za-z0-9(])", "", rest).strip()
    return None


def _match_heading_line(line: str) -> Optional[tuple]:
    """(heading key, content on the same line) when the line is a section heading, else None."""
    if not line.strip() or len(line) > 120 or line.count("(") != line.count(")"):
        return None  # "Language)" is the end of a wrapped list item, not a heading
    match = SECTION_HEADING_PATTERN.match(line)
    if match:
        # Headings Kareerly has always read keep exactly the same key.
        return re.sub(r"\s+", " ", match.group("h").strip().lower()), ""
    spaced = _letter_spaced_prefix(line)
    if spaced and not spaced[1]:
        return spaced
    stripped = _strip_heading_decoration(line)
    if stripped and len(stripped) <= 60 and not re.search(r"[.!?;]$", line.strip()):
        key = _vocabulary_heading(stripped)
        if key:
            return key, ""
    return _inline_heading(line)


def _leading_capitals(line: str) -> tuple:
    """(leading words in capitals, the rest of the line), at most three words."""
    words = line.split()
    count = 0
    while count < min(3, len(words)) and re.fullmatch(r"[A-Z][A-Z&/\-]*|&|/", words[count]):
        count += 1
    return " ".join(words[:count]), " ".join(words[count:])


def _two_line_heading(line: str, next_line: str) -> Optional[tuple]:
    """A heading wrapped over two lines in a narrow label column ("PRE-PROFESSIONAL" / "EXPERIENCE Xerox ...")."""
    head1, rest1 = _leading_capitals(line)
    head2, rest2 = _leading_capitals(next_line)
    # "ACHIEVEMENTS /" is a heading on its own only when the next line does not finish it.
    if not head1 or not head2 or (_vocabulary_heading(head1) and not re.search(r"(?:/|&|\bAND)$", head1)):
        return None
    key = _vocabulary_heading(f"{head1} {head2}")
    if not key:
        return None
    return key, [part for part in (_strip_inline_bullet(rest1), _strip_inline_bullet(rest2)) if part]


def _strip_inline_bullet(text: str) -> str:
    """Content after a heading on the same line, without the bullet OCR read as a letter ("e President, ...")."""
    text = re.sub(r"^[\W_]+(?=[A-Za-z0-9(])", "", text.strip())
    return re.sub(r"^(?:[eo•●▪■◦*+«»©®>~])\s+(?=[A-Z0-9(])", "", text).strip()


def _section_spans(resume_text: str) -> List[tuple]:
    """(heading key or None, body) in document order; None is the text before the first heading."""
    spans: List[tuple] = []
    current_key, current_lines = None, []
    lines = (resume_text or "").splitlines()
    skip_next = False
    for index, line in enumerate(lines):
        if skip_next:
            skip_next = False
            continue
        found = _match_heading_line(line)
        if index + 1 < len(lines) and (not found or found[0].endswith(("/", "&", " and"))):
            wrapped = _two_line_heading(line, lines[index + 1])
            next_found = _match_heading_line(lines[index + 1])
            # "PRE-PROFESSIONAL" over "EXPERIENCE Xerox ...": the joined heading wins over "EXPERIENCE" alone.
            if wrapped and next_found and len(_letters(wrapped[0])) <= len(_letters(next_found[0])):
                wrapped = None
            if wrapped:
                spans.append((current_key, "\n".join(current_lines).strip()))
                current_key, current_lines = wrapped[0], list(wrapped[1])
                skip_next = True
                continue
        if not found:
            current_lines.append(line)
            continue
        spans.append((current_key, "\n".join(current_lines).strip()))
        current_key, rest = found
        rest = _strip_inline_bullet(rest) if rest else ""
        current_lines = [rest] if rest else []
    spans.append((current_key, "\n".join(current_lines).strip()))
    return spans


def field_sections(resume_text: str) -> List[tuple]:
    """(heading, body) for the field extractors; the text before the first heading is named "" (see field_section_kind)."""
    return [("" if key is None else key, body) for key, body in _section_spans(resume_text) if body]


def field_section_kind(heading: str) -> str:
    """section_kind, with "preamble" for the text above the first heading (the name and contact lines)."""
    return "preamble" if heading == "" else section_kind(heading)


def split_resume_sections(resume_text: str) -> List[tuple]:
    """(heading, body) pairs in document order, the text before the first heading included.

    Unlike detect_resume_sections, a heading used twice ("EXPERIENCE" for two
    jobs) keeps both bodies, so no part of the resume is dropped.
    """
    spans = _section_spans(resume_text)
    if len(spans) == 1:
        return [("resume", resume_text.strip())] if (resume_text or "").strip() else []
    sections = []
    for key, body in spans:
        if not body:
            continue
        sections.append(("profile" if key is None else key, body))
    return sections


def detect_resume_sections(resume_text: str) -> Dict[str, str]:
    spans = _section_spans(resume_text or "")
    sections = {}
    for key, body in spans[1:]:
        if body:
            sections[key] = body
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


_FIELD_OF_STUDY = r"[A-Za-z][A-Za-z &,/()'\-]{2,80}"
DEGREE_PATTERNS = [
    (r"\bbachelor\s+of\s+science\s+in\s+computer\s+science\b", "Bachelor's Degree"),
    # "Bachelor of Arts", "Bachelor's Degree in", "Bachelor Degree in", "Bachelors in"
    (r"\b(?:bachelor(?:'s|’s|s)?|baccalaureate)(?:\s+degree)?\s+(?:of|in)\s+" + _FIELD_OF_STUDY, "Bachelor's Degree"),
    (r"\bmaster(?:'s|’s|s)?(?:\s+degree)?\s+(?:of|in)\s+" + _FIELD_OF_STUDY, "Master's Degree"),
    (r"\b(?:doctor(?:ate)?|doctoral)(?:\s+degree)?\s+(?:of|in)\s+" + _FIELD_OF_STUDY, "Doctorate Degree"),
    (r"\bassociate(?:'s|’s|s)?(?:\s+degree)?\s+(?:of|in)\s+" + _FIELD_OF_STUDY, "Associate Degree"),
    # "BS in Nursing", "BS Accountancy", "MBA", but never "MS Word" or "MS Excel".
    (r"\b(?:B\.?S\.?|BSc|B\.?A\.?|AB|M\.?S\.?|MSc|M\.?A\.?|MBA|PhD)\s+(?:in\s+)?(?!(?:Word|Excel|Office|PowerPoint|Powerpoint|Access|Project|Teams|Outlook|Visio|SQL|Windows|Paint|Publisher)\b)[A-Z][A-Za-z &,/()'\-]{2,80}", "Degree"),
    # Philippine abbreviations: BSIT, BSBA, BSN, BSEd, BEEd, BSCS, ABComm ...
    (r"\b(?:BS[A-Z][A-Za-z]{0,4}|BEEd|BSEd|AB[A-Z][a-z]{2,8})\b(?:\s*[-–—]?\s*(?:major\s+in\s+)?[A-Z][A-Za-z &]{2,40})?", "Bachelor's Degree"),
]
# Below a degree: senior high strands, vocational and short programmes.
OTHER_PROGRAMME_PATTERN = re.compile(
    r"^(?:(?:senior|junior)\s+high\s+school|high\s+school|secondary|elementary|primary)\b.*"
    r"|.*\b(?:NC\s+(?:I{1,3}|IV)|TESDA|vocational|diploma|certificate\s+program(?:me)?|program(?:me)?|course|training)\b.*",
    re.IGNORECASE,
)

SCHOOL_PATTERN = re.compile(
    r"\b(?:"
    r"(?:University|College|Institute|Academy|School)\s+of\s+[A-Za-z][A-Za-z &'.\-]{1,80}"
    r"|[A-Za-z0-9&'.\-]+(?:\s+[A-Za-z0-9&'.\-]+){0,7}\s+"
    r"(?:University|College|Institute|Academy|School)(?:\s+of\s+[A-Za-z &'.\-]+)?"
    r")\b",
    re.IGNORECASE,
)
_SCHOOL_WORDS = re.compile(r"\b(?:University|College|Institute|Academy|School|Polytechnic|Universidad|Ateneo|Colegio|Center|Centre)\b", re.IGNORECASE)
# A line of only these words ("School", "High School", "State University") ends the school name above it.
_GENERIC_SCHOOL_WORDS = {"school", "high", "senior", "junior", "national", "integrated", "college", "university",
                         "institute", "center", "centre", "state", "of", "technology", "science", "academy"}
_HONORS = re.compile(r"\b(?:cum laude|magna cum laude|summa cum laude|with honou?rs|GWA|GPA|dean'?s list(?:er)?|valedictorian|salutatorian|latin honou?rs)\b", re.IGNORECASE)
_EDU_SEGMENT_SPLIT = re.compile(r"\s+[|·•]\s+|\s+[—–]\s+|\s+-\s+|\t")
EDUCATION_LEVEL_RANK = {level: rank for rank, level in enumerate(
    ["High School", "Vocational / Technical", "Some College", "Associate Degree", "Bachelor's Degree", "Master's Degree", "Doctorate Degree"]
)}


def _clean_extracted_line(value: str) -> str:
    value = re.sub(r"\s+", " ", value or "").strip(" \t\r\n|,;:-")
    return value.strip(" ,;:-")


def _degree_in(text: str) -> tuple:
    """(degree text, level) when ``text`` names a degree or programme, else ("", "")."""
    for pattern, label in DEGREE_PATTERNS:
        match = re.search(pattern, text, re.IGNORECASE if label != "Degree" and not pattern.startswith(r"\b(?:BS[A-Z]") else 0)
        if match:
            degree = _clean_extracted_line(match.group(0))
            degree = re.split(r"\s+(?:CONTACT|EXPERIENCES?|SKILLS?|CERTIFICATIONS?|PROJECTS?)\b", degree, maxsplit=1)[0].strip()
            degree = re.split(r"\s*\((?:19|20)\d{2}", degree)[0].strip(" (")
            return degree, normalize_education_level(label) or normalize_education_level(degree)
    if OTHER_PROGRAMME_PATTERN.match(text.strip()) and not _SCHOOL_WORDS.search(re.sub(r"\b(?:senior|junior)?\s*high school\b", "", text, flags=re.IGNORECASE)):
        degree = _clean_extracted_line(text)
        return degree, normalize_education_level(degree)
    return "", ""


def _education_blocks(sections: Dict[str, str]) -> List[str]:
    return [text for heading, text in sections.items() if heading != "full_text" and section_kind(heading) == "education"]


def _education_entries(text: str) -> List[Dict[str, str]]:
    """One entry per degree or programme, with its school, years and honours, from education text."""
    entries: List[Dict[str, str]] = []
    current: Optional[Dict[str, str]] = None
    last_kind = ""
    degree_line = -1

    def new_entry() -> Dict[str, str]:
        entry = {"highest_educational_attainment": "", "degree_program": "", "school_university": "", "year_graduated": "",
                 "location": "", "start_date": "", "end_date": "", "honors": "", "in_progress": False}
        entries.append(entry)
        return entry

    raw_lines = resume_fields.join_split_date_ranges([line for line in text.splitlines() if line.strip()])
    # A school name wrapped onto its own line ("Davao de Oro Valley Integrated" / "School").
    merged: List[str] = []
    for line in raw_lines:
        head = re.split(r"\s*[|·]\s*", line.strip())[0]
        previous = merged[-1].strip() if merged else ""
        tail = re.split(r"\s*[|,·]\s*", previous)[-1] if previous else ""
        wrapped_school = (
            previous and head and len(head.split()) <= 5 and _SCHOOL_WORDS.search(head) and not find_date_ranges(head)
            and not _SCHOOL_WORDS.search(tail) and 1 <= len(tail.split()) <= 4 and all(w[:1].isupper() for w in tail.split())
            and not _degree_in(tail)[0]
        )
        if merged and head and (
            (set(head.lower().split()) <= _GENERIC_SCHOOL_WORDS and not re.search(r"[.,;:]$", previous))
            # "Metro North College of" / "Health Sciences"; "... | Surigao" / "Northern College".
            or re.search(r"\b(?:of|and|for|&)$", previous) or wrapped_school
        ):
            merged[-1] = f"{merged[-1].rstrip()} {line.strip()}"
        else:
            merged.append(line)
    for line_number, raw in enumerate(merged):
        is_bullet = bool(re.match(r"^\s*[•●▪■◦*‣⁃○»>+\-–—]\s+", raw))
        line = re.sub(r"^\s*[•●▪■◦*‣⁃○»>+\-–—]\s+", "", raw).strip()
        if not line:
            continue
        # "Related Coursework: ...", "Majors: ...", "Thesis: ..." describe the entry above.
        if re.match(r"^(?:related\s+)?(?:course\s*work|coursework|course curriculum|majors?|minors?|thesis|capstone|relevant courses|subjects|activities)\s*:", line, re.IGNORECASE):
            continue
        ranges = find_date_ranges(line)
        without_dates = line
        for found in reversed(ranges):
            without_dates = without_dates[:found["span"][0]] + " " + without_dates[found["span"][1]:]
        singles = [] if ranges else [m.group(0) for m in SINGLE_DATE.finditer(without_dates)]
        for single in singles:
            without_dates = without_dates.replace(single, " ")
        without_dates = re.sub(r"\(\s*\)", " ", without_dates)
        segments = []
        for part in (_clean_extracted_line(p) for p in _EDU_SEGMENT_SPLIT.split(without_dates)):
            if not part:
                continue
            head = part.split(",")[0]
            # "Senior High School, TVL Track – Home Economics strand": the strand belongs to the degree.
            if segments and re.search(r"\b(?:strand|track|specialization|specialisation)$", head, re.IGNORECASE):
                segments[-1] = f"{segments[-1]} – {head}"
                part = part[len(head):].lstrip(" ,")
                if not part:
                    continue
            segments.append(part)
        expanded = []
        for segment in segments:
            # "Degree, School" and "School, Location" on one line.
            degree, _ = _degree_in(segment)
            if is_bullet and degree and not any(re.search(p, segment, re.IGNORECASE if lbl != "Degree" else 0) for p, lbl in DEGREE_PATTERNS):
                continue  # a bullet naming a course or training describes the entry above
            school_level = re.match(r"^(?:(?:senior|junior)\s+)?high\s+school\b|^(?:secondary|elementary|primary)\b", segment, re.IGNORECASE)
            if degree and not school_level and not any(re.search(p, segment, re.IGNORECASE if lbl != "Degree" else 0) for p, lbl in DEGREE_PATTERNS) and "," in segment:
                # "Security Guard Certificate Program (SOCP), ASIS International, North Naples"
                programme, provider = _split_title_issuer(segment)
                if provider:
                    tail = [p.strip() for p in segment[len(programme):].split(",") if p.strip()]
                    expanded.extend([programme, *[f"{t} (provider)" if i == 0 and not _SCHOOL_WORDS.search(t) else t for i, t in enumerate(tail)]])
                    continue
            parts = [p.strip() for p in segment.split(",")] if "," in segment else [segment]
            if degree and len(parts) > 1 and _SCHOOL_WORDS.search(", ".join(parts[1:])):
                cut = next(i for i in range(1, len(parts)) if _SCHOOL_WORDS.search(parts[i]))
                expanded.extend([", ".join(parts[:cut]), *parts[cut:]])
            elif not degree and _SCHOOL_WORDS.search(parts[0]) and len(parts) > 1:
                expanded.extend(parts)
            elif not degree and len(parts) > 1 and _degree_in(parts[0])[0] and _SCHOOL_WORDS.search(", ".join(parts[1:])):
                # "S.A.F.E. Approach Level II Training, Hawaii Western College"
                expanded.extend(parts)
            else:
                expanded.append(segment)
        for segment in expanded:
            degree, level = _degree_in(segment)
            if _HONORS.search(segment) and not degree:
                if current is not None:
                    current["honors"] = current["honors"] or segment
                last_kind = "honors"
                continue
            if degree:
                if current is None or current["degree_program"]:
                    current = new_entry()
                current["degree_program"] = degree
                current["highest_educational_attainment"] = level
                last_kind = "degree"
                degree_line = line_number
            elif segment.endswith(" (provider)"):
                if current is not None and not current["school_university"]:
                    current["school_university"] = segment[: -len(" (provider)")]
                last_kind = "school"
            elif _SCHOOL_WORDS.search(segment) and len(segment.split()) <= 12:
                school_match = SCHOOL_PATTERN.search(segment)
                school = _clean_extracted_line(school_match.group(0)) if school_match else segment
                if current is None or current["school_university"]:
                    current = new_entry()
                current["school_university"] = school
                last_kind = "school"
            elif current is not None and _is_place(segment) and not current["location"]:
                current["location"] = segment
                last_kind = "location"
            elif current is not None and last_kind == "degree" and degree_line != line_number and len(segment.split()) <= 4 and segment[:1].isupper() and not current["school_university"]:
                # The second line of a wrapped degree ("... Communications" / "Engineering (2010 – 2015)").
                current["degree_program"] = f"{current['degree_program']} {segment}".strip()
            elif current is not None and last_kind == "school" and not current["location"] and len(segment.split()) <= 6 and re.search(r"\b(?:city|avenue|ave|street|st\.?)\b", segment, re.IGNORECASE):
                current["location"] = segment
        target = current
        if target is None and (ranges or singles):
            continue
        if ranges and target is not None and not target["end_date"]:
            found = ranges[0]
            target["start_date"], target["end_date"] = found["start"], found["end"]
            if found["end"] == "present":
                target["in_progress"] = True
            else:
                target["year_graduated"] = found["end"][:4]
        elif singles and target is not None and not target["year_graduated"] and not target["end_date"]:
            year = re.search(r"(?:19|20)\d{2}", singles[-1]).group(0)
            if not re.search(r"\b(?:expected|ongoing|present|current)\b", line, re.IGNORECASE):
                target["year_graduated"] = year
                target["end_date"] = year
    cleaned = []
    for entry in entries:
        if not entry["degree_program"] and not entry["school_university"]:
            continue
        if entry["in_progress"] and entry["highest_educational_attainment"] in {"Bachelor's Degree", "Associate Degree"}:
            entry["highest_educational_attainment"] = "Some College"
        if re.search(r"\b(?:undergraduate|ongoing|currently enrolled|expected)\b", entry["degree_program"], re.IGNORECASE):
            entry["in_progress"] = True
        cleaned.append(entry)
    return cleaned


def extract_education(resume_text: str, sections: Dict[str, str]) -> List[Dict[str, str]]:
    """Every degree or programme in the education section(s), highest level first.

    Each entry keeps the original keys (highest_educational_attainment,
    degree_program, school_university, year_graduated) and adds location,
    start_date, end_date, honors and in_progress. Without an education
    section, the whole resume is searched for one degree, as before.
    """
    blocks = _education_blocks(sections)
    entries: List[Dict[str, str]] = []
    for block in blocks:
        entries.extend(_education_entries(block))
    if not entries and not blocks:
        fallback = [e for e in _education_entries(resume_text or "") if e["degree_program"]]
        entries = fallback[:1]
    # The highest level first: the profile form pre-fills attainment from the first entry.
    entries.sort(key=lambda e: -EDUCATION_LEVEL_RANK.get(e["highest_educational_attainment"], -1))
    return entries[:8]


# ------------------------------------------------------------
# Certifications and training
# ------------------------------------------------------------
_CREDENTIAL = re.compile(
    r"\b(?:certif\w*|licen[cs]\w*|accredit\w*|CPR|first aid|NC\s+(?:I{1,3}|IV)|eligibility|board passer|registered|CDA|CKAM|CPA|CPO|PMP)\b",
    re.IGNORECASE,
)
_TRAINING_WORD = re.compile(r"\b(?:certif\w*|course|training|programme|program|seminar|workshop|webinar|bootcamp|diploma|licen[cs]\w*|class)\b", re.IGNORECASE)
_NOT_A_CREDENTIAL = re.compile(
    r"^(?:linkedin|pinterest|github|website|portfolio|resume templates?|build this (?:template|resume)|make this resume|"
    r"driving licen[cs]e|driver'?s licen[cs]e|place of birth|date of birth|nationality|full|details|links|hobbies|languages)\W*$",
    re.IGNORECASE,
)
_DATE_ONLY = re.compile(
    r"^\W*(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s*,?\s*)?(?:(?:19|20)\d{2})?"
    r"(?:\s*(?:-|–|—|to)\s*(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s*)?(?:(?:19|20)\d{2}|present|current))?\W*$",
    re.IGNORECASE,
)


def _credential_items(body: str) -> List[tuple]:
    """(item text, date text) per certification or training, wrapped lines joined and date lines attached."""
    items: List[list] = []
    for raw in body.splitlines():
        line = raw.strip()
        if not line:
            continue
        bullet = bool(re.match(r"^\s*[•●▪■◦*‣⁃○»>+]\s*", line))
        line = re.sub(r"^\s*[•●▪■◦*‣⁃○»>+\-–—]\s+", "", line).strip()
        if _DATE_ONLY.match(line) and re.search(r"\d|present", line, re.IGNORECASE):
            if items and not items[-1][1]:
                items[-1][1] = line
            continue
        continuation = items and not bullet and (
            line[:1].islower() or line[:1] in "(),&" or re.search(r"(?:\(|,|&|\bof|\bin|\band|\bfor)\s*$", items[-1][0])
        )
        if continuation and not items[-1][1]:
            items[-1][0] = f"{items[-1][0]} {line}"
        else:
            items.append([line, ""])
    return [(text, date) for text, date in items]


def _split_title_issuer(text: str) -> tuple:
    """(title, issuer) from "Title, Issuer, Place", "Title — Issuer" or "Title | Issuer"."""
    parts = [p.strip() for p in re.split(r"\s+[—–|]\s+|\s+-\s+", text, maxsplit=1)]
    if len(parts) == 2:
        title, issuer = parts
        issuer = issuer.split(",")[0].strip()
        if re.match(r"^(?:completed|with|including|for)\b", issuer, re.IGNORECASE):
            issuer = ""
        return title, issuer
    # The title runs to the comma after its first "Certified"/"Course"/... word: a
    # second one usually belongs to the issuer ("..., Certified Institute of ...").
    keyword = _TRAINING_WORD.search(text)
    if keyword:
        comma = text.find(",", keyword.end())
        # The title runs to the comma after its last "Course"/"Certificate"/... word,
        # unless that comma is inside a parenthesis.
        while comma != -1 and text[:comma].count("(") > text[:comma].count(")"):
            comma = text.find(",", comma + 1)
        if comma != -1:
            return text[:comma].strip(), text[comma + 1:].split(",")[0].strip()
    return text.strip(), ""


def extract_certifications(resume_text: str, sections: Dict[str, str]) -> List[Dict[str, str]]:
    """Certifications and trainings from their sections, plus credentials stated in the summary.

    Each item keeps the original keys (title, issuer, year) and adds ``kind``
    ("certification" or "training") and ``dates_as_written``. Contact lines,
    link labels and personal details are never returned as certifications.
    """
    results: List[Dict[str, str]] = []
    seen = set()

    def add(title: str, issuer: str, date_text: str, source: str) -> None:
        title = _clean_extracted_line(re.sub(r",\s*,", ",", title))
        if len(re.findall(r"[A-Za-z]", title)) < 3 or _NOT_A_CREDENTIAL.match(title) or _DATE_ONLY.match(title):
            return
        if EMAIL.search(title) or URL.search(title) or (PHONE.search(title) and not re.search(r"[A-Za-z]{4,}", title)):
            return
        if _is_place(title) or re.match(r"^\d+\s+\w+", title) or re.fullmatch(r"[\d\s()+\-]{7,}", title):
            return
        key = re.sub(r"[^a-z0-9]+", "", title.lower())
        if key in seen:
            return
        seen.add(key)
        ranges = find_date_ranges(date_text)
        year = ""
        if ranges:
            end = ranges[0]["end"]
            year = (end if end != "present" else ranges[0]["start"])[:4]
        else:
            single = SINGLE_DATE.search(date_text)
            if single:
                year = re.search(r"(?:19|20)\d{2}", single.group(0)).group(0)
        results.append({
            "title": title,
            "issuer": _clean_extracted_line(issuer),
            "year": year,
            "kind": "license" if re.search(r"\blicen[cs]e\b", title, re.IGNORECASE) else ("certification" if _CREDENTIAL.search(title) else "training"),
            "dates_as_written": date_text.strip(),
            "source_section": source,
        })

    for heading, body in sections.items():
        if heading == "full_text" or section_kind(heading) not in {"certifications", "training"}:
            continue
        for text, date_text in _credential_items(body):
            ranges = find_date_ranges(text)
            inline = ranges[0]["text"] if ranges else ""
            if not inline:
                single = re.search(r"(?:,|—|–|-)?\s*\b(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+)?(?:19|20)\d{2}\b\s*$", text, re.IGNORECASE)
                inline = single.group(0) if single else ""
            leading = re.match(r"^\s*(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+)?(?:19|20)\d{2}\s+(?=[A-Za-z])", text, re.IGNORECASE)
            if not inline and leading:
                inline = leading.group(0)
            if inline:
                text = text.replace(inline, " ").strip(" ,–—-")
                date_text = date_text or inline.strip(" ,–—-")
            title, issuer = _split_title_issuer(text)
            add(title, issuer, date_text, heading)

    # Credentials stated only in the summary: "qualified as a CPO (Certified Protection Guard)",
    # "Completed a certificate in Warehouse Sanitation", "a valid commercial driver's license".
    for heading, body in sections.items():
        if heading == "full_text" or section_kind(heading) not in {"summary", "profile"}:
            continue
        for match in re.finditer(r"\b([A-Z]{2,6}\s*\((?:Certified|Registered|Licensed)\s+[A-Z][A-Za-z ]{3,60}\))", body):
            add(match.group(1), "", "", heading)
        for match in re.finditer(r"\bcertificate\s+in\s+([A-Z][A-Za-z&' -]{2,60}?)(?=\s+and\b|[,.;]|$)", body):
            add(f"Certificate in {match.group(1).strip()}", "", "", heading)
        for match in re.finditer(r"\b(commercial driver[’']?s licen[cs]e|professional driver[’']?s licen[cs]e)\b", body, re.IGNORECASE):
            add(match.group(1)[0].upper() + match.group(1)[1:], "", "", heading)
    return results[:20]


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
        "work history",
        "career history",
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
                "work history",
                "career history",
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
    # Contact details, summary, work history and lists: additions, read from
    # the same sections, never used by matching.
    profile_fields = resume_fields.extract_profile_fields(
        cleaned, field_sections(cleaned), field_section_kind, candidate_full_name
    )

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

    if not education_indicators and not education:
        warnings.append("No education indicators detected.")

    if not experience_indicators and not profile_fields["fields"]["work_experience"]:
        warnings.append("No experience indicators detected.")

    candidate_profile = {
        "full_name": candidate_full_name,
        "skills": skills,
        "education_indicators": education_indicators,
        "certification_indicators": certification_indicators,
        "experience_indicators": experience_indicators,
        "education": education,
        "certifications": certifications,
        **profile_fields["fields"],
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
        # How sure each field is ("high", "medium", "low", "none"; "masked" for a
        # phone number printed with X's), so the UI can ask the candidate to check.
        "field_confidence": {
            "full_name": "high" if candidate_full_name else "none",
            "education": "high" if education and all(e["degree_program"] and e["school_university"] for e in education) else ("medium" if education else "none"),
            "certifications": "medium" if certifications else "none",
            **profile_fields["confidence"],
        },
        # How the text was read, so a saved analysis shows whether it predates
        # OCR, column ordering or .doc support (see RESUME_PARSER_VERSION).
        "extraction": extraction.metadata(),
    }

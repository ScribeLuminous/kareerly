"""Profile fields read from resume text: contact details, summary, work history and more.

These are additions to the Step 1 analysis (``candidate_profile``); nothing
that existed before is changed by them, and matching does not read them.

Every extractor works on the prepared resume text and the sections that
``resume_analyzer.split_resume_sections`` finds, with fixed rules, so the same
text always gives the same result. A field the resume does not contain is
returned empty, never guessed.
"""
from __future__ import annotations

import csv
import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

from .ph_regions import regions_in_location

DATA_DIR = Path(__file__).resolve().parents[2] / "data"

# ------------------------------------------------------------
# Dates
# ------------------------------------------------------------
MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6, "jul": 7, "aug": 8,
    "sep": 9, "sept": 9, "oct": 10, "nov": 11, "dec": 12,
}
_MONTH = r"(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?"
_YEAR = r"(?:19|20)\d{2}"
_DATE_PART = rf"(?:{_MONTH}\s*,?\s*{_YEAR}|(?:0?[1-9]|1[0-2])\s*/\s*{_YEAR}|{_YEAR}\s*[/-]\s*(?:0[1-9]|1[0-2])(?!\d)|{_YEAR})"
_CURRENT = r"(?:present|current|now|to date|ongoing|today)"
_SEPARATOR = r"\s*(?:-|–|—|―|to|until|till|~)\s*"
DATE_RANGE = re.compile(
    rf"(?P<start>{_DATE_PART}|{_MONTH}){_SEPARATOR}(?P<end>{_DATE_PART}|{_CURRENT})",
    re.IGNORECASE,
)
SINGLE_DATE = re.compile(rf"\b(?:{_MONTH}\s*,?\s*{_YEAR}|(?:0?[1-9]|1[0-2])/{_YEAR})\b|\b{_YEAR}\b", re.IGNORECASE)


def normalize_date(value: str, fallback_year: Optional[str] = None) -> Optional[str]:
    """ "Sep 2022" -> "2022-09", "2021" -> "2021", "Present" -> "present", "Feb" + 2025 -> "2025-02"."""
    text = (value or "").strip().lower().rstrip(".")
    if not text:
        return None
    if re.fullmatch(_CURRENT, text):
        return "present"
    month_match = re.match(r"([a-z]+)", text)
    year_match = re.search(_YEAR, text)
    numeric = re.fullmatch(rf"(0?[1-9]|1[0-2])\s*/\s*({_YEAR})", text)
    if numeric:
        return f"{numeric.group(2)}-{int(numeric.group(1)):02d}"
    iso = re.fullmatch(rf"({_YEAR})\s*[/-]\s*(0[1-9]|1[0-2])", text)
    if iso:
        return f"{iso.group(1)}-{iso.group(2)}"
    month = MONTHS.get(month_match.group(1)[:3]) if month_match else None
    year = year_match.group(0) if year_match else fallback_year
    if not year:
        return None
    return f"{year}-{month:02d}" if month else year


_DATE_START_ONLY = re.compile(rf"(?:{_DATE_PART})\s*$", re.IGNORECASE)
_DATE_END_ONLY = re.compile(rf"^\s*(?:-|–|—|to)\s*(?:{_DATE_PART}|{_CURRENT})\b", re.IGNORECASE)


def join_split_date_ranges(lines: List[str]) -> List[str]:
    """Rejoin a date range wrapped over two lines ("... | 2018" / "– 2022", "06/2022 –" / "12/2022")."""
    joined: List[str] = []
    for line in lines:
        if joined and (
            (_DATE_START_ONLY.search(joined[-1]) and _DATE_END_ONLY.match(line))
            or (re.search(r"(?:-|–|—)\s*$", joined[-1]) and re.match(rf"^\s*(?:{_DATE_PART}|{_CURRENT})\b", line, re.IGNORECASE))
        ):
            joined[-1] = f"{joined[-1].rstrip()} {line.strip()}"
        else:
            joined.append(line)
    return joined


def find_date_ranges(text: str) -> List[Dict[str, Any]]:
    """Every date range in ``text``: start and end normalised, the text as written and its span."""
    ranges = []
    for match in DATE_RANGE.finditer(text or ""):
        end = normalize_date(match.group("end"))
        end_year = re.search(_YEAR, match.group("end") or "")
        start = normalize_date(match.group("start"), fallback_year=end_year.group(0) if end_year else None)
        if not start or not end:
            continue
        if end != "present" and start[:4] > end[:4]:
            continue
        ranges.append({"start": start, "end": end, "text": match.group(0).strip(), "span": match.span()})
    return ranges


# ------------------------------------------------------------
# Contact details
# ------------------------------------------------------------
EMAIL = re.compile(r"(?<![\w.+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b")
URL = re.compile(
    r"(?<![@\w])(?:https?://|www\.)\S+|(?<![@\w.])(?:[a-z0-9-]+\.)+(?:com|net|org|io|ph|me|dev|co|info|site)(?:/[^\s,;|)]*)?(?![\w@])",
    re.IGNORECASE,
)
PHONE = re.compile(r"(?<![\w/])(?:\+?\(?\d[\d ().\-]{6,}\d)(?![\w/])")
MASKED_PHONE = re.compile(r"\b\d{3,4}\s*[-–—]\s*X{3}\s*[-–—]\s*X{3,5}\b", re.IGNORECASE)
_PHONE_LABEL = re.compile(r"\b(?:phone|mobile|mob|cell|tel|telephone|contact(?: no\.?| number)?)\b", re.IGNORECASE)


def _looks_like_date_digits(candidate: str) -> bool:
    years = re.findall(_YEAR, candidate)
    return bool(years) and len(re.sub(r"\D", "", candidate)) <= 8 * len(years)


def _phone_prefix(value: str) -> str:
    """The number alone when the pattern ran on into the next one ("(555) 010-0123 12 Main St")."""
    groups = list(re.finditer(r"\d+", value))
    for end in range(1, len(groups) + 1):
        digits = "".join(g.group(0) for g in groups[:end])
        if 10 <= len(digits) <= 13:
            return value[: groups[end - 1].end()].rstrip()
    return value


def extract_emails(text: str) -> List[str]:
    seen, emails = set(), []
    for match in EMAIL.finditer(text or ""):
        value = match.group(0).strip(".")
        if value.lower() not in seen:
            seen.add(value.lower())
            emails.append(value)
    return emails


def extract_phone(text: str) -> Tuple[str, bool]:
    """(phone as printed, masked) for the first phone number in the resume."""
    head = text or ""
    if MASKED_PHONE.search(head):
        return "", True
    candidates = []
    for line_index, line in enumerate(head.splitlines()):
        for match in PHONE.finditer(line):
            value = _phone_prefix(match.group(0).strip().rstrip(" .-(").lstrip(" .-"))
            digits = re.sub(r"\D", "", value)
            if not 7 <= len(digits) <= 15 or _looks_like_date_digits(value):
                continue
            if re.fullmatch(r"\d{4,6}", digits) or (len(digits) < 10 and not _PHONE_LABEL.search(line)):
                continue
            # A labelled number near the top of the resume is the most likely one.
            score = (0 if _PHONE_LABEL.search(line) else 1, line_index)
            candidates.append((score, value))
    if not candidates:
        return "", False
    return sorted(candidates)[0][1], False


def extract_links(text: str) -> List[str]:
    links, seen = [], set()
    for match in URL.finditer(text or ""):
        value = match.group(0).rstrip(".,;:)")
        if "@" in value or re.fullmatch(r"[\d.]+", value):
            continue
        key = re.sub(r"^(https?://)?(www\.)?", "", value.lower()).rstrip("/")
        if key not in seen:
            seen.add(key)
            links.append(value)
    return links


# A US-style "City, ST" or "City, ST 12345".
_CITY_STATE = re.compile(r"^[A-Z][A-Za-z .'-]+,\s*[A-Z]{2}(?:\s+\d{5})?$")
_COUNTRIES = {"philippines", "united states", "usa", "us", "united kingdom", "uk", "canada", "australia", "singapore",
              "japan", "united arab emirates", "uae", "saudi arabia", "qatar", "hong kong", "new zealand", "malaysia"}
_STREET = re.compile(
    r"^\s*(?:#|no\.?\s*)?\d+[A-Za-z-]*\s+.*\b(?:st|street|ave|avenue|road|rd|blvd|boulevard|drive|dr|lane|ln|highway|hwy|purok|sitio|block|blk|lot|phase|village|subd|subdivision)\b",
    re.IGNORECASE,
)


def _is_place(segment: str) -> bool:
    segment = segment.strip()
    if not segment or len(segment) > 70 or EMAIL.search(segment) or re.search(r"\d{7,}", re.sub(r"[ ()-]", "", segment)):
        return False
    if regions_in_location(segment):
        # "Pasig City", "Tabuk City, Kalinga", "Makati": a Philippine place. A company that
        # happens to contain a province ("Basilan Strait Shipping Lines") is not one.
        return ("," in segment or re.search(r"\b(?:city|province|municipality|metro|town)\b", segment, re.IGNORECASE)
                or len(segment.split()) <= 2) and not _is_org(segment)
    if _CITY_STATE.match(segment):
        return True
    return any(country in segment.lower().split(", ") or segment.lower().endswith(country) for country in _COUNTRIES) and len(segment.split()) <= 6


def city_level(address: str) -> str:
    """ "12 Main St, CA 90210 Springfield" -> "Springfield, CA"; a street line is dropped."""
    parts = [part.strip() for part in re.split(r",|\|", address or "") if part.strip()]
    kept = []
    for part in parts:
        if _STREET.match(part):
            continue
        part = re.sub(r"\b\d{4,6}\b", "", part).strip()  # postcodes
        # What is left of a street line ("12 Rizal") still starts with its house number.
        if len(parts) > 1 and re.match(r"^#?\d+[A-Za-z-]*\s", part):
            continue
        state_first = re.match(r"^([A-Z]{2})\s+(.+)$", part)
        if state_first:
            part = f"{state_first.group(2)}, {state_first.group(1)}"
        if part:
            kept.append(part)
    return re.sub(r"\s+", " ", ", ".join(kept)).strip(" ,")


def extract_location(header_lines: Sequence[str], labelled_text: str = "") -> str:
    """The candidate's city or town, from the contact lines or an "Address:" label."""
    label = re.search(r"(?im)^\s*(?:address|location|residence|home address|current address|city)\s*[:|]?\s+(.+)$", labelled_text or "") \
        or re.search(r"(?i)\b(?:home address|current address|address|location)\s*:\s*(.+)$", labelled_text or "", re.MULTILINE)
    if label:
        place = city_level(label.group(1))
        if place:
            return place
    countries = []
    for line in header_lines:
        cleaned = MASKED_PHONE.sub(" ", line)
        cleaned = re.sub(r"\b\d{3,4}\s*[-–—]\s*[Xx]{3}\s*[-–—]\s*[Xx]{3,5}\b", " ", cleaned)  # OCR'd masks
        cleaned = EMAIL.sub(" ", cleaned)
        cleaned = URL.sub(" ", cleaned)
        # Remove the phone number but keep what the pattern ran on into (the "12" of "12 Main St").
        cleaned = PHONE.sub(lambda m: " " + m.group(0)[len(_phone_prefix(m.group(0))):], cleaned)
        for segment in re.split(r"\s*(?:\||·|•|◆|‣|\s{2,}|\t)\s*", cleaned):
            segment = segment.strip(" ,;-–—")
            if not segment:
                continue
            had_street = bool(_STREET.match(segment))
            if had_street or re.search(r"\b\d{4,6}\b", segment):
                segment = city_level(segment)
                # What is left after the street and postcode of an address is its town.
                if had_street and segment and 1 <= len(segment.split()) <= 4 and not EMAIL.search(segment):
                    return segment if not segment.isupper() else segment.title()
            if _is_place(segment):
                place = city_level(segment) or segment
                if place.lower() in _COUNTRIES:
                    countries.append(place)  # a bare country only when no city is given
                    continue
                return place
    return countries[0] if countries else ""


# ------------------------------------------------------------
# Work history
# ------------------------------------------------------------
_EXTRA_TITLE_WORDS = {
    "intern", "interns", "trainee", "apprentice", "volunteer", "freelancer", "pair", "nanny", "caretaker", "nurse",
    "cashier", "chef", "receptionist", "teller", "programmer", "architect", "consultant", "president", "governor",
    "treasurer", "secretary", "member", "head", "lead", "manager", "assistant", "associate", "officer", "analyst",
    "designer", "developer", "engineer", "specialist", "coordinator", "supervisor", "director", "administrator",
    "representative", "technician", "operator", "clerk", "agent", "guard", "teacher", "tutor", "writer", "editor",
    "accountant", "auditor", "bookkeeper", "encoder", "driver", "cook", "worker", "helper", "attendant", "aide",
    "caregiver", "instructor", "professor", "lecturer", "scientist", "researcher", "planner", "inspector", "foreman",
    "electrician", "mechanic", "carpenter", "laborer", "salesperson", "merchandiser", "executive", "owner", "founder",
    "partner", "staff", "crew", "barista", "server", "waiter", "waitress", "housekeeper", "janitor", "custodian",
    "dispatcher", "courier", "messenger", "photographer", "videographer", "artist", "illustrator", "animator",
    "producer", "marketer", "strategist", "recruiter", "generalist", "paralegal", "lawyer", "attorney", "pharmacist",
    "therapist", "midwife", "physician", "doctor", "dentist", "trainer", "coach", "facilitator", "va", "ojt",
}
_ORG_WORDS = {
    "inc", "inc.", "incorporated", "corp", "corp.", "corporation", "co", "co.", "company", "llc", "ltd", "ltd.",
    "limited", "group", "services", "service", "solutions", "systems", "technologies", "technology", "university",
    "college", "school", "academy", "institute", "hospital", "clinic", "bank", "family", "foundation", "cooperative",
    "agency", "center", "centre", "laboratories", "laboratory", "labs", "advertising", "designs", "media", "studio",
    "studios", "enterprises", "enterprise", "trading", "industries", "holdings", "partners", "associates", "firm",
    "office", "department", "council", "authority", "ministry", "bureau", "store", "stores", "restaurant", "hotel",
    "resort", "petroleum", "lubricants", "security", "logistics", "distribution", "manufacturing", "marketing",
    "consulting", "software", "works", "cpas", "philippines", "ph", "global", "international", "self-employed",
}


@lru_cache(maxsize=1)
def title_words() -> frozenset:
    """Head words of job titles: the last word of every catalogue job title, plus common roles."""
    words = set(_EXTRA_TITLE_WORDS)
    try:
        with open(DATA_DIR / "reference_jobs.csv", newline="", encoding="utf-8") as handle:
            for row in csv.DictReader(handle):
                title = re.sub(r"\([^)]*\)", "", row.get("job_title") or "").strip().lower().split()
                if title and re.fullmatch(r"[a-z]+", title[-1]):
                    words.add(title[-1])
    except OSError:
        pass
    # Words that end catalogue titles but name an activity, not a role.
    return frozenset(words - {"support", "operations", "construction", "coordination", "applications", "manage"})


_SEGMENT_SPLIT = re.compile(r"\s+[|·•]\s+|\s+[—–]\s+|\s+-\s+|\t")
_BULLET = re.compile(r"^\s*(?:[•●▪■◦*‣⁃○»>+]|[-–—](?=\s)|\d+[.)]\s)")


def _words(text: str) -> List[str]:
    return re.findall(r"[a-z]+", text.lower())


def _is_title(text: str) -> bool:
    words = _words(re.sub(r"\([^)]*\)", " ", text))
    if not words or len(words) > 8:
        return False
    heads = title_words()
    if words[-1] in heads:
        return True
    # "Intern - IT Department", "Manager at X" are split earlier; "Au Pair", "OJT" anywhere.
    return any(word in {"intern", "trainee", "ojt", "pair"} for word in words) or (len(words) >= 2 and words[-2] in heads and words[-1] in {"i", "ii", "iii", "iv"})


def _is_org(text: str) -> bool:
    tokens = [token.lower().strip(",.()") for token in text.split()]
    return any(token in _ORG_WORDS or token.rstrip(".") in _ORG_WORDS for token in tokens)


def _is_department(text: str) -> bool:
    return bool(re.search(r"\b(?:department|dept\.?|division|unit|team)\b", text, re.IGNORECASE)) and len(text.split()) <= 5


def _clean_segment(text: str) -> str:
    text = re.sub(r"\(\s*\)", "", text)
    text = re.sub(r"\s+", " ", text).strip(" ,;:|-–—·")
    # Trim a bracket only when it is unmatched ("(June 2014 – Feb 2015" after the dates are removed),
    # so "Reports Intern (OJT)" keeps its own.
    while text.endswith(")") and text.count(")") > text.count("("):
        text = text[:-1].rstrip()
    while text.startswith("(") and text.count("(") > text.count(")"):
        text = text[1:].lstrip()
    return text.strip(" ,;:|-–—·")


def _split_header(text: str) -> List[str]:
    segments = []
    for part in _SEGMENT_SPLIT.split(text):
        part = _clean_segment(part)
        if part:
            segments.append(part)
    return segments


def _parse_header(header_lines: Sequence[str]) -> Dict[str, Optional[str]]:
    """Job title, company, department and location from an entry's header lines (dates removed)."""
    segments: List[str] = []
    line_of: Dict[int, int] = {}
    for line_number, line in enumerate(header_lines):
        at = re.match(r"^(.+?)\s+at\s+(.+)$", line)
        parts = [_clean_segment(at.group(1)), *_split_header(at.group(2))] if at and _is_title(at.group(1)) else _split_header(line)
        for part in parts:
            line_of[id(part)] = line_number
            segments.append(part)
    title = company = department = location = None
    rest: List[str] = []
    for segment in segments:
        if title is None:
            comma = re.match(r"^([^,]+),\s*(.+)$", segment)
            if comma and _is_title(comma.group(1)) and not _is_title(segment.split(",")[-1]):
                title = comma.group(1).strip()
                rest.append(comma.group(2).strip())
                continue
            # A role is decided by its last word: "Global Key Account Manager" is a title
            # even though "global" can also name a company.
            last = segment.split()[-1].lower().strip(".,()") if segment.split() else ""
            if _is_title(segment) and last not in _ORG_WORDS:
                title = segment
                continue
            # "Automation Scripting Specialist, Oct 2023" has its date removed already.
        rest.append(segment)
    remaining = []
    for segment in rest:
        if department is None and _is_department(segment):
            department = segment
        elif location is None and _is_place(segment) and (company is not None or len(rest) > 1) and not _is_org(segment):
            location = segment
        elif company is None and not re.search(r"\d+\s*(?:hours|hrs)\b", segment, re.IGNORECASE):
            company = segment
        else:
            remaining.append(segment)
    if title is None and company is not None and remaining and line_of.get(id(company)) == line_of.get(id(remaining[0])):
        # No title word matched: in an "A | B" header on one line the role comes first.
        title, company = company, remaining.pop(0)
    if location is None:
        for segment in remaining:
            if _is_place(segment):
                location = segment
                break
    if company and location is None:
        # "Inash Oil & Petroleum, Dallas, TX": a trailing place after the company.
        parts = [p.strip() for p in company.split(",")]
        for cut in (2, 1):
            if len(parts) > cut and _is_place(", ".join(parts[-cut:])) and not _is_org(", ".join(parts[-cut:])):
                company, location = ", ".join(parts[:-cut]), ", ".join(parts[-cut:])
                break
        else:
            # "Smith Family, Kansas City", "ADT Security, Port Washington": a short
            # place name after an organisation word.
            if len(parts) > 1 and _is_org(", ".join(parts[:-1])) and not _is_org(parts[-1]) \
                    and 1 <= len(parts[-1].split()) <= 3 and all(w[:1].isupper() for w in parts[-1].split()) \
                    and not parts[-1].isupper():
                company, location = ", ".join(parts[:-1]), parts[-1]
    return {"job_title": title, "company": company, "department": department, "location": location}


def _employment_type(text: str) -> Optional[str]:
    lowered = text.lower()
    if re.search(r"\b(?:intern|internship|ojt|on-the-job|practicum|trainee)\b", lowered):
        return "internship"
    for label in ("part-time", "part time", "freelance", "contract", "self-employed", "volunteer"):
        if label in lowered:
            return label.replace(" ", "-")
    return None


def _usable_header_line(line: str) -> bool:
    """A line that can hold a job title, company or place: not a bullet, a sentence or a wrapped description."""
    line = line.strip()
    # "Xerox Business Services Philippines Inc." ends with an abbreviation, not a sentence.
    sentence_end = line.endswith(".") and not re.search(r"\b[A-Z][A-Za-z]{0,3}\.$", line)
    if not line or _BULLET.match(line) or len(line) > 110 or sentence_end or line[:1].islower():
        return False
    # Header lines are mostly capitalised words ("Mathematics Teacher and School Data Coordinator —
    # Apo View Integrated High School"); a description sentence is not ("Ensure that children are fed").
    long_words = [w for w in re.findall(r"[A-Za-z][A-Za-z'&.-]*", line) if len(w) >= 4]
    if len(long_words) >= 4 and sum(w[0].isupper() for w in long_words) < 0.5 * len(long_words):
        return False
    # A description wrapped onto the next line ("Provided Level 1 support, handled ... and").
    return len(line.split()) <= 14 and not re.search(r"\b(?:and|or|of|the|to|with|as|a|by|for|in)$", line, re.IGNORECASE)


def _score_header(parsed: Dict[str, Optional[str]]) -> int:
    return 2 * bool(parsed["job_title"]) + 2 * bool(parsed["company"]) + bool(parsed["location"])


def extract_work_experience(sections: Sequence[Tuple[str, str]], kind_of) -> List[Dict[str, Any]]:
    """One entry per job in the experience sections, each anchored on its date range.

    A job's title and company sit on the date line or on the line just above or
    below it, in many arrangements ("Title, Company" over "Place | Date",
    "Date Title" over "Company, Place", "Company — Place" over "Title, Date").
    The date line is completed with whichever neighbouring lines give both a
    title and a company.
    """
    entries: List[Dict[str, Any]] = []
    for heading, body in sections:
        if kind_of(heading) != "experience":
            continue
        lines = join_split_date_ranges([line.rstrip() for line in body.splitlines() if line.strip()])
        anchors = [(index, find_date_ranges(line)) for index, line in enumerate(lines)]
        anchors = [(index, found[0]) for index, found in anchors if found and not _BULLET.match(lines[index])]
        used_until = -1
        for position, (index, date) in enumerate(anchors):
            line = lines[index]
            on_line_text = " ".join(part for part in (line[:date["span"][0]], line[date["span"][1]:]) if part.strip())
            on_line = [on_line_text] if _clean_segment(on_line_text) else []
            # Lines just above the date line that belong to this job, not to the one before.
            before: List[str] = []
            for back in range(index - 1, max(used_until, index - 3), -1):
                if not _usable_header_line(lines[back]) or find_date_ranges(lines[back]):
                    break
                # The second line of a wrapped bullet from the job above is not a header.
                previous = lines[back - 1].rstrip() if back - 1 > used_until else ""
                if previous and _BULLET.match(previous) and len(previous) >= 70 and not previous.endswith((".", ")")):
                    break
                before.insert(0, lines[back])
            next_anchor = anchors[position + 1][0] if position + 1 < len(anchors) else len(lines)
            after = [lines[index + 1]] if index + 1 < next_anchor and _usable_header_line(lines[index + 1]) else []
            options = [on_line, before[-1:] + on_line, on_line + after, before + on_line, before[-1:] + on_line + after]
            best, best_lines = None, []
            for option in options:
                if not option:
                    continue
                parsed = _parse_header(option)
                if best is None or _score_header(parsed) > _score_header(best):
                    best, best_lines = parsed, option
                if parsed["job_title"] and parsed["company"]:
                    break
            if best is None or (not best["job_title"] and not best["company"]):
                continue
            used_until = index + (1 if after and after[0] in best_lines else 0)
            parsed = best
            context = " ".join(best_lines) + " " + heading
            entries.append({
                "job_title": parsed["job_title"] or "",
                "company": parsed["company"] or "",
                "department": parsed["department"] or "",
                "location": parsed["location"] or "",
                "start_date": date["start"],
                "end_date": date["end"],
                "is_current": date["end"] == "present",
                "dates_as_written": date["text"],
                "employment_type": _employment_type(context) or "",
            })
    return entries


# ------------------------------------------------------------
# Lists: languages, interests, achievements, projects, references
# ------------------------------------------------------------
LANGUAGE_NAMES = {
    "english", "filipino", "tagalog", "cebuano", "bisaya", "binisaya", "visayan", "ilocano", "ilokano", "hiligaynon",
    "ilonggo", "waray", "kapampangan", "pangasinan", "bikol", "bicolano", "chavacano", "maranao", "maguindanao",
    "tausug", "kinaray-a", "spanish", "french", "german", "italian", "portuguese", "dutch", "flemish", "russian",
    "chinese", "mandarin", "cantonese", "hokkien", "japanese", "korean", "arabic", "hindi", "urdu", "bengali",
    "indonesian", "malay", "thai", "vietnamese", "turkish", "greek", "polish", "swedish", "norwegian", "danish",
    "finnish", "hebrew", "persian", "tamil", "sign language", "asl", "fsl",
}
_PROFICIENCY = re.compile(
    r"\b(?:native|fluent|fluency|proficient|proficiency|basic|beginner|elementary|intermediate|advanced|conversational|"
    r"working|professional|limited|full|excellent|very good|good|fair|mother tongue|written|spoken|oral|reading|writing|"
    r"speaking|and|both|knowledge|of|in|[abc][12])\b",
    re.IGNORECASE,
)


def _language_tokens(line: str) -> Optional[List[str]]:
    """The languages a line names, or None when it is not a line about languages."""
    text = re.sub(r"\([^)]*\)", " ", line)
    parts = [p.strip() for p in re.split(r"[,;/|•·\-–—]|\band\b", text, flags=re.IGNORECASE) if p.strip()]
    found = []
    for part in parts:
        leftover = _PROFICIENCY.sub(" ", part).strip(" :.")
        if not leftover:
            continue
        if leftover.lower() in LANGUAGE_NAMES:
            found.append(leftover.title() if leftover.lower() not in {"asl", "fsl"} else leftover.upper())
        else:
            return None
    return found or None


def extract_languages(sections: Sequence[Tuple[str, str]], kind_of) -> List[str]:
    languages: List[str] = []
    for heading, body in sections:
        kind = kind_of(heading)
        if kind not in {"languages", "skills", "personal_details"}:
            continue
        for line in body.splitlines():
            tokens = _language_tokens(line)
            if tokens is None:
                continue
            for token in tokens:
                if token not in languages:
                    languages.append(token)
    return languages


def _list_items(body: str) -> List[str]:
    """Items of a list section: bullets and lines, wrapped lines joined back."""
    items: List[str] = []
    for raw in body.splitlines():
        line = raw.strip()
        if not line:
            continue
        bullet = bool(_BULLET.match(line))
        line = _BULLET.sub("", line).strip()
        previous = items[-1] if items else ""
        wrapped = previous and not bullet and not previous.endswith(".") and (
            line[:1].islower() or line[:1] == "("
            or re.search(r"(?:,|&|\b(?:and|of|the|in|for|to|with|at|by|from|on|or))$", previous)
            or (len(line.split()) <= 6 and re.search(r"\((?:19|20)\d{2}", line) and not previous.endswith(")"))
        )
        if wrapped:
            items[-1] = f"{previous} {line}"
        else:
            items.append(line)
    return [item for item in items if len(item) >= 3]


def extract_interests(sections: Sequence[Tuple[str, str]], kind_of) -> List[str]:
    interests: List[str] = []
    for heading, body in sections:
        if kind_of(heading) != "interests":
            continue
        for item in _list_items(body):
            for part in re.split(r"\s*[,;•·]\s*", item):
                part = part.strip(" .")
                if part and len(part.split()) <= 5 and part not in interests:
                    interests.append(part)
    return interests


_HONOR = re.compile(
    r"\b(?:dean'?s list(?:er)?|cum laude|magna cum laude|summa cum laude|with honou?rs|valedictorian|salutatorian|"
    r"scholar|awardee|award|honou?r roll|best\b|champion|first place|1st place|employee of the (?:month|year))",
    re.IGNORECASE,
)


def extract_achievements(sections: Sequence[Tuple[str, str]], kind_of) -> List[Dict[str, str]]:
    achievements: List[Dict[str, str]] = []
    for heading, body in sections:
        kind = kind_of(heading)
        if kind in {"achievements", "activities"}:
            for item in _list_items(body):
                achievements.append({"text": item, "section": heading})
        elif kind == "education":
            for item in _list_items(body):
                if _HONOR.search(item) and len(item) <= 120 and not re.search(r"\b(?:bachelor|master|bs|ba|degree)\b", item, re.IGNORECASE):
                    achievements.append({"text": item, "section": heading})
    return achievements


def extract_projects(sections: Sequence[Tuple[str, str]], kind_of) -> List[Dict[str, str]]:
    projects: List[Dict[str, str]] = []
    for heading, body in sections:
        kind = kind_of(heading)
        if kind == "projects":
            for item in _list_items(body):
                if len(item) <= 160:
                    projects.append({"name": item, "section": heading})
        elif kind == "education":
            for item in _list_items(body):
                if re.match(r"^(?:thesis|capstone|undergraduate thesis|capstone project|research)\b\s*[:—–-]", item, re.IGNORECASE):
                    projects.append({"name": item, "section": heading})
    return projects


def extract_references(sections: Sequence[Tuple[str, str]], kind_of) -> str:
    for heading, body in sections:
        if kind_of(heading) != "references":
            continue
        if re.search(r"\b(?:available|furnished|provided)\b.*\brequest\b|\bupon request\b|\bon request\b", body, re.IGNORECASE):
            return "available_on_request"
        if body.strip():
            return "listed"
    return ""


# ------------------------------------------------------------
# Summary and headline
# ------------------------------------------------------------

def extract_summary(sections: Sequence[Tuple[str, str]], kind_of) -> Tuple[str, str]:
    """(summary text, "profile" or "objective") from the first summary or objective section."""
    for heading, body in sections:
        if kind_of(heading) != "summary":
            continue
        lines = [line.strip() for line in body.splitlines() if line.strip()]
        lines = [line for line in lines if not EMAIL.search(line) and not (PHONE.search(line) and len(line) < 40)]
        text = re.sub(r"\s+", " ", " ".join(lines)).strip()
        if len(text.split()) >= 6:
            return text, "objective" if "objective" in heading or "goal" in heading else "profile"
    return "", ""


def extract_headline(header_lines: Sequence[str], name: str) -> str:
    """The job title or degree printed under (or beside) the name."""
    name_key = re.sub(r"[^a-z]", "", (name or "").lower())
    seen_name = not name_key
    for line in header_lines[:6]:
        compact = re.sub(r"[^a-z]", "", line.lower())
        if name_key and name_key in compact:
            seen_name = True
            beside = re.split(r",\s*|\s+[|—–-]\s+", line, maxsplit=1)
            if len(beside) == 2 and re.sub(r"[^a-z]", "", beside[0].lower()) == name_key and _is_title(beside[1]):
                return beside[1].strip()
            continue
        if not seen_name:
            continue
        if EMAIL.search(line) or URL.search(line) or re.search(r"\d{3}", line) or _is_place(line):
            continue
        candidate = line.strip(" |·")
        if 1 <= len(candidate.split()) <= 9 and (_is_title(re.split(r"\s+[—–(]\s*", candidate)[0]) or re.match(r"^(?:BS|BA|AB|MS|MA|Bachelor|Master)\b", candidate)):
            return candidate
        break
    return ""


# ------------------------------------------------------------
# All fields
# ------------------------------------------------------------

CONTACT_KINDS = {"preamble", "contact", "personal_details", "links"}


def _header_lines(text: str, sections: Sequence[Tuple[str, str]], kind_of) -> List[str]:
    """The name and contact lines: the text above the first heading, contact sections, and the
    lines around the first email or phone number (a sidebar can put them below other sections)."""
    lines: List[str] = []
    for heading, body in sections:
        if kind_of(heading) in CONTACT_KINDS:
            lines.extend(line.strip() for line in body.splitlines()[:25] if line.strip())
    all_lines = [line.strip() for line in (text or "").splitlines() if line.strip()]
    for index, line in enumerate(all_lines[:60]):
        if EMAIL.search(line) or (PHONE.search(line) and len(re.sub(r"\D", "", line)) >= 10):
            for nearby in all_lines[max(0, index - 4): index + 9]:
                if nearby not in lines:
                    lines.append(nearby)
            break
    return lines


def extract_profile_fields(text: str, sections: Sequence[Tuple[str, str]], kind_of, full_name: str) -> Dict[str, Any]:
    """The new candidate_profile fields, and how confident each one is."""
    header = _header_lines(text, sections, kind_of) or [line for line in (text or "").splitlines()[:12] if line.strip()]
    contact_text = "\n".join(header)
    emails = extract_emails(contact_text) or extract_emails(text)
    phone, phone_masked = extract_phone(contact_text)
    if not phone and not phone_masked:
        phone, phone_masked = extract_phone("\n".join((text or "").splitlines()[:30]))
    links = extract_links(contact_text)
    location = extract_location(header, contact_text)
    summary, summary_type = extract_summary(sections, kind_of)
    work = extract_work_experience(sections, kind_of)
    fields = {
        "email": emails[0] if emails else "",
        "phone": phone,
        "location": location,
        "links": links,
        "headline": extract_headline(header, full_name),
        "summary": summary,
        "work_experience": work,
        "languages": extract_languages(sections, kind_of),
        "interests": extract_interests(sections, kind_of),
        "achievements": extract_achievements(sections, kind_of),
        "projects": extract_projects(sections, kind_of),
        "references": extract_references(sections, kind_of),
    }
    has_experience_section = any(kind_of(heading) == "experience" for heading, _ in sections)
    confidence = {
        "email": "high" if fields["email"] else "none",
        "phone": "masked" if phone_masked else ("high" if phone else "none"),
        "location": "medium" if location else "none",
        "summary": "high" if summary else "none",
        "work_experience": (
            "high" if work and all(e["job_title"] and e["company"] for e in work)
            else "medium" if work
            else "low" if has_experience_section
            else "none"
        ),
    }
    return {"fields": fields, "confidence": confidence, "phone_masked": phone_masked}

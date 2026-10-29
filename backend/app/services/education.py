"""Highest educational attainment as one fixed list.

The profile used to take free text, so the same level arrived as "Bachelor",
"bachelor's deg." and "Bachelors Degree", which makes any count by education
level unreliable. Every stored value is now one of EDUCATION_LEVELS.

The rules are mirrored in frontend/src/lib/education.ts and in the SQL
function public.normalize_education_level (migration 20261028110000); the three
share the same test cases.
"""

from __future__ import annotations

import re

EDUCATION_LEVELS = [
    "High School",
    "Vocational / Technical",
    "Some College",
    "Associate Degree",
    "Bachelor's Degree",
    "Master's Degree",
    "Doctorate Degree",
]

# Checked in order, so "master's in education" is not read as a bachelor's.
_RULES = [
    ("Doctorate Degree", r"\b(doctor|doctorate|doctoral|phd|edd|dba)\b"),
    ("Master's Degree", r"\b(master|masters|mba|msc|ms|ma|postgrad|postgraduate|post graduate)\b"),
    ("Bachelor's Degree", r"\b(bachelor|bachelors|baccalaureate|college graduate|bs|bsc|ba|ab|bse|bsed|beed|undergraduate degree)\b"),
    ("Associate Degree", r"\b(associate|associates|aas)\b"),
    ("Vocational / Technical", r"\b(vocational|technical|tesda|trade|nc ii|nc iii|nc iv)\b"),
    ("Some College", r"\b(some college|college level|undergraduate|undergrad|currently enrolled|ongoing)\b"),
    ("High School", r"\b(high school|highschool|senior high|junior high|shs|secondary|k 12|k12)\b"),
]


def normalize_education_level(value: object) -> str:
    """The matching entry of EDUCATION_LEVELS, or "" when the text names none."""
    text = str(value or "").lower().replace("’", "'")
    text = re.sub(r"['.]", "", text)
    text = re.sub(r"[^a-z0-9]+", " ", text).strip()
    if not text:
        return ""
    for level in EDUCATION_LEVELS:
        if re.sub(r"[^a-z0-9]+", " ", level.lower().replace("'", "")).strip() == text:
            return level
    for level, pattern in _RULES:
        if re.search(pattern, text):
            return level
    return ""


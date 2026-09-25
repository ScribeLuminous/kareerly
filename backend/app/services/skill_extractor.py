import re
from pathlib import Path
from typing import Any, Optional, Union

import pandas as pd

from .split_words import build_split_word_vocabulary
from .taxonomy_additions import merge_reference_rows


BACKEND_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = BACKEND_DIR / "data"
SKILLS_REFERENCE_PATH = DATA_DIR / "skills_reference.csv"
REFERENCE_JOBS_PATH = DATA_DIR / "reference_jobs.csv"
JOB_INDEX_PATH = BACKEND_DIR / "baseline_models" / "job_index.csv"
MAX_CONFIRMED_SKILLS = 20


def _normalize_alias(value: str) -> str:
    if not isinstance(value, str):
        return ""

    value = value.strip().lower()
    value = re.sub(r"[\u2019'`]+", "'", value)
    value = re.sub(r"[\-_/]+", " ", value)
    value = re.sub(r"[^a-z0-9+#.'\s]", " ", value)
    value = re.sub(r"\s+", " ", value)

    return value.strip()

SHORT_ALIAS_ALLOWLIST = {
    "sql",
    "git",
    "aws",
    "crm",
    "seo",
    "css",
    "php",
    "api",
    "ui",
    "ux",
}

BROAD_SKILL_TERMS = {
    "adaptability",
    "communication",
    "collaboration",
    "creativity",
    "critical thinking",
    "customer service",
    "decision making",
    "interpersonal skills",
    "leadership",
    "management",
    "organization",
    "problem solving",
    "teamwork",
    "time management",
}

CONCRETE_SKILL_TERMS = {
    "api",
    "aws",
    "css",
    "excel",
    "figma",
    "git",
    "html",
    "javascript",
    "mysql",
    "php",
    "python",
    "react",
    "sql",
    "tableau",
    "typescript",
}


def _compact_alias(value: str) -> str:
    normalized = _normalize_alias(value)
    return re.sub(r"[^a-z0-9+#]+", "", normalized)


def _has_fragmented_spacing(text: str) -> bool:
    """
    Detects text patterns like:
    c u s t o m e r
    d a t a e n t r y
    m i c r o s o f t e x c e l
    """
    if not text:
        return False

    return re.search(r"(?:\b[A-Za-z0-9]\b\s*){5,}", text) is not None

def _split_alias_terms(value: Any) -> list[str]:
    """Split a reference list field into its entries.

    The reference lists are ';'-separated. Commas belong to the labels
    themselves ("Education, Training, and Community Services"), so splitting on
    them would turn single words such as "education" into aliases.
    """
    if value is None or pd.isna(value):
        return []

    text = str(value)
    text = text.replace("\n", ";")
    text = text.replace("|", ";")

    return [part.strip() for part in text.split(";") if part.strip()]


EVIDENCE_WINDOW_CHARS = 60


def _evidence_window(normalized_text: str, position: int, length: int) -> str:
    """The words around a skill mention, so a report can quote where it was found."""
    if not normalized_text:
        return ""
    start = max(0, position - EVIDENCE_WINDOW_CHARS)
    end = min(len(normalized_text), position + length + EVIDENCE_WINDOW_CHARS)
    # Widen to whole words.
    while start > 0 and normalized_text[start - 1] != " ":
        start -= 1
    while end < len(normalized_text) and normalized_text[end] != " ":
        end += 1
    snippet = normalized_text[start:end].strip()
    return ("... " if start > 0 else "") + snippet + (" ..." if end < len(normalized_text) else "")


def _is_group_label(value: str) -> bool:
    """Taxonomy group labels such as "Healthcare, Caregiving, and Wellness"."""
    return bool(re.search(r",\s*(?:and|&)\s+\S", value))


class SkillExtractor:
    def __init__(
        self,
        skills_path: Union[str, Path] = SKILLS_REFERENCE_PATH,
        extra_rows: Optional[list[dict[str, Any]]] = None,
    ):
        """``extra_rows`` are approved taxonomy additions (see taxonomy_additions.py)."""
        self.skills_path = Path(skills_path)
        self.extra_rows = extra_rows or []
        self.rows: list[dict[str, Any]] = []
        self.alias_map: dict[str, list[int]] = {}
        self.ordered_aliases: list[str] = []
        self._alias_pattern: re.Pattern[str] | None = None
        self._compact_alias_map: dict[str, list[str]] = {}
        self._compact_alias_pattern: re.Pattern[str] | None = None
        self.job_market_relevance: dict[str, float] = {}
        self._split_word_vocabulary: Optional[dict[str, tuple[str, ...]]] = None

        self._load_skills_reference()
        self._build_alias_index()
        self.job_market_relevance = self._build_job_market_relevance()

    def _load_skills_reference(self) -> None:
        if not self.skills_path.exists():
            raise FileNotFoundError(
                f"Missing skills reference file: {self.skills_path}"
            )

        try:
            df = pd.read_csv(
                self.skills_path,
                dtype=str,
                keep_default_na=False,
                encoding="utf-8",
            )
        except UnicodeDecodeError:
            df = pd.read_csv(
                self.skills_path,
                dtype=str,
                keep_default_na=False,
                encoding="latin-1",
            )

        df.columns = [column.strip() for column in df.columns]

        for _, row in df.iterrows():
            skill_row = {
                "skill_id": row.get("skill_id", "").strip(),
                "category_id": row.get("category_id", "").strip(),
                "skill_name": row.get("skill_name", "").strip(),
                "skill_category": row.get("skill_category", "").strip(),
                "skill_subcategory": row.get("skill_subcategory", "").strip(),
                "related_skills": row.get("related_skills", "").strip(),
                "esco_preferred_label": row.get("esco_preferred_label", "").strip(),
                "esco_alternative_labels": row.get("esco_alternative_labels", "").strip(),
                "approved_aliases": row.get("approved_aliases", "").strip(),
            }

            if skill_row["skill_id"] and skill_row["skill_name"]:
                self.rows.append(skill_row)

        self.rows = merge_reference_rows(self.rows, self.extra_rows)

    def _category_label_terms(self) -> set[str]:
        """Words that only name a taxonomy category, such as "data" or "business".

        related_skills also lists the skill's category and subcategory labels, and
        splitting "Technology, Data, and Digital Systems" on commas turns ordinary
        resume words into aliases for every skill in that category.
        """
        terms: set[str] = set()
        for row in self.rows:
            labels = [row.get("skill_category", ""), row.get("skill_subcategory", "")]
            # related_skills also carries the parent group labels, which never
            # appear in the category columns.
            labels += [part for part in _split_alias_terms(row.get("related_skills", "")) if _is_group_label(part)]
            for label in labels:
                terms.add(_normalize_alias(label))
                terms.update(_normalize_alias(part) for part in re.split(r",|\band\b|&", label))
        terms.discard("")
        return terms

    def _build_alias_index(self) -> None:
        category_terms = self._category_label_terms()

        for row_index, row in enumerate(self.rows):
            alias_candidates = []

            alias_candidates.append(row.get("skill_name", ""))

            for field in [
                "related_skills",
                "esco_preferred_label",
                "esco_alternative_labels",
                "approved_aliases",
            ]:
                alias_candidates.extend(_split_alias_terms(row.get(field, "")))

            normalized_aliases = set()
            own_names = {
                _normalize_alias(row.get("skill_name", "")),
                _normalize_alias(row.get("esco_preferred_label", "")),
            }

            for alias in alias_candidates:
                normalized_alias = _normalize_alias(alias)

                if not normalized_alias:
                    continue

                # Avoid noisy aliases like "ai", "hr", "pr" unless intentionally handled later.
                if len(normalized_alias) < 3:
                    continue

                # A category word stays an alias only for a skill actually named that.
                if normalized_alias in category_terms and normalized_alias not in own_names:
                    continue

                normalized_aliases.add(normalized_alias)

            for normalized_alias in normalized_aliases:
                self.alias_map.setdefault(normalized_alias, []).append(row_index)

        # Longer aliases first prevents "data" from matching before "data analysis".
        self.ordered_aliases = sorted(
            self.alias_map.keys(),
            key=len,
            reverse=True,
        )
        if self.ordered_aliases:
            self._alias_pattern = re.compile(
                r"(?<!\w)(?:" + "|".join(re.escape(alias) for alias in self.ordered_aliases) + r")(?!\w)",
                flags=re.IGNORECASE,
            )

        for alias in self.ordered_aliases:
            compact_alias = _compact_alias(alias)
            if len(compact_alias) >= 5 or compact_alias in SHORT_ALIAS_ALLOWLIST:
                self._compact_alias_map.setdefault(compact_alias, []).append(alias)
        compact_aliases = sorted(self._compact_alias_map, key=len, reverse=True)
        if compact_aliases:
            # Lookahead preserves overlapping compact matches from letter-spaced
            # PDF extraction while scanning the text only once.
            self._compact_alias_pattern = re.compile(
                r"(?=(" + "|".join(re.escape(alias) for alias in compact_aliases) + r"))",
                flags=re.IGNORECASE,
            )

    def split_word_vocabulary(self) -> dict[str, tuple[str, ...]]:
        """Single-word skill names and aliases, as written, for rejoining split words.

        Built from names and aliases only (never descriptions), so a split is
        rejoined only into a word that names a skill. See split_words.py.
        """
        if self._split_word_vocabulary is None:
            names: list[str] = []
            for row in self.rows:
                names.append(row.get("skill_name", ""))
                for field in ["related_skills", "esco_preferred_label", "esco_alternative_labels", "approved_aliases"]:
                    names.extend(
                        part for part in _split_alias_terms(row.get(field, "")) if not _is_group_label(part)
                    )
            self._split_word_vocabulary = build_split_word_vocabulary(names)
        return self._split_word_vocabulary

    def known_phrases(self) -> set[str]:
        """Normalised aliases; a spaced form that is itself an alias is never joined."""
        return set(self.alias_map.keys())

    def _build_job_market_relevance(self) -> dict[str, float]:
        counts: dict[str, int] = {}

        for path in [REFERENCE_JOBS_PATH, JOB_INDEX_PATH]:
            if not path.exists():
                continue

            try:
                df = pd.read_csv(path, dtype=str, keep_default_na=False)
            except Exception:
                continue

            df.columns = [column.strip() for column in df.columns]
            id_columns = [
                column
                for column in [
                    "required_skill_ids",
                    "must_have_skill_ids",
                    "nice_to_have_skill_ids",
                    "skill_ids",
                ]
                if column in df.columns
            ]
            text_columns = [
                column
                for column in [
                    "required_skills",
                    "mapped_required_skill_names",
                    "required_skills_comma_separated",
                ]
                if column in df.columns
            ]

            for _, row in df.iterrows():
                seen_for_job: set[str] = set()

                for column in id_columns:
                    value = str(row.get(column, "") or "")
                    for skill_id in re.findall(r"\bSK\d+\b", value.upper()):
                        seen_for_job.add(skill_id)

                if not id_columns:
                    for column in text_columns:
                        value = str(row.get(column, "") or "")
                        normalized_value = _normalize_alias(value)
                        if not normalized_value:
                            continue
                        padded_value = f" {normalized_value} "
                        for alias in self.ordered_aliases:
                            pattern = r"(?<!\w)" + re.escape(alias) + r"(?!\w)"
                            if not re.search(pattern, padded_value, flags=re.IGNORECASE):
                                continue
                            for row_index in self.alias_map.get(alias, []):
                                skill_id = self.rows[row_index].get("skill_id", "").strip().upper()
                                if skill_id:
                                    seen_for_job.add(skill_id)

                for skill_id in seen_for_job:
                    counts[skill_id] = counts.get(skill_id, 0) + 1

        if not counts:
            return {}

        max_count = max(counts.values()) or 1
        return {skill_id: min(count / max_count, 1.0) for skill_id, count in counts.items()}

    def _section_weight(self, sections: set[str]) -> float:
        joined = " ".join(section.lower() for section in sections)
        if any(token in joined for token in ["skill", "technical", "competenc"]):
            return 1.0
        if any(token in joined for token in ["experience", "work", "project", "cert", "training"]):
            return 0.85
        if "education" in joined or "academic" in joined:
            return 0.70
        if "summary" in joined or "objective" in joined or "profile" in joined:
            return 0.35
        return 0.50

    def _recency_signal(self, detections: list[dict[str, Any]]) -> float:
        for detection in detections:
            section = str(detection.get("source_section", "")).lower()
            section_text = str(detection.get("section_text", "")).lower()
            if any(token in section for token in ["experience", "work", "project", "education"]):
                if re.search(r"\b(20(?:2[3-9]|3[0-9])|present|current|ongoing|recent)\b", section_text):
                    return 1.0
                return 0.75
        return 0.40

    def _specificity_score(self, row: dict[str, Any], matched_aliases: set[str]) -> float:
        values = {
            _normalize_alias(row.get("skill_name", "")),
            _normalize_alias(row.get("esco_preferred_label", "")),
            *{_normalize_alias(alias) for alias in matched_aliases},
        }
        values = {value for value in values if value}

        if values.intersection(CONCRETE_SKILL_TERMS):
            return 1.0
        if values.intersection(BROAD_SKILL_TERMS):
            return 0.35
        if any(re.search(r"[+#]|\b[a-z]{1,4}\b", value) for value in values):
            return 0.85
        if any(len(value.split()) >= 2 for value in values):
            return 0.75
        return 0.60

    def _find_alias_matches(self, text: str) -> list[tuple[int, str, str, int]]:
        """(row index, alias, matched text, position) for every mention, repeats included."""
        normalized_text = _normalize_alias(text)
        matches: list[tuple[int, str, str, int]] = []
        seen = set()

        if not normalized_text:
            return matches

        # 1. Normal exact phrase matching. A single alternation avoids scanning
        # the full resume once for every alias in the 600+ skill reference.
        if self._alias_pattern:
            for match in self._alias_pattern.finditer(normalized_text):
                alias = _normalize_alias(match.group(0))
                matched_text = match.group(0).strip()

                for row_index in self.alias_map.get(alias, []):
                    # Keyed by position: a skill named three times is three
                    # pieces of evidence, not one.
                    key = (row_index, alias, match.start())

                    if key in seen:
                        continue

                    seen.add(key)
                    matches.append((row_index, alias, matched_text, match.start()))

        # 2. Compact fallback.
        # Handles:
        # c u s t o m e r s u p p o r t
        # d a t a e n t r y
        # m i c r o s o f t e x c e l
        has_fragmented_spacing = _has_fragmented_spacing(text)

        if not has_fragmented_spacing:
            return matches

        compact_text = _compact_alias(text)

        if not compact_text:
            return matches

        if self._compact_alias_pattern:
            for match in self._compact_alias_pattern.finditer(compact_text):
                compact_alias = match.group(1).lower()
                for alias in self._compact_alias_map.get(compact_alias, []):
                    for row_index in self.alias_map.get(alias, []):
                        key = (row_index, alias, compact_alias)

                        if key in seen:
                            continue

                        seen.add(key)
                        matches.append((row_index, alias, alias, match.start()))

        return matches

    def extract_skills_from_sections(
        self,
        sections: dict[str, str],
        limit: Optional[int] = MAX_CONFIRMED_SKILLS,
    ) -> list[dict[str, Any]]:
        """Skills named anywhere in the resume, highest priority first.

        ``limit`` is the Step 2 list size (MAX_CONFIRMED_SKILLS); pass None for
        every skill with evidence, which matching uses so that a skill ranked
        below the twentieth is never reported as missing.
        """
        found: list[dict[str, Any]] = []

        section_order = list(sections.keys())

        if any("skill" in section.lower() for section in section_order):
            section_order = sorted(
                section_order,
                key=lambda section: 0 if "skill" in section.lower() else 1,
            )

        for section_name in section_order:
            section_text = sections.get(section_name, "")

            if not section_text or len(section_text.strip()) < 3:
                continue

            matches = self._find_alias_matches(section_text)
            normalized_section = _normalize_alias(section_text) if matches else ""

            for row_index, alias, matched_text, position in matches:
                row = self.rows[row_index]
                section_lower = section_name.lower()

                if (
                    "skill" in section_lower
                    or "technical" in section_lower
                    or "competenc" in section_lower
                ):
                    confidence = 1.00
                elif "cert" in section_lower or "experience" in section_lower:
                    confidence = 0.85
                else:
                    confidence = 0.70

                found.append(
                    {
                        "skill_id": row.get("skill_id", ""),
                        "skill_name": row.get("skill_name", alias),
                        "skill_category": row.get("skill_category", ""),
                        "skill_subcategory": row.get("skill_subcategory", ""),
                        "matched_text": matched_text,
                        "source_section": section_name,
                        "section_text": section_text,
                        "evidence_text": _evidence_window(normalized_section, position, len(matched_text)),
                        "confidence": round(float(confidence), 2),
                        "method": "exact_phrase_match",
                        "position": position,
                    }
                )

        grouped: dict[str, list[dict[str, Any]]] = {}

        for skill in found:
            skill_id = str(skill.get("skill_id", "")).strip().upper()
            if skill_id:
                grouped.setdefault(skill_id, []).append(skill)

        if not grouped:
            return []

        def mentions(detections: list[dict[str, Any]]) -> list[dict[str, Any]]:
            # Sections are slices of full_text, so a mention is counted once:
            # from full_text when it was searched, else from the sections.
            whole = [item for item in detections if item.get("source_section") == "full_text"]
            return whole or detections

        max_frequency = max(len(mentions(items)) for items in grouped.values()) or 1
        ranked: list[dict[str, Any]] = []

        for skill_id, detections in grouped.items():
            best = max(detections, key=lambda item: float(item.get("confidence", 0)))
            row = {
                **best,
                "skill_id": skill_id,
            }
            source_sections = {str(item.get("source_section", "")) for item in detections if item.get("source_section")}
            matched_aliases = {str(item.get("matched_text", "")) for item in detections if item.get("matched_text")}
            evidence_count = len(mentions(detections))
            evidence_frequency = min(evidence_count / max_frequency, 1.0)
            section_weight = self._section_weight(source_sections)
            job_market_relevance = self.job_market_relevance.get(skill_id, 0.0)
            recency_signal = self._recency_signal(detections)
            specificity_score = self._specificity_score(row, matched_aliases)
            priority_score = (
                0.35 * evidence_frequency
                + 0.25 * section_weight
                + 0.20 * job_market_relevance
                + 0.10 * recency_signal
                + 0.10 * specificity_score
            )

            row.pop("section_text", None)
            row.pop("position", None)
            row.update(
                {
                    "source": "resume_extracted",
                    "source_metadata": {
                        "evidence_frequency": round(evidence_frequency, 4),
                        "section_weight": round(section_weight, 4),
                        "job_market_relevance": round(job_market_relevance, 4),
                        "recency_signal": round(recency_signal, 4),
                        "specificity_score": round(specificity_score, 4),
                        "evidence_count": evidence_count,
                        "source_sections": sorted(source_sections),
                    },
                    "skill_priority_score": round(priority_score, 4),
                    "method": "rule_based_weighted_resume_skill_ranking",
                }
            )
            row["_first_position"] = min(int(item.get("position", 0)) for item in mentions(detections))
            ranked.append(row)

        # Ties go to the skill mentioned more often, then earlier in the
        # resume; never to alphabetical order.
        ranked.sort(
            key=lambda item: (
                -float(item.get("skill_priority_score", 0)),
                -float(item.get("confidence", 0)),
                -int(item["source_metadata"]["evidence_count"]),
                item["_first_position"],
                str(item.get("skill_name", "")),
            ),
        )
        for item in ranked:
            item.pop("_first_position", None)

        return ranked if limit is None else ranked[:limit]

    def extract_from_text(self, full_text: str, limit: Optional[int] = MAX_CONFIRMED_SKILLS) -> list[dict[str, Any]]:
        sections = {"full_text": full_text}
        return self.extract_skills_from_sections(sections, limit=limit)

    def extract_skills(self, full_text: str, limit: Optional[int] = MAX_CONFIRMED_SKILLS) -> list[dict[str, Any]]:
        return self.extract_from_text(full_text, limit=limit)

import re
from pathlib import Path
from typing import Any, Union

import pandas as pd


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
    if value is None or pd.isna(value):
        return []

    text = str(value)
    text = text.replace("\n", ";")
    text = text.replace("|", ";")
    text = text.replace(",", ";")

    return [part.strip() for part in text.split(";") if part.strip()]


class SkillExtractor:
    def __init__(self, skills_path: Union[str, Path] = SKILLS_REFERENCE_PATH):
        self.skills_path = Path(skills_path)
        self.rows: list[dict[str, Any]] = []
        self.alias_map: dict[str, list[int]] = {}
        self.ordered_aliases: list[str] = []
        self.job_market_relevance: dict[str, float] = {}

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
                "skill_name": row.get("skill_name", "").strip(),
                "skill_category": row.get("skill_category", "").strip(),
                "skill_subcategory": row.get("skill_subcategory", "").strip(),
                "related_skills": row.get("related_skills", "").strip(),
                "esco_preferred_label": row.get("esco_preferred_label", "").strip(),
                "esco_alternative_labels": row.get("esco_alternative_labels", "").strip(),
            }

            if skill_row["skill_id"] and skill_row["skill_name"]:
                self.rows.append(skill_row)

    def _build_alias_index(self) -> None:
        for row_index, row in enumerate(self.rows):
            alias_candidates = []

            alias_candidates.append(row.get("skill_name", ""))

            for field in [
                "related_skills",
                "esco_preferred_label",
                "esco_alternative_labels",
            ]:
                alias_candidates.extend(_split_alias_terms(row.get(field, "")))

            normalized_aliases = set()

            for alias in alias_candidates:
                normalized_alias = _normalize_alias(alias)

                if not normalized_alias:
                    continue

                # Avoid noisy aliases like "ai", "hr", "pr" unless intentionally handled later.
                if len(normalized_alias) < 3:
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

    def _find_alias_matches(self, text: str) -> list[tuple[int, str, str]]:
        normalized_text = _normalize_alias(text)
        matches: list[tuple[int, str, str]] = []
        seen = set()

        if not normalized_text:
            return matches

        padded_text = f" {normalized_text} "

        # 1. Normal exact phrase matching.
        # Handles:
        # customer support
        # customer-support
        # customer_support
        # customer    support
        for alias in self.ordered_aliases:
            pattern = r"(?<!\w)" + re.escape(alias) + r"(?!\w)"

            for match in re.finditer(pattern, padded_text, flags=re.IGNORECASE):
                matched_text = match.group(0).strip()

                for row_index in self.alias_map.get(alias, []):
                    key = (row_index, alias, matched_text.lower())

                    if key in seen:
                        continue

                    seen.add(key)
                    matches.append((row_index, alias, matched_text))

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

        for alias in self.ordered_aliases:
            compact_alias = _compact_alias(alias)

            if not compact_alias:
                continue

            if len(compact_alias) < 5:
                if compact_alias not in SHORT_ALIAS_ALLOWLIST:
                    continue

            if compact_alias in compact_text:
                for row_index in self.alias_map.get(alias, []):
                    key = (row_index, alias, compact_alias)

                    if key in seen:
                        continue

                    seen.add(key)
                    matches.append((row_index, alias, alias))

        return matches

    def extract_skills_from_sections(
        self,
        sections: dict[str, str],
    ) -> list[dict[str, Any]]:
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

            for row_index, alias, matched_text in matches:
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
                        "confidence": round(float(confidence), 2),
                        "method": "exact_phrase_match",
                    }
                )

        grouped: dict[str, list[dict[str, Any]]] = {}

        for skill in found:
            skill_id = str(skill.get("skill_id", "")).strip().upper()
            if skill_id:
                grouped.setdefault(skill_id, []).append(skill)

        if not grouped:
            return []

        max_frequency = max(len(items) for items in grouped.values()) or 1
        ranked: list[dict[str, Any]] = []

        for skill_id, detections in grouped.items():
            best = max(detections, key=lambda item: float(item.get("confidence", 0)))
            row = {
                **best,
                "skill_id": skill_id,
            }
            source_sections = {str(item.get("source_section", "")) for item in detections if item.get("source_section")}
            matched_aliases = {str(item.get("matched_text", "")) for item in detections if item.get("matched_text")}
            evidence_frequency = min(len(detections) / max_frequency, 1.0)
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
            row.update(
                {
                    "source": "resume_extracted",
                    "source_metadata": {
                        "evidence_frequency": round(evidence_frequency, 4),
                        "section_weight": round(section_weight, 4),
                        "job_market_relevance": round(job_market_relevance, 4),
                        "recency_signal": round(recency_signal, 4),
                        "specificity_score": round(specificity_score, 4),
                        "evidence_count": len(detections),
                        "source_sections": sorted(source_sections),
                    },
                    "skill_priority_score": round(priority_score, 4),
                    "method": "rule_based_weighted_resume_skill_ranking",
                }
            )
            ranked.append(row)

        ranked.sort(
            key=lambda item: (
                float(item.get("skill_priority_score", 0)),
                float(item.get("confidence", 0)),
                str(item.get("skill_name", "")),
            ),
            reverse=True,
        )

        return ranked[:MAX_CONFIRMED_SKILLS]

    def extract_from_text(self, full_text: str) -> list[dict[str, Any]]:
        sections = {"full_text": full_text}
        return self.extract_skills_from_sections(sections)

    def extract_skills(self, full_text: str) -> list[dict[str, Any]]:
        return self.extract_from_text(full_text)

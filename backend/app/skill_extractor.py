import re
from pathlib import Path
from typing import Any, Union

import pandas as pd


BACKEND_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BACKEND_DIR / "data"
SKILLS_REFERENCE_PATH = DATA_DIR / "skills_reference.csv"


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

        self._load_skills_reference()
        self._build_alias_index()

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
                        "confidence": round(float(confidence), 2),
                        "method": "exact_phrase_match",
                    }
                )

        # Keep the highest-confidence detection for each skill_id.
        unique: dict[str, dict[str, Any]] = {}

        for skill in found:
            skill_id = skill.get("skill_id", "")

            if skill_id not in unique:
                unique[skill_id] = skill
            elif skill["confidence"] > unique[skill_id]["confidence"]:
                unique[skill_id] = skill

        return list(unique.values())

    def extract_from_text(self, full_text: str) -> list[dict[str, Any]]:
        sections = {"full_text": full_text}
        return self.extract_skills_from_sections(sections)
    
    def extract_skills(self, full_text: str) -> list[dict[str, Any]]:
        return self.extract_from_text(full_text)
    
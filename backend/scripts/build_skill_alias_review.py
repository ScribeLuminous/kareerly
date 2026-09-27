"""Generate data/skill_aliases.csv, the reviewed list of names for each Kareerly skill.

    python3 -m backend.scripts.build_skill_alias_review --esco-dir <unzipped ESCO v1.2.1 CSV folder>
    python3 -m backend.scripts.build_skill_alias_review            # no ESCO: stored labels only

Sources, one row per (skill, name):

    kareerly_label     skill_name                                   verified
    language_name      "Python" for Python Programming               verified
    kareerly_curated   related_skills of hand-curated tool rows      verified
    variant            skill_name_variants.csv                       verified
    approved           approved_aliases (skill discovery)            verified
    evidence_relation  skill_evidence_relations.csv                  one_way
                       (same_skill_common_name rows are verified)
    exclusion          skill_alias_exclusions.csv                    excluded
    esco_preferred     ESCO preferred label of the linked concept    verified for a
                       reviewed link, candidate otherwise
    esco_alt           ESCO alternative labels of the linked concept candidate
    kareerly_related   other related_skills entries                  candidate

Candidates get a deterministic ``filter_result`` ("pass" or "fail:<reasons>")
to order the human review. Passing the filter does not verify a label; only a
reviewer does, by setting ``status`` and ``reviewed_by``. Rows with
``reviewed_by`` set are kept as they are when the file is regenerated.

The ESCO download itself is not stored in the repository; its version and
SHA-256 are recorded in data/skill_aliases_meta.json.
"""
from __future__ import annotations

import argparse
import collections
import csv
import datetime as dt
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Set, Tuple

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR.parent) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR.parent))

from backend.app.services import skill_resolver as resolver  # noqa: E402

DATA = BACKEND_DIR / "data"
SKILLS_PATH = DATA / "skills_reference.csv"
VARIANTS_PATH = DATA / "skill_name_variants.csv"
RELATIONS_PATH = DATA / "skill_evidence_relations.csv"
EXCLUSIONS_PATH = DATA / "skill_alias_exclusions.csv"
OUT_PATH = DATA / "skill_aliases.csv"
META_PATH = DATA / "skill_aliases_meta.json"
COLUMNS = ["skill_id", "alias", "source", "status", "exact_case", "filter_result", "reason", "esco_uri", "reviewed_by"]
FILTER_VERSION = "2026-09-27.1"
REVIEWED_LINK_STATUSES = {"reviewed", "mapped", "manual_review"}
CURATED_SOURCE = "workplace_tools_expansion_2026_09"
EQUIVALENT_RELATION = "same_skill_common_name"
PROGRAMMING_LANGUAGE_LABEL = re.compile(r"^(?P<name>.+?)\s*(?:\(computer programming\)|programming)$", re.IGNORECASE)
# Single words that are names of tools or languages, not everyday words.
SINGLE_WORD_ALLOWLIST = {"javascript", "python", "java", "php", "sql", "html", "css", "typescript", "wordpress",
                         "photoshop", "illustrator", "excel", "quickbooks", "salesforce", "hubspot", "zendesk"}


def read_csv(path: Path) -> List[Dict[str, str]]:
    if not path.is_file():
        return []
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class EscoIndex:
    """Labels of ESCO v1.2.1 skills, keeping the latest copy of a duplicated URI."""

    def __init__(self, directory: Optional[Path]):
        self.preferred: Dict[str, str] = {}
        self.alts: Dict[str, List[str]] = {}
        self.owners: Dict[str, Set[str]] = collections.defaultdict(set)
        self.preferred_owner: Dict[str, str] = {}
        self.source = ""
        if not directory:
            return
        path = next((p for p in sorted(directory.rglob("skills_en.csv")) if "__MACOSX" not in p.parts), None)
        if path is None:
            raise SystemExit(f"! skills_en.csv not found under {directory}")
        self.source = sha256(path)
        latest: Dict[str, Dict[str, str]] = {}
        for row in read_csv(path):
            uri = (row.get("conceptUri") or "").strip()
            if uri and (uri not in latest or (row.get("modifiedDate") or "") >= (latest[uri].get("modifiedDate") or "")):
                latest[uri] = row
        for uri, row in latest.items():
            preferred = (row.get("preferredLabel") or "").strip()
            alts = [label.strip() for label in (row.get("altLabels") or "").splitlines() if label.strip()]
            self.preferred[uri] = preferred
            self.alts[uri] = alts
            self.preferred_owner.setdefault(resolver.normalize(preferred), uri)
            for label in [preferred, *alts]:
                self.owners[resolver.normalize(label)].add(uri)

    @property
    def loaded(self) -> bool:
        return bool(self.preferred)


def language_names(row: Dict[str, str]) -> List[str]:
    if row.get("mapping_status", "") not in {"reviewed", "mapped"}:
        return []
    own = {resolver.normalize(label) for label in [row.get("skill_name", ""), row.get("esco_preferred_label", ""),
                                                  *resolver.split_list(row.get("esco_alternative_labels", ""))]}
    names = []
    for value in (row.get("skill_name", ""), row.get("esco_preferred_label", "")):
        match = PROGRAMMING_LANGUAGE_LABEL.match(value.strip())
        if match and len(match.group("name")) >= 3 and resolver.normalize(match.group("name")) in own:
            names.append(match.group("name").strip())
    return list(dict.fromkeys(names))


def build_rows(esco: EscoIndex) -> List[Dict[str, str]]:
    skills = read_csv(SKILLS_PATH)
    categories = resolver.category_terms(skills)
    rows: Dict[Tuple[str, str], Dict[str, str]] = {}
    precedence = {"exclusion": 0, "kareerly_label": 1, "variant": 2, "language_name": 3, "approved": 4,
                  "kareerly_curated": 5, "evidence_relation": 6, "esco_preferred": 7, "esco_alt": 8, "kareerly_related": 9}

    def put(skill_id: str, alias: str, source: str, status: str, reason: str = "", uri: str = "", exact_case: bool = False) -> None:
        key = (skill_id, resolver.normalize(alias))
        if not key[1]:
            return
        existing = rows.get(key)
        if existing and precedence[existing["source"]] <= precedence[source]:
            return
        rows[key] = {"skill_id": skill_id, "alias": alias.strip(), "source": source, "status": status,
                     "exact_case": "true" if exact_case else "", "filter_result": "", "reason": reason,
                     "esco_uri": uri, "reviewed_by": ""}

    for exclusion in read_csv(EXCLUSIONS_PATH):
        put(exclusion["skill_id"].strip().upper(), exclusion["alias"], "exclusion", resolver.EXCLUDED, exclusion.get("reason", ""))
    by_id = {row["skill_id"].strip().upper(): row for row in skills if row.get("skill_id")}
    for skill_id, row in by_id.items():
        put(skill_id, row["skill_name"], "kareerly_label", resolver.VERIFIED, "Kareerly canonical name")
        for name in language_names(row):
            put(skill_id, name, "language_name", resolver.VERIFIED, "Bare name of a reviewed programming language; it is a label of the skill")
        for alias in resolver.split_list(row.get("approved_aliases", "")):
            put(skill_id, alias, "approved", resolver.VERIFIED, "Approved by a reviewer through skill discovery")
        if row.get("source_note", "") == CURATED_SOURCE:
            for alias in resolver.split_list(row.get("related_skills", "")):
                put(skill_id, alias, "kareerly_curated", resolver.VERIFIED, "Hand-curated spelling of this tool or practice")
    for variant in read_csv(VARIANTS_PATH):
        exact = (variant.get("exact_case") or "").strip().lower() == "true"
        put(variant["skill_id"].strip().upper(), variant["variant"], "variant", resolver.VERIFIED,
            (variant.get("note") or "Reviewed spelling").strip(), exact_case=exact)
    for relation in read_csv(RELATIONS_PATH):
        kind = relation.get("relation", "").strip()
        status = resolver.VERIFIED if kind == EQUIVALENT_RELATION else resolver.ONE_WAY
        put(relation["skill_id"].strip().upper(), relation["evidence_phrase"], "evidence_relation", status,
            f"{kind}: {relation.get('rationale', '').strip()}")

    verified_owner: Dict[str, Set[str]] = collections.defaultdict(set)
    for (skill_id, key), row in rows.items():
        if row["status"] == resolver.VERIFIED:
            verified_owner[key].add(skill_id)

    mismatched = set()
    for skill_id, row in by_id.items():
        uri = row.get("esco_skill_uri", "").strip()
        owner = esco.preferred_owner.get(resolver.normalize(row["skill_name"]))
        if esco.loaded and uri and owner and owner != uri:
            mismatched.add(skill_id)

    for skill_id, row in by_id.items():
        uri = row.get("esco_skill_uri", "").strip()
        status = row.get("mapping_status", "")
        if esco.loaded and uri in esco.preferred:
            preferred, alts = esco.preferred[uri], esco.alts[uri]
        else:
            preferred = row.get("esco_preferred_label", "")
            alts = resolver.split_list(row.get("esco_alternative_labels", ""))
        if preferred:
            if status in REVIEWED_LINK_STATUSES and skill_id not in mismatched:
                put(skill_id, preferred, "esco_preferred", resolver.VERIFIED, f"Preferred label of the reviewed ESCO link ({status})", uri)
            else:
                why = ("the skill's own name is the preferred label of a different ESCO concept" if skill_id in mismatched
                       else f"ESCO link not reviewed ({status or 'no status'})")
                put(skill_id, preferred, "esco_preferred", resolver.CANDIDATE, why, uri)
        for alt in alts:
            put(skill_id, alt, "esco_alt", resolver.CANDIDATE, "ESCO alternative label; not a verified synonym", uri)
        esco_keys = {resolver.normalize(label) for label in [preferred, *alts]}
        if row.get("source_note", "") != CURATED_SOURCE:
            for alias in resolver.split_list(row.get("related_skills", "")):
                if resolver.is_group_label(alias) or resolver.normalize(alias) in esco_keys:
                    continue
                put(skill_id, alias, "kareerly_related", resolver.CANDIDATE, "related_skills entry from the seed taxonomy")

    # Deterministic filter for candidates: it orders the review, it does not verify.
    protected = {name for pair in resolver.PROTECTED_DISTINCT for name in pair}
    for (skill_id, key), row in rows.items():
        if row["status"] != resolver.CANDIDATE:
            continue
        reasons = []
        if by_id.get(skill_id, {}).get("mapping_status", "") not in REVIEWED_LINK_STATUSES:
            reasons.append("skill_not_reviewed")
        if len(esco.owners.get(key, set())) > 1:
            reasons.append("ambiguous_in_esco")
        other_preferred = esco.preferred_owner.get(key)
        if other_preferred and other_preferred != row["esco_uri"]:
            reasons.append("preferred_label_of_other_concept")
        if len(key) < 3 and key not in resolver.SHORT_ALIAS_ALLOWLIST:
            reasons.append("too_short")
        if " " not in key and not re.search(r"[0-9+#.]", key) and key not in SINGLE_WORD_ALLOWLIST:
            reasons.append("single_word")
        if key in categories:
            reasons.append("category_label")
        if verified_owner.get(key, set()) - {skill_id}:
            reasons.append("names_another_skill:" + "/".join(sorted(verified_owner[key] - {skill_id})))
        if key in protected:
            reasons.append("protected_look_alike")
        row["filter_result"] = "pass" if not reasons else "fail:" + ";".join(reasons)
    return sorted(rows.values(), key=lambda row: (row["skill_id"], precedence[row["source"]], row["alias"].lower()))


def keep_reviews(rows: List[Dict[str, str]], previous: Iterable[Dict[str, str]]) -> List[Dict[str, str]]:
    reviewed = {(row["skill_id"], resolver.normalize(row["alias"])): row for row in previous if (row.get("reviewed_by") or "").strip()}
    merged = []
    for row in rows:
        decision = reviewed.pop((row["skill_id"], resolver.normalize(row["alias"])), None)
        merged.append({**row, **{k: decision[k] for k in ("status", "reason", "reviewed_by")}} if decision else row)
    # A reviewed name whose source disappeared is kept, so no decision is lost.
    merged.extend({column: row.get(column, "") for column in COLUMNS} for row in reviewed.values())
    return merged


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--esco-dir", type=Path, help="Unzipped ESCO v1.2.1 English CSV folder")
    parser.add_argument("--esco-version", default="v1.2.1")
    parser.add_argument("--esco-archive-sha256", default="", help="SHA-256 of the ESCO zip, for the record")
    parser.add_argument("--out", type=Path, default=OUT_PATH)
    args = parser.parse_args(argv)

    esco = EscoIndex(args.esco_dir)
    previous_meta = json.loads(META_PATH.read_text(encoding="utf-8")) if META_PATH.is_file() else {}
    rows = keep_reviews(build_rows(esco), read_csv(args.out))
    with args.out.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=COLUMNS)
        writer.writeheader()
        writer.writerows(rows)

    counts = collections.Counter((row["source"], row["status"]) for row in rows)
    meta = {
        "generated_at": dt.date.today().isoformat(),
        "filter_version": FILTER_VERSION,
        "esco_version": args.esco_version if esco.loaded else previous_meta.get("esco_version", ""),
        "esco_skills_csv_sha256": esco.source or previous_meta.get("esco_skills_csv_sha256", ""),
        "esco_archive_sha256": args.esco_archive_sha256 or previous_meta.get("esco_archive_sha256", ""),
        "rows": len(rows),
        "by_status": dict(collections.Counter(row["status"] for row in rows)),
        "by_source_and_status": {f"{source}/{status}": n for (source, status), n in sorted(counts.items())},
        "candidates_passing_filter": sum(row["filter_result"] == "pass" for row in rows),
    }
    META_PATH.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(meta, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

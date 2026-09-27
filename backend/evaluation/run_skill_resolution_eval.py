"""Compare skill-resolution methods on the labelled sets in evaluation/skill_resolution/.

    backend/.venv/bin/python -m backend.evaluation.run_skill_resolution_eval [--json out.json]

Methods (see docs/esco-skill-implementation.md):

    A       exact Kareerly names and ESCO preferred labels only
    B       verified names from data/skill_aliases.csv (the runtime default)
    B+prov  B plus unreviewed candidates that pass the deterministic filter,
            read in text only (skill_resolver.PROVISIONAL_CANDIDATE_EXTRACTION)
    B-raw   every non-excluded name, candidates included, as two-way synonyms
            (close to the behaviour before the shared resolver)
    C       B plus a difflib fuzzy fallback for single names when B finds
            nothing (at least five characters, same digits and symbols,
            similarity >= 0.90)

The labels are drafts until a person reviews them (label_status); the
figures are provisional until then. None of these items was used to choose
aliases, exclusions or filter rules.
"""
from __future__ import annotations

import argparse
import csv
import difflib
import json
import re
from dataclasses import replace
from pathlib import Path
from typing import Dict, List, Optional, Set

from backend.app.services import learning_recommender as lr
from backend.app.services import matching_service as matching
from backend.app.services import skill_resolver as resolver
from backend.app.services.skill_extractor import SkillExtractor

HERE = Path(__file__).resolve().parent / "skill_resolution"
METHODS = ("A", "B", "B+prov", "B-raw", "C")


def read(name: str) -> List[Dict[str, str]]:
    with (HERE / name).open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def entries_for(method: str) -> List[resolver.AliasEntry]:
    entries = list(resolver.load_alias_entries())
    if method == "A":
        return [replace(entry, status=resolver.VERIFIED) for entry in entries if entry.source in {"kareerly_label", "esco_preferred"}]
    if method == "B-raw":
        return [replace(entry, status=resolver.VERIFIED) if entry.status == resolver.CANDIDATE else entry for entry in entries]
    return entries


class MethodExtractor(SkillExtractor):
    """The production extractor with a method-specific vocabulary."""

    method = "B"

    def _build_vocabulary(self) -> resolver.SkillVocabulary:
        approved = {row["skill_id"].upper(): resolver.split_list(row.get("approved_aliases", "")) for row in self.rows}
        if self.method == "A":
            approved = {}
        return resolver.build_vocabulary(self.rows, entries=entries_for(self.method), extra_verified=approved,
                                         provisional=self.method == "B+prov")


def extractor_for(method: str) -> SkillExtractor:
    cls = type(f"Extractor_{method}", (MethodExtractor,), {"method": "B" if method == "C" else method})
    return cls()


def fuzzy(vocabulary: resolver.SkillVocabulary, text: str) -> str:
    key = resolver.normalize(text)
    if len(key) < 5:
        return ""
    symbols = set(re.findall(r"[0-9+#.]", key))
    choices = [choice for choice in vocabulary.resolve_aliases if set(re.findall(r"[0-9+#.]", choice)) == symbols]
    match = difflib.get_close_matches(key, choices, n=1, cutoff=0.90)
    return vocabulary.resolve_aliases[match[0]] if match else ""


def resolve_name(vocabulary: resolver.SkillVocabulary, text: str, method: str) -> str:
    """A requirement name to a skill ID, with the same qualifier handling as matching._skill_key."""
    normalized = matching.normalize_for_match(text)
    spaced = re.sub(r"[\s/-]+", " ", normalized).strip()
    for variant in [normalized, *matching._phrase_variants(normalized), spaced, *matching._phrase_variants(spaced)]:
        skill_id = vocabulary.resolve(variant)
        if skill_id:
            return skill_id
    return fuzzy(vocabulary, text) if method == "C" else ""


def single_label_scores(items: List[Dict[str, str]], predictions: Dict[str, str]) -> Dict[str, float]:
    tp = fp = fn = wrong_skill = 0
    for item in items:
        gold, predicted = item["gold_skill_id"], predictions[item["item_id"]] or "NONE"
        if predicted != "NONE" and predicted == gold:
            tp += 1
        else:
            if predicted != "NONE":
                fp += 1
                wrong_skill += gold != "NONE"
            if gold != "NONE":
                fn += 1
    return score(tp, fp, fn) | {"false_matches": fp, "matched_to_a_different_skill": wrong_skill, "items": len(items)}


def score(tp: int, fp: int, fn: int) -> Dict[str, float]:
    precision = tp / (tp + fp) if tp + fp else 1.0
    recall = tp / (tp + fn) if tp + fn else 1.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return {"precision": round(precision, 4), "recall": round(recall, 4), "f1": round(f1, 4), "tp": tp, "fp": fp, "fn": fn}


def evaluate_method(method: str) -> Dict[str, object]:
    extractor = extractor_for(method)
    vocabulary = extractor.vocabulary
    results: Dict[str, object] = {}
    for name in ("requirements", "lookalikes"):
        items = read(f"{name}.csv")
        predictions = {item["item_id"]: resolve_name(vocabulary, item["text"], method) for item in items}
        results[name] = single_label_scores(items, predictions)
        results[name]["errors"] = [f"{item['text']!r}: gold {item['gold_skill_id']}, got {predictions[item['item_id']] or 'NONE'}"
                                   for item in items if (predictions[item["item_id"]] or "NONE") != item["gold_skill_id"]]
    tp = fp = fn = 0
    errors = []
    for item in read("resume_mentions.csv"):
        gold: Set[str] = {value for value in item["gold_skill_ids"].split(";") if value}
        found = {row["skill_id"] for row in extractor.extract_skills(item["text"], limit=None)}
        tp, fp, fn = tp + len(gold & found), fp + len(found - gold), fn + len(gold - found)
        if gold != found:
            errors.append(f"{item['item_id']}: missed {sorted(gold - found)}, extra {sorted(found - gold)}")
    results["resume_mentions"] = score(tp, fp, fn) | {"items": len(read("resume_mentions.csv")), "errors": errors}
    return results


def evaluate_course_links() -> Dict[str, object]:
    """Catalog mapping as-is vs. the corroborated mapping the recommender uses."""
    catalog = {row["resource_id"]: row for row in lr.load_learning_resources().to_dict(orient="records")}
    equivalents = matching.skill_id_equivalents()
    items = read("course_links.csv")
    outcomes = {"catalog_mapping_as_is": [0, 0, 0], "corroborated_by_resource_text": [0, 0, 0]}
    errors = []
    for item in items:
        gold = item["gold_teaches"] == "yes"
        resource = catalog.get(item["resource_id"], {})
        reviewed = lr.resource_is_reviewed(resource)
        named = {equivalents.get(skill_id, skill_id) for skill_id in matching.resource_skill_evidence(lr._resource_text(resource))}
        kept = reviewed or equivalents.get(item["skill_id"], item["skill_id"]) in named
        for method, predicted in (("catalog_mapping_as_is", True), ("corroborated_by_resource_text", kept)):
            counts = outcomes[method]
            counts[0] += predicted and gold
            counts[1] += predicted and not gold
            counts[2] += gold and not predicted
        if kept != gold:
            errors.append(f"{item['item_id']} {item['resource_id']} {item['skill_id']}: gold {item['gold_teaches']}, kept {kept}")
    return {method: score(*counts) | {"items": len(items)} for method, counts in outcomes.items()} | {"errors": errors}


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--json", type=Path)
    args = parser.parse_args(argv)
    report = {"label_status": sorted({row["label_status"] for name in ("requirements.csv", "lookalikes.csv", "resume_mentions.csv", "course_links.csv") for row in read(name)}),
              "methods": {method: evaluate_method(method) for method in METHODS},
              "course_links": evaluate_course_links()}
    print(f"labels: {report['label_status']}")
    print(f"{'method':8} {'requirements P/R/F1':24} {'look-alikes P/R/F1 (false)':30} {'resume mentions P/R/F1':24}")
    for method, result in report["methods"].items():
        cells = []
        for name in ("requirements", "lookalikes", "resume_mentions"):
            r = result[name]
            extra = f" ({r['false_matches']})" if name == "lookalikes" else ""
            cells.append(f"{r['precision']:.3f}/{r['recall']:.3f}/{r['f1']:.3f}{extra}")
        print(f"{method:8} {cells[0]:24} {cells[1]:30} {cells[2]:24}")
    for method in ("catalog_mapping_as_is", "corroborated_by_resource_text"):
        r = report["course_links"][method]
        print(f"course links, {method}: P {r['precision']:.3f} R {r['recall']:.3f} F1 {r['f1']:.3f} (tp {r['tp']}, fp {r['fp']}, fn {r['fn']})")
    if args.json:
        args.json.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

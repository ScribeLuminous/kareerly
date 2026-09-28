"""Near-duplicate checks for the synthetic resumes (Section 15).

Reads content/*.json, builds each resume's visible text with the assigned
layout (layouts.py), removes the candidate's name, contact details and
location, then runs:

1. full-text TF-IDF cosine (word unigrams + bigrams, sublinear tf), flag >= 0.80
2. summary TF-IDF cosine, flag >= 0.85
3. verbatim bullet reuse (whitespace and case normalized), flag any repeat
4. skill-set Jaccard on the matrix skill IDs, flag >= 0.90
5. duplicate full names and surnames used more than 4 times

Pure Python, no third-party packages. Writes similarity_report.csv with every
flagged pair; resolution notes are read from content/similarity_resolutions.json
when present. Exits non-zero when anything is flagged.

Usage: python check_similarity.py [--only CAT01 CAT02]
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import re
import statistics
import sys
from collections import Counter
from itertools import combinations
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATASET_DIR = HERE.parent
sys.path.insert(0, str(HERE))

import layouts  # noqa: E402
import reference as ref  # noqa: E402

FULL_TEXT_LIMIT = 0.80
SUMMARY_LIMIT = 0.85
SKILL_LIMIT = 0.90
TOKEN = re.compile(r"[a-z0-9ñ][a-z0-9ñ+#.\-]*")


def tokens(text: str) -> list[str]:
    words = [w.strip(".-") for w in TOKEN.findall(text.lower())]
    words = [w for w in words if w]
    return words + [f"{a} {b}" for a, b in zip(words, words[1:])]


def tfidf(docs: list[str]) -> list[dict[str, float]]:
    counts = [Counter(tokens(d)) for d in docs]
    df = Counter(term for c in counts for term in c)
    n = len(docs)
    vectors = []
    for c in counts:
        vec = {t: (1 + math.log(tf)) * (math.log((1 + n) / (1 + df[t])) + 1) for t, tf in c.items()}
        norm = math.sqrt(sum(v * v for v in vec.values())) or 1.0
        vectors.append({t: v / norm for t, v in vec.items()})
    return vectors


def cosine(a: dict[str, float], b: dict[str, float]) -> float:
    if len(a) > len(b):
        a, b = b, a
    return sum(v * b.get(t, 0.0) for t, v in a.items())


def scrub(text: str, doc: dict, row: dict) -> str:
    for value in (doc["full_name"], doc["email"], doc["phone"], doc["location"], row["city"], row["province"],
                  *doc["full_name"].split()):
        if value:
            text = re.sub(re.escape(value), " ", text, flags=re.IGNORECASE)
    return text


def distribution(values: list[float]) -> str:
    if not values:
        return "n/a"
    ordered = sorted(values)
    p95 = ordered[min(len(ordered) - 1, int(round(0.95 * (len(ordered) - 1))))]
    return f"max {ordered[-1]:.3f}, p95 {p95:.3f}, median {statistics.median(ordered):.3f} (n={len(ordered)})"


def run(only=None):
    rows = {r["candidate_id"]: r for r in
            json.loads((DATASET_DIR / "generation_matrix.json").read_text(encoding="utf-8"))["candidates"]}
    files = sorted((DATASET_DIR / "content").glob("*-*.json"))
    if only:
        files = [f for f in files if any(f.stem.startswith(o) for o in only)]
    docs = [json.loads(f.read_text(encoding="utf-8")) for f in files]
    ids = [d["candidate_id"] for d in docs]
    group = {cid: (rows[cid]["target_category_id"] if rows[cid]["dataset_group"] == "controlled" else "stress")
             for cid in ids}
    full = [scrub(layouts.plain_text(d, rows[d["candidate_id"]]["resume_template_variant"]), d, rows[d["candidate_id"]])
            for d in docs]
    summaries = [scrub(d["summary"], d, rows[d["candidate_id"]]) for d in docs]
    full_vec, sum_vec = tfidf(full), tfidf(summaries)

    flags = []
    within, across, s_within, s_across = [], [], [], []
    for i, j in combinations(range(len(docs)), 2):
        a, b = ids[i], ids[j]
        same = group[a] == group[b]
        f = cosine(full_vec[i], full_vec[j])
        s = cosine(sum_vec[i], sum_vec[j])
        (within if same else across).append(f)
        (s_within if same else s_across).append(s)
        if f >= FULL_TEXT_LIMIT:
            flags.append(("full_text_cosine", a, b, f"{f:.3f}", ""))
        if s >= SUMMARY_LIMIT:
            flags.append(("summary_cosine", a, b, f"{s:.3f}", ""))
        ra, rb = rows[a], rows[b]
        sa = set(ra["core_skill_ids"] + ra["supporting_skill_ids"] + ra["adjacent_skill_ids"])
        sb = set(rb["core_skill_ids"] + rb["supporting_skill_ids"] + rb["adjacent_skill_ids"])
        jac = len(sa & sb) / len(sa | sb)
        if jac >= SKILL_LIMIT:
            flags.append(("skill_jaccard", a, b, f"{jac:.3f}", ""))

    bullets = {}
    for d in docs:
        items = [b for e in d.get("experience", []) for b in e.get("bullets", [])]
        items += [b for p in d.get("projects", []) for b in p.get("bullets", [])]
        items += [p["description"] for p in d.get("projects", []) if p.get("description")]
        for b in items:
            key = " ".join(b.lower().split())
            bullets.setdefault(key, set()).add(d["candidate_id"])
    for text, owners in sorted(bullets.items()):
        if len(owners) > 1:
            owners = sorted(owners)
            flags.append(("verbatim_bullet", owners[0], "|".join(owners[1:]), "", text[:120]))

    names = Counter(d["full_name"] for d in docs)
    for name, n in names.items():
        if n > 1:
            flags.append(("duplicate_name", name, "", str(n), ""))
    all_surnames = sorted({s for pool in ref.SURNAMES_REGIONAL.values() for s in pool} | set(ref.SURNAMES_GENERAL),
                          key=len, reverse=True)
    surnames = Counter(next((s for s in all_surnames if d["full_name"].endswith(" " + s)), d["full_name"].split()[-1])
                       for d in docs)
    for surname, n in surnames.items():
        if n > 4:
            flags.append(("surname_over_4", surname, "", str(n), ""))
    return {
        "resumes": len(docs),
        "pairs": len(within) + len(across),
        "full_within": distribution(within), "full_across": distribution(across),
        "summary_within": distribution(s_within), "summary_across": distribution(s_across),
        "flags": flags,
    }


def write_report(result):
    notes_path = DATASET_DIR / "content" / "similarity_resolutions.json"
    notes = json.loads(notes_path.read_text(encoding="utf-8")) if notes_path.exists() else []
    path = DATASET_DIR / "similarity_report.csv"
    with open(path, "w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle, lineterminator="\n")
        writer.writerow(["check", "candidate_a", "candidate_b", "score", "detail", "status", "resolution"])
        for flag in result["flags"]:
            writer.writerow([*flag, "open", ""])
        for note in notes:
            writer.writerow([note["check"], note["candidate_a"], note["candidate_b"], note["score"],
                             note.get("detail", ""), "resolved", note["resolution"]])
    return path


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--only", nargs="*", help="candidate ID prefixes")
    args = parser.parse_args()
    result = run(args.only)
    path = write_report(result)
    print(f"{result['resumes']} resumes, {result['pairs']} pairs")
    print(f"full text, within category : {result['full_within']}")
    print(f"full text, across category : {result['full_across']}")
    print(f"summary,   within category : {result['summary_within']}")
    print(f"summary,   across category : {result['summary_across']}")
    print(f"flags: {len(result['flags'])}")
    for flag in result["flags"]:
        print("  ", " | ".join(x for x in flag if x))
    print(f"report: {path.relative_to(DATASET_DIR)}")
    sys.exit(1 if result["flags"] else 0)


if __name__ == "__main__":
    main()

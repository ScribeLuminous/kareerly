"""Validate the synthetic resume dataset.

Phase 1 (``--matrix``): checks generation_matrix.json against the allocation,
location, naming, layout and skill-origin rules, confirms the generator is
reproducible, and prints the region x category, region x profile, layout and
city tables. Exits non-zero when any check fails.

Phase 2 (``--content``): checks every content/<candidate_id>.json that exists
against the matrix: header, approved locations, dates and experience years,
section rules, forbidden testing terms and leakage of intentionally missing
skills into the visible text.

Usage: python validate_dataset.py --matrix | --content [--only CAT01 CAT02]
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATASET_DIR = HERE.parent
REPO_ROOT = DATASET_DIR.parent.parent
DATA_DIR = REPO_ROOT / "backend" / "data"
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(REPO_ROOT / "backend" / "app" / "services"))

import generate_matrix as gm  # noqa: E402
import layouts  # noqa: E402
import reference as ref  # noqa: E402
import specs  # noqa: E402

PROFILE_RULES = {
    # profile: (min_years, max_years, min_core, max_core, min_missing, min_adjacent)
    "strong_entry": (0, 2, 5, 12, 1, 0),
    "partial_entry": (0, 2, 2, 4, 3, 0),
    "strong_mid": (3, 5, 5, 12, 1, 0),
    "partial_mid": (2, 5, 3, 5, 3, 0),
    "advanced": (5, 15, 6, 13, 1, 0),
    "career_transition": (2, 15, 3, 5, 3, 3),
    "mixed_boundary": (2, 6, 3, 5, 3, 3),
}


class Checks:
    def __init__(self):
        self.results = []

    def check(self, name, ok, detail=""):
        self.results.append((name, bool(ok), detail))

    def report(self):
        width = max(len(n) for n, _, _ in self.results)
        for name, ok, detail in self.results:
            print(f"  [{'PASS' if ok else 'FAIL'}] {name.ljust(width)}  {detail}")
        failed = [n for n, ok, _ in self.results if not ok]
        print(f"\n{len(self.results) - len(failed)}/{len(self.results)} checks passed")
        return not failed


def job_skills_by_category():
    out = defaultdict(set)
    with open(DATA_DIR / "reference_jobs.csv", encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            for field in ("required_skill_ids", "nice_to_have_skill_ids"):
                for sid in row[field].split(";"):
                    if sid.strip():
                        out[row["category_id"].strip()].add(sid.strip())
    return out


def table(title, rows, cols, cell, labels=None):
    print(f"\n{title}")
    head = "".ljust(6) + "".join(str(c).rjust(6) for c in (labels or cols)) + "   tot"
    print(head)
    for r in rows:
        values = [cell(r, c) for c in cols]
        print(str(r).ljust(6) + "".join(str(v or ".").rjust(6) for v in values) + str(sum(values)).rjust(6))


def validate_matrix(show_tables=True):
    c = Checks()
    data = json.loads((DATASET_DIR / "generation_matrix.json").read_text(encoding="utf-8"))
    rows = data["candidates"]
    meta = data["meta"]
    categories = gm.load_categories()
    cat_ids = [k for k, _ in categories]
    skills = gm.load_skills()
    job_skills = job_skills_by_category()
    controlled = [r for r in rows if r["dataset_group"] == "controlled"]
    stress = [r for r in rows if r["dataset_group"] == "cross_category_stress"]

    # ---- counts
    c.check("24 authoritative categories", len(categories) == 24, f"found {len(categories)}")
    per_cat = Counter(r["target_category_id"] for r in controlled)
    c.check("7 controlled resumes per category", all(per_cat[k] == 7 for k in cat_ids) and len(per_cat) == 24,
            f"min {min(per_cat.values())} max {max(per_cat.values())}")
    cat_profiles = defaultdict(set)
    for r in controlled:
        cat_profiles[r["target_category_id"]].add(r["profile_variant"])
    c.check("each category has all 7 profiles", all(cat_profiles[k] == set(specs.PROFILES) for k in cat_ids))
    prof = Counter(r["profile_variant"] for r in rows)
    c.check("24 of each controlled profile", all(prof[p] == 24 for p in specs.PROFILES),
            " ".join(f"{p}={prof[p]}" for p in specs.PROFILES))
    c.check("12 cross_category_stress", prof["cross_category_stress"] == 12 and len(stress) == 12)
    c.check("168 controlled + 12 stress = 180", len(controlled) == 168 and len(rows) == 180,
            f"{len(controlled)} + {len(stress)} = {len(rows)}")
    c.check("dataset_group values valid",
            {r["dataset_group"] for r in rows} == {"controlled", "cross_category_stress"})
    ids = [r["candidate_id"] for r in rows]
    c.check("no duplicate candidate IDs", len(set(ids)) == len(ids))
    c.check("matrix sorted by candidate_id", ids == sorted(ids))
    expected_ids = {f"CAT{i:02d}-R{j:02d}" for i in range(1, 25) for j in range(1, 8)}
    expected_ids |= {f"STRESS-{i:03d}" for i in range(1, 13)}
    c.check("candidate IDs follow CATnn-Rnn / STRESS-nnn", set(ids) == expected_ids)

    # ---- regions
    per_region = Counter(r["region_code"] for r in rows)
    c.check("18 regions x 10 candidates", len(per_region) == 18 and set(per_region.values()) == {10},
            f"min {min(per_region.values())} max {max(per_region.values())}")
    ctrl_region = Counter(r["region_code"] for r in controlled)
    c.check("6 regions with 10 controlled, 12 with 9",
            sorted(Counter(ctrl_region.values()).items()) == [(9, 12), (10, 6)])
    c.check("the six 10-controlled regions match the seeded shuffle",
            sorted(k for k, v in ctrl_region.items() if v == 10) == meta["ten_controlled_regions"])
    stress_region = Counter(r["region_code"] for r in stress)
    c.check("one stress resume in each 9-controlled region",
            set(stress_region.values()) == {1} and all(ctrl_region[k] == 9 for k in stress_region))
    cat_regions = defaultdict(list)
    for r in controlled:
        cat_regions[r["target_category_id"]].append(r["region_code"])
    c.check("each category's 7 controlled in 7 distinct regions",
            all(len(set(v)) == 7 for v in cat_regions.values()))
    rp = Counter((r["region_code"], r["profile_variant"]) for r in controlled)
    c.check("<= 2 controlled of one profile per region", max(rp.values()) <= 2, f"max {max(rp.values())}")
    cats_in_region = defaultdict(set)
    for r in controlled:
        cats_in_region[r["region_code"]].add(r["target_category_id"])
    conflicts = [r["candidate_id"] for r in stress if r["target_category_id"] in cats_in_region[r["region_code"]]]
    c.check("stress region avoids its primary category", not conflicts, ", ".join(conflicts))
    names = dict(ref.REGIONS)
    c.check("region_code/region_name from Section 6.1",
            all(names.get(r["region_code"]) == r["region_name"] for r in rows))

    # ---- locations
    lookup = {(city, prov): code for code, city, prov in ref.LOCATIONS}
    bad_loc = [r["candidate_id"] for r in rows if lookup.get((r["city"], r["province"])) != r["region_code"]]
    c.check("every (city, province, region) in the approved lookup", not bad_loc, ", ".join(bad_loc))
    text = json.dumps(rows, ensure_ascii=False).lower()
    c.check("no Sulu / Jolo / Isabela City anywhere", not any(p in text for p in ref.FORBIDDEN_PLACES))
    city_use = Counter((r["city"], r["province"]) for r in rows)
    c.check("no city used more than twice", max(city_use.values()) <= 2, f"max {max(city_use.values())}")
    region_cities = defaultdict(set)
    for r in rows:
        region_cities[r["region_code"]].add((r["city"], r["province"]))
    c.check(">= 5 distinct cities per region", min(len(v) for v in region_cities.values()) >= 5,
            f"min {min(len(v) for v in region_cities.values())}")
    c.check("ñ preserved in matrix names and places",
            any("ñ" in r["city"] for r in rows) and "ñ" in (DATASET_DIR / "generation_matrix.csv").read_text(encoding="utf-8"),
            "ñ in: " + ", ".join(sorted({r['city'] for r in rows if 'ñ' in r['city']}
                                         | {r['full_name'] for r in rows if 'ñ' in r['full_name']})))

    # The repository's own location mapping must place every location we use in the same region.
    try:
        import ph_regions
        mismatch = []
        for code, city, prov in ref.LOCATIONS:
            found = ph_regions.regions_in_location(f"{city}, {prov}")
            if found != frozenset({code}):
                mismatch.append(f"{city}, {prov}: repo={sorted(found)} prompt={code}")
        c.check("repo ph_regions agrees on every approved location", not mismatch, "; ".join(mismatch))
    except ImportError as exc:  # pragma: no cover
        c.check("repo ph_regions importable", False, str(exc))

    # ---- names and contacts
    full = Counter(r["full_name"] for r in rows)
    c.check("no duplicate full names", max(full.values()) == 1)
    # Match against the pools, longest first, so "Dela Peña" and "De Guzman" count as one surname.
    all_surnames = sorted({s for pool in ref.SURNAMES_REGIONAL.values() for s in pool}
                          | set(ref.SURNAMES_GENERAL), key=len, reverse=True)
    sur = Counter(next(s for s in all_surnames if r["full_name"].endswith(" " + s)) for r in rows)
    c.check("no surname used more than 4 times", max(sur.values()) <= 4, f"max {max(sur.values())}")
    blocked = [r["full_name"] for r in rows
               if any(tok.lower() in ref.BLOCKED_SURNAMES for tok in r["full_name"].split())]
    c.check("no blocked public-figure surnames", not blocked, ", ".join(blocked))
    email_ok = all(re.fullmatch(r"[a-z0-9.]+@example\.(com|org|net)", r["email"]) for r in rows)
    c.check("emails use example.com/.org/.net only", email_ok)
    c.check("emails unique", len({r["email"] for r in rows}) == 180)
    phone_ok = all(re.fullmatch(r"\+63 9\d\d \d{3} \d{4}", r["phone"]) for r in rows)
    c.check("phones use +63 9XX XXX XXXX", phone_ok)
    c.check("phones unique", len({r["phone"] for r in rows}) == 180)

    # ---- layouts
    tv = Counter(r["resume_template_variant"] for r in rows)
    c.check(">= 8 layout variants", len(tv) >= 8, f"{len(tv)} used")
    c.check("each layout used 12-30 times", all(12 <= n <= 30 for n in tv.values()),
            f"min {min(tv.values())} max {max(tv.values())}")
    cat_tv = defaultdict(set)
    for r in controlled:
        cat_tv[r["target_category_id"]].add(r["resume_template_variant"])
    c.check("each category uses >= 4 layouts", min(len(v) for v in cat_tv.values()) >= 4,
            f"min {min(len(v) for v in cat_tv.values())}")
    c.check("layouts suit profiles",
            all(r["resume_template_variant"] in ref.VARIANTS_BY_PROFILE[r["profile_variant"]] for r in rows))

    # ---- skills
    problems = []
    for r in rows:
        cid, target = r["candidate_id"], r["target_category_id"]
        allid = r["core_skill_ids"] + r["supporting_skill_ids"] + r["adjacent_skill_ids"]
        for sid in allid + r["intentionally_missing_skill_ids"]:
            if sid not in skills:
                problems.append(f"{cid}: unknown {sid}")
        if any(sid not in skills for sid in allid + r["intentionally_missing_skill_ids"]):
            continue
        if len(set(allid)) != len(allid):
            problems.append(f"{cid}: repeated skill")
        if set(allid) & set(r["intentionally_missing_skill_ids"]):
            problems.append(f"{cid}: missing skill also held")
        for sid in r["core_skill_ids"]:
            if skills[sid]["category_id"] != target and sid not in job_skills[target]:
                problems.append(f"{cid}: core {sid} not a {target} skill")
        for sid in r["intentionally_missing_skill_ids"]:
            if skills[sid]["category_id"] != target and sid not in job_skills[target] and r["dataset_group"] == "controlled":
                problems.append(f"{cid}: missing {sid} not a {target} skill")
        for sid in r["adjacent_skill_ids"]:
            if skills[sid]["category_id"] == target:
                problems.append(f"{cid}: adjacent {sid} is in {target}")
        if not 6 <= len(allid) <= 15:
            problems.append(f"{cid}: {len(allid)} skills")
        if r["dataset_group"] == "controlled":
            lo, hi, cmin, cmax, mmin, amin = PROFILE_RULES[r["profile_variant"]]
            if not lo <= r["experience_years"] <= hi:
                problems.append(f"{cid}: {r['experience_years']} years for {r['profile_variant']}")
            if not cmin <= len(r["core_skill_ids"]) <= cmax:
                problems.append(f"{cid}: {len(r['core_skill_ids'])} core skills")
            if len(r["intentionally_missing_skill_ids"]) < mmin:
                problems.append(f"{cid}: too few missing skills")
            if len(r["adjacent_skill_ids"]) < amin:
                problems.append(f"{cid}: too few adjacent skills")
            if r["profile_variant"] == "career_transition" and not r["prior_occupation"]:
                problems.append(f"{cid}: career_transition without prior occupation")
            if r["profile_variant"] == "mixed_boundary":
                neighbours = set(specs.NEIGHBOURS[target].split())
                if not neighbours & set(r["adjacent_categories"]):
                    problems.append(f"{cid}: no neighbouring category in {r['adjacent_categories']}")
        else:
            prim = set(r["core_skill_ids"])
            if not set(r["overlap_skill_ids"]) <= prim | set(r["supporting_skill_ids"]):
                problems.append(f"{cid}: overlap skills not held")
            if len(r["secondary_categories"]) < 1:
                problems.append(f"{cid}: no secondary category")
            if r["intentionally_missing_skills"] != r["category_specific_missing_skills"]:
                problems.append(f"{cid}: missing != category_specific_missing")
            if r["target_category"] != r["primary_category"]:
                problems.append(f"{cid}: target != primary category")
    c.check("skill IDs, origins and profile rules", not problems, "; ".join(problems[:12]))
    strong_null = all(r[f] is None for r in controlled for f in
                      ("primary_category", "secondary_categories", "overlap_skills",
                       "category_specific_missing_skills", "stress_test_reason"))
    c.check("stress-only fields null on controlled rows", strong_null)

    # ---- reproducibility
    candidates, meta2 = gm.build()
    same_json = gm.to_json(candidates, meta2) == (DATASET_DIR / "generation_matrix.json").read_text(encoding="utf-8")
    same_csv = gm.to_csv(candidates) == (DATASET_DIR / "generation_matrix.csv").read_text(encoding="utf-8")
    again, meta3 = gm.build()
    c.check("regeneration is byte-identical", same_json and same_csv and gm.to_json(again, meta3) == gm.to_json(candidates, meta2))

    if show_tables:
        regions = [code for code, _ in ref.REGIONS]
        cells = Counter((r["region_code"], r["target_category_id"]) for r in controlled)
        table("Region x category (controlled)", regions, [k[1:] for k in cat_ids],
              lambda rg, k: cells[(rg, "K" + k)])
        pcells = Counter((r["region_code"], r["profile_variant"]) for r in rows)
        short = {"strong_entry": "sE", "partial_entry": "pE", "strong_mid": "sM", "partial_mid": "pM",
                 "advanced": "adv", "career_transition": "tr", "mixed_boundary": "mix",
                 "cross_category_stress": "str"}
        table("Region x profile", regions, list(short), lambda rg, p: pcells[(rg, p)],
              labels=list(short.values()))
        print("\nLayout usage:", ", ".join(f"{k}={v}" for k, v in sorted(tv.items())))
        print("\nCities per region:")
        for code in regions:
            use = Counter(r["city"] for r in rows if r["region_code"] == code)
            print(f"  {code:6} " + ", ".join(f"{city} x{n}" for city, n in sorted(use.items())))
    return c


# ---------------------------------------------------------------- content (Phase 2)

HARD_FAIL = [r"\bFit[ -]Now\b", r"\bLow Match\b", r"\bAspiration candidate\b", r"strong_entry", r"partial_entry",
             r"strong_mid", r"partial_mid", r"career_transition", r"mixed_boundary", r"cross_category",
             r"dataset_group", r"CAT\d{2}", r"STRESS-\d{3}"]
REVIEW = [r"\bboundary\b", r"\bstress test\b", r"\baspiration"]
FULL_TIME_EXEMPT = {"part-time", "freelance", "internship", "volunteer"}
REF_YEAR, REF_MONTH = (int(x) for x in ref.REFERENCE_DATE.split("-")[:2])


def month_index(value):
    if value == "Present":
        return REF_YEAR * 12 + REF_MONTH - 1
    parts = value.split("-")
    return int(parts[0]) * 12 + (int(parts[1]) - 1 if len(parts) > 1 else 0)


def experience_months(roles):
    months = set()
    for role in roles:
        if role.get("type") == "internship":
            continue
        months.update(range(month_index(role["start"]), month_index(role["end"])))
    return len(months)


def alias_table():
    table = defaultdict(lambda: {"verified": set(), "one_way": set()})
    with open(DATA_DIR / "skill_aliases.csv", encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            if row["status"] in ("verified", "one_way"):
                table[row["skill_id"]][row["status"]].add(row["alias"].strip())
    return table


def find_alias(alias, text):
    return re.search(r"(?<![A-Za-z0-9])" + re.escape(alias) + r"(?![A-Za-z0-9])", text, re.IGNORECASE)


def validate_content(only=None):
    c = Checks()
    rows = {r["candidate_id"]: r for r in json.loads((DATASET_DIR / "generation_matrix.json").read_text(encoding="utf-8"))["candidates"]}
    lookup = {f"{city}, {prov}" for _, city, prov in ref.LOCATIONS}
    aliases = alias_table()
    files = sorted((DATASET_DIR / "content").glob("*.json"))
    if only:
        files = [f for f in files if any(f.stem.startswith(o) for o in only)]
    problems, reviews, warnings = defaultdict(list), [], []
    for path in files:
        doc = json.loads(path.read_text(encoding="utf-8"))
        cid = doc["candidate_id"]
        r = rows[cid]
        bad = problems[cid]
        if path.stem != cid:
            bad.append("file name != candidate_id")
        for field, want in (("full_name", r["full_name"]), ("email", r["email"]), ("phone", r["phone"]),
                            ("location", f"{r['city']}, {r['province']}")):
            if doc.get(field) != want:
                bad.append(f"{field} differs from matrix")
        if not re.fullmatch(r"[a-z0-9.]+@example\.(com|org|net)", doc["email"]):
            bad.append("email domain")
        for item in doc.get("experience", []) + doc.get("education", []):
            loc = item.get("location", "")
            base = re.sub(r"\s*\((hybrid|remote)\)$", "", loc)
            remote_ok = loc == "Remote" or (loc.startswith("Remote (") and any(f"{city}" in loc for _, city, _ in ref.LOCATIONS))
            if not (base in lookup or remote_ok):
                bad.append(f"unapproved location '{loc}'")
        # dates
        for item in doc.get("experience", []) + doc.get("education", []) + doc.get("certifications", []):
            for key in ("start", "end", "date"):
                value = item.get(key)
                if value and value != "Present" and month_index(value) > REF_YEAR * 12 + REF_MONTH - 1:
                    bad.append(f"date {value} after reference date")
        for role in doc.get("experience", []):
            if month_index(role["start"]) >= month_index(role["end"]):
                bad.append(f"role '{role['title']}' ends before it starts")
        years = experience_months(doc.get("experience", [])) / 12
        if abs(years - r["experience_years"]) > 1:
            bad.append(f"experience {years:.1f}y vs matrix {r['experience_years']}y")
        full_time = [x for x in doc.get("experience", []) if x.get("type") not in FULL_TIME_EXEMPT]
        for i, a in enumerate(full_time):
            for b in full_time[i + 1:]:
                overlap = min(month_index(a["end"]), month_index(b["end"])) - max(month_index(a["start"]), month_index(b["start"]))
                if overlap > 1:
                    bad.append(f"full-time roles overlap: {a['title']} / {b['title']}")
        if r["profile_variant"] in ("strong_entry", "partial_entry"):
            last = max(int(str(e["end"])[:4]) for e in doc["education"])
            if not REF_YEAR - 3 <= last <= REF_YEAR:
                bad.append(f"entry-level graduation year {last}")
        # sections
        sentences = [x for x in re.split(r"(?<=[.!?])\s+", doc["summary"].strip()) if x]
        if not 2 <= len(sentences) <= 4:
            bad.append(f"summary has {len(sentences)} sentences")
        flat = doc.get("skills") or [i for g in doc.get("skill_groups", []) for i in g["items"]]
        if not 5 <= len(flat) <= 16:
            bad.append(f"{len(flat)} listed skills")
        if not doc.get("experience"):
            bad.append("no experience entries")
        for role in doc.get("experience", []):
            n = len(role.get("bullets", []))
            lenient = role.get("type") in {"internship", "part-time"} or role.get("paragraph")
            if not (1 if lenient else 2) <= n <= 5:
                bad.append(f"role '{role['title']}' has {n} bullets")
        if not doc.get("education"):
            bad.append("no education")
        # visible text
        text = layouts.plain_text(doc, r["resume_template_variant"])
        for pattern in HARD_FAIL:
            if re.search(pattern, text, re.IGNORECASE if pattern[0] == "\\" else 0):
                bad.append(f"forbidden term /{pattern}/")
        for pattern in REVIEW:
            if re.search(pattern, text, re.IGNORECASE):
                reviews.append(f"{cid}: /{pattern}/")
        for sid, name in zip(r["intentionally_missing_skill_ids"], r["intentionally_missing_skills"]):
            for alias in sorted(aliases[sid]["verified"] | {name}):
                if find_alias(alias, text):
                    bad.append(f"missing skill {sid} '{name}' visible as '{alias}'")
            for alias in sorted(aliases[sid]["one_way"]):
                if find_alias(alias, text):
                    warnings.append(f"{cid}: '{alias}' is one-way evidence for missing {sid} {name}")
        held = r["core_skill_ids"] + r["supporting_skill_ids"] + r["adjacent_skill_ids"]
        unseen = [sid for sid in held if not any(find_alias(a, text) for a in aliases[sid]["verified"])]
        if unseen:
            warnings.append(f"{cid}: held skills with no verified alias in text (natural wording): {' '.join(unseen)}")
    ok_files = [cid for cid in problems if not problems[cid]]
    c.check(f"content files checked ({len(files)})", files, "")
    for cid in sorted(problems):
        c.check(cid, not problems[cid], "; ".join(problems[cid]))
    return c, reviews, warnings, ok_files


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--matrix", action="store_true", help="validate generation_matrix.json (Phase 1)")
    parser.add_argument("--content", action="store_true", help="validate content/*.json (Phase 2)")
    parser.add_argument("--only", nargs="*", help="candidate ID prefixes, e.g. CAT01 CAT02")
    parser.add_argument("--quiet", action="store_true", help="skip tables and warnings")
    args = parser.parse_args()
    if args.content:
        checks, reviews, warnings, _ = validate_content(args.only)
        if reviews:
            print("Flagged for manual review (not failures):\n  " + "\n  ".join(reviews))
        if warnings and not args.quiet:
            print("Warnings:\n  " + "\n  ".join(warnings))
        print("\nChecks:")
        sys.exit(0 if checks.report() else 1)
    if not args.matrix:
        parser.error("choose --matrix or --content")
    checks = validate_matrix(show_tables=not args.quiet)
    print("\nChecks:")
    sys.exit(0 if checks.report() else 1)


if __name__ == "__main__":
    main()

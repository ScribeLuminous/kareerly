"""Build the candidate-generation matrix for the 180 synthetic test resumes.

Reads the hand-curated specs (specs.py), the fixed reference data
(reference.py) and Kareerly's own taxonomy (backend/data), then allocates each
candidate a region, a city, a synthetic name and contact details, and a resume
layout. Writes generation_matrix.json and generation_matrix.csv.

Deterministic: one random.Random(seed) instance, sorted inputs, no clock, no
system randomness. Running it twice produces byte-identical files.

Usage: python generate_matrix.py [--out DIR]
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import random
import sys
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATASET_DIR = HERE.parent
REPO_ROOT = DATASET_DIR.parent.parent
DATA_DIR = REPO_ROOT / "backend" / "data"
sys.path.insert(0, str(HERE))

import reference as ref  # noqa: E402
import specs  # noqa: E402

MAX_ATTEMPTS = 200
LIST_FIELDS = (
    "core_skills", "core_skill_ids", "supporting_skills", "supporting_skill_ids",
    "intentionally_missing_skills", "intentionally_missing_skill_ids", "adjacent_skills",
    "adjacent_skill_ids", "adjacent_categories", "secondary_categories", "overlap_skills",
    "overlap_skill_ids", "category_specific_missing_skills",
)
CSV_FIELDS = (
    "candidate_id", "dataset_group", "target_category_id", "target_category", "profile_variant",
    "primary_role", "prior_occupation", "experience_years", "experience_level", "education_level",
    "core_skills", "core_skill_ids", "supporting_skills", "supporting_skill_ids",
    "intentionally_missing_skills", "intentionally_missing_skill_ids", "adjacent_skills",
    "adjacent_skill_ids", "adjacent_categories", "city", "province", "region_code", "region_name",
    "full_name", "email", "phone", "resume_template_variant", "primary_category", "secondary_categories",
    "overlap_skills", "overlap_skill_ids", "category_specific_missing_skills", "stress_test_reason",
)


def load_categories() -> list[tuple[str, str]]:
    with open(DATA_DIR / "category_reference.csv", encoding="utf-8", newline="") as handle:
        rows = [(r["category_id"].strip(), r["category_name"].strip()) for r in csv.DictReader(handle)]
    return sorted(rows)


def load_skills() -> dict[str, dict]:
    with open(DATA_DIR / "skills_reference.csv", encoding="utf-8", newline="") as handle:
        return {r["skill_id"].strip(): r for r in csv.DictReader(handle)}


def experience_level(years: int) -> str:
    if years <= 1:
        return "Entry Level"
    if years == 2:
        return "Junior"
    if years <= 5:
        return "Mid Level"
    return "Senior"


def ids(text: str) -> list[str]:
    return text.split()


def fold_ascii(text: str) -> str:
    return unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")


# ---------------------------------------------------------------- allocation


def allocate_regions(seed: int, categories: list[str]):
    """Place the 168 controlled candidates, then the 12 stress candidates.

    Regions are shuffled; the first six in shuffled order take 10 controlled
    candidates. Categories are laid out cyclically over the shuffled regions,
    seven consecutive slots each, so a category's seven candidates always land
    in seven different regions. Profile order within a category is shuffled.
    Returns None when the no-more-than-2-of-a-profile-per-region rule fails.
    """
    rng = random.Random(seed)
    regions = sorted(code for code, _ in ref.REGIONS)
    order = regions[:]
    rng.shuffle(order)
    ten_regions = sorted(order[:6])
    cats = sorted(categories)
    rng.shuffle(cats)
    placement = {}
    for index, cat in enumerate(cats):
        profiles = list(specs.PROFILES)
        rng.shuffle(profiles)
        for offset, profile in enumerate(profiles):
            placement[(cat, profile)] = order[(index * 7 + offset) % len(order)]

    # Seeded repair: swapping the regions of two profiles inside one category
    # keeps every category in seven distinct regions and every region's load
    # unchanged, so only the per-region profile limit can move.
    def excess(counts):
        return sum(max(0, n - 2) for n in counts.values())

    counts = Counter((region, profile) for (cat, profile), region in placement.items())
    swaps = 0
    for _ in range(20000):
        if excess(counts) == 0:
            break
        bad = sorted(key for key, n in counts.items() if n > 2)
        region, profile = rng.choice(bad)
        cat = rng.choice(sorted(c for (c, p), r in placement.items() if r == region and p == profile))
        other = rng.choice([p for p in specs.PROFILES if p != profile])
        other_region = placement[(cat, other)]
        trial = counts.copy()
        trial[(region, profile)] -= 1
        trial[(other_region, other)] -= 1
        trial[(other_region, profile)] += 1
        trial[(region, other)] += 1
        if excess(trial) <= excess(counts):
            placement[(cat, profile)], placement[(cat, other)] = other_region, region
            counts = +trial
            swaps += 1
    if excess(counts) > 0:
        return None

    # Stress candidates go to the 12 regions holding 9 controlled candidates,
    # avoiding regions where their primary category already appears if possible.
    nine_regions = sorted(order[6:])
    cats_in_region = defaultdict(set)
    for (cat, _), region in placement.items():
        cats_in_region[region].add(cat)
    stress = sorted(specs.STRESS)
    choices = {}
    for row in stress:
        options = nine_regions[:]
        rng.shuffle(options)
        choices[row[0]] = options

    def assign(i, used, strict):
        if i == len(stress):
            return {}
        sid, primary = stress[i][0], stress[i][1]
        for region in choices[sid]:
            if region in used or (strict and primary in cats_in_region[region]):
                continue
            rest = assign(i + 1, used | {region}, strict)
            if rest is not None:
                rest[sid] = region
                return rest
        return None

    stress_regions = assign(0, frozenset(), True)
    strict = stress_regions is not None
    if stress_regions is None:
        stress_regions = assign(0, frozenset(), False)
    return {
        "controlled": placement,
        "stress": stress_regions,
        "ten_regions": ten_regions,
        "stress_region_conflict_free": strict,
        "repair_swaps": swaps,
        "rng": rng,
    }


def allocate_cities(rng: random.Random, members_by_region: dict[str, list[str]]) -> dict[str, tuple[str, str]]:
    by_region = defaultdict(list)
    for code, city, province in ref.LOCATIONS:
        by_region[code].append((city, province))
    out = {}
    for region in sorted(members_by_region):
        members = sorted(members_by_region[region])
        rng.shuffle(members)
        cities = sorted(by_region[region])
        rng.shuffle(cities)
        for j, candidate_id in enumerate(members):
            out[candidate_id] = cities[j % len(cities)]
    return out


def allocate_names(rng: random.Random, candidates: list[dict]) -> None:
    used_full, surname_uses, used_email, used_phone = set(), Counter(), set(), set()
    order = sorted(c["candidate_id"] for c in candidates)
    rng.shuffle(order)
    by_id = {c["candidate_id"]: c for c in candidates}
    for candidate_id in order:
        c = by_id[candidate_id]
        region = c["region_code"]
        muslim = rng.random() < ref.MUSLIM_NAME_SHARE.get(region, 0.0)
        female = rng.random() < 0.5
        for _ in range(1000):
            if muslim:
                given = rng.choice(ref.GIVEN_F_MUSLIM if female else ref.GIVEN_M_MUSLIM)
                surname = rng.choice(ref.SURNAMES_REGIONAL["muslim"])
            else:
                given = rng.choice(ref.GIVEN_F if female else ref.GIVEN_M)
                area = ref.REGION_NAME_AREA[region]
                pool = ref.SURNAMES_REGIONAL[area] if area != "muslim" else ref.SURNAMES_REGIONAL["mindanao"]
                surname = rng.choice(pool if rng.random() < 0.4 else ref.SURNAMES_GENERAL)
            full = f"{given} {surname}"
            if (full in used_full or surname_uses[surname] >= 3
                    or surname.lower() in ref.BLOCKED_SURNAMES
                    or given.split()[0].lower() in ref.BLOCKED_GIVEN):
                continue
            break
        else:
            raise RuntimeError(f"no free name for {candidate_id}")
        used_full.add(full)
        surname_uses[surname] += 1
        local_given = fold_ascii(given.split()[0]).lower().replace(".", "")
        local_surname = fold_ascii(surname).lower().replace(" ", "").replace(".", "")
        domain = rng.choice(ref.EMAIL_DOMAINS)
        email = f"{local_given}.{local_surname}@{domain}"
        suffix = 2
        while email in used_email:
            email = f"{local_given}.{local_surname}{suffix}@{domain}"
            suffix += 1
        used_email.add(email)
        while True:
            phone = (f"+63 {rng.choice(ref.PHONE_PREFIXES)} {rng.randrange(100, 1000)} "
                     f"{rng.randrange(0, 10000):04d}")
            if phone not in used_phone:
                break
        used_phone.add(phone)
        c.update(full_name=full, email=email, phone=phone)


def allocate_templates(rng: random.Random, candidates: list[dict]) -> None:
    counts = Counter()
    per_category = defaultdict(Counter)
    order = sorted(c["candidate_id"] for c in candidates)
    rng.shuffle(order)
    by_id = {c["candidate_id"]: c for c in candidates}
    for candidate_id in order:
        c = by_id[candidate_id]
        allowed = sorted(ref.VARIANTS_BY_PROFILE[c["profile_variant"]])
        rng.shuffle(allowed)
        cat = c["target_category_id"] if c["dataset_group"] == "controlled" else "stress"
        choice = min(allowed, key=lambda v: (per_category[cat][v], counts[v]))
        counts[choice] += 1
        per_category[cat][choice] += 1
        c["resume_template_variant"] = choice


# ---------------------------------------------------------------- matrix


def build(seed: int = ref.SEED) -> tuple[list[dict], dict]:
    categories = load_categories()
    cat_names = dict(categories)
    skills = load_skills()

    def names(skill_ids):
        return [skills[s]["skill_name"].strip() for s in skill_ids]

    attempts = 0
    allocation = None
    while allocation is None:
        if attempts >= MAX_ATTEMPTS:
            raise RuntimeError("no valid allocation found")
        used_seed = seed + attempts
        allocation = allocate_regions(used_seed, [c for c, _ in categories])
        attempts += 1
    rng = allocation["rng"]

    candidates = []
    for cat_index, (cat_id, cat_name) in enumerate(categories, start=1):
        rows = specs.CONTROLLED[cat_id]
        for r_index, row in enumerate(rows, start=1):
            profile, role, years, edu, prior, core, support, missing, adjacent = row
            region = allocation["controlled"][(cat_id, profile)]
            adj_ids = ids(adjacent)
            candidates.append({
                "candidate_id": f"CAT{cat_index:02d}-R{r_index:02d}",
                "dataset_group": "controlled",
                "target_category_id": cat_id,
                "target_category": cat_name,
                "profile_variant": profile,
                "primary_role": role,
                "prior_occupation": prior,
                "experience_years": years,
                "experience_level": experience_level(years),
                "education_level": specs.EDUCATION_LEVELS[edu],
                "core_skills": names(ids(core)), "core_skill_ids": ids(core),
                "supporting_skills": names(ids(support)), "supporting_skill_ids": ids(support),
                "intentionally_missing_skills": names(ids(missing)),
                "intentionally_missing_skill_ids": ids(missing),
                "adjacent_skills": names(adj_ids), "adjacent_skill_ids": adj_ids,
                "adjacent_categories": sorted({skills[s]["category_id"] for s in adj_ids}),
                "region_code": region,
                "region_name": ref.REGION_NAMES[region],
                "primary_category": None, "secondary_categories": None, "overlap_skills": None,
                "overlap_skill_ids": None, "category_specific_missing_skills": None,
                "stress_test_reason": None,
            })
    for row in sorted(specs.STRESS):
        (sid, primary, secondary, role, years, edu, prim_skills, sec_skills,
         overlap, cat_missing, reason) = row
        region = allocation["stress"][sid]
        sec_ids = ids(sec_skills)
        candidates.append({
            "candidate_id": sid,
            "dataset_group": "cross_category_stress",
            "target_category_id": primary,
            "target_category": cat_names[primary],
            "profile_variant": "cross_category_stress",
            "primary_role": role,
            "prior_occupation": "",
            "experience_years": years,
            "experience_level": experience_level(years),
            "education_level": specs.EDUCATION_LEVELS[edu],
            "core_skills": names(ids(prim_skills)), "core_skill_ids": ids(prim_skills),
            "supporting_skills": names(sec_ids), "supporting_skill_ids": sec_ids,
            "intentionally_missing_skills": names(ids(cat_missing)),
            "intentionally_missing_skill_ids": ids(cat_missing),
            "adjacent_skills": [], "adjacent_skill_ids": [],
            "adjacent_categories": sorted({skills[s]["category_id"] for s in sec_ids} - {primary}),
            "region_code": region,
            "region_name": ref.REGION_NAMES[region],
            "primary_category": cat_names[primary],
            "secondary_categories": [cat_names[c] for c in secondary.split()],
            "overlap_skills": names(ids(overlap)), "overlap_skill_ids": ids(overlap),
            "category_specific_missing_skills": names(ids(cat_missing)),
            "stress_test_reason": reason,
        })

    members = defaultdict(list)
    for c in candidates:
        members[c["region_code"]].append(c["candidate_id"])
    cities = allocate_cities(rng, members)
    for c in candidates:
        c["city"], c["province"] = cities[c["candidate_id"]]
    allocate_names(rng, candidates)
    allocate_templates(rng, candidates)

    candidates.sort(key=lambda c: c["candidate_id"])
    candidates = [{field: c[field] for field in CSV_FIELDS} for c in candidates]
    meta = {
        "seed": seed,
        "seed_used": seed + attempts - 1,
        "attempts": attempts,
        "repair_swaps": allocation["repair_swaps"],
        "ten_controlled_regions": allocation["ten_regions"],
        "stress_region_conflict_free": allocation["stress_region_conflict_free"],
        "reference_date": ref.REFERENCE_DATE,
    }
    return candidates, meta


def to_json(candidates: list[dict], meta: dict) -> str:
    return json.dumps({"meta": meta, "candidates": candidates}, ensure_ascii=False, indent=2) + "\n"


def to_csv(candidates: list[dict]) -> str:
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=CSV_FIELDS, lineterminator="\n")
    writer.writeheader()
    for c in candidates:
        row = {}
        for field in CSV_FIELDS:
            value = c[field]
            if value is None:
                value = ""
            elif isinstance(value, list):
                value = "|".join(value)
            row[field] = value
        writer.writerow(row)
    return buffer.getvalue()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path, default=DATASET_DIR)
    args = parser.parse_args()
    candidates, meta = build()
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "generation_matrix.json").write_text(to_json(candidates, meta), encoding="utf-8")
    (args.out / "generation_matrix.csv").write_text(to_csv(candidates), encoding="utf-8")
    print(f"wrote {len(candidates)} candidates to {args.out} (seed used {meta['seed_used']}, "
          f"attempts {meta['attempts']})")


if __name__ == "__main__":
    main()

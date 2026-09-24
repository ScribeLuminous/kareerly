"""Apply the reviewed fixes from docs/job-data-anomalies.md to the reference data.

    python3 scripts/fix_reference_job_data.py --esco-dir <unzipped ESCO v1.2.1 CSV folder>

Rewrites data/reference_jobs.csv and data/skills_reference.csv in place. Running
it again gives the same files.

Jobs: each entry in JOB_FIXES is the reviewed skill list for that job, checked
against the posting text and the ESCO occupation profile
(occupationSkillRelations_en.csv). It replaces the old list; it is not a
patch. Nice-to-have skills that are also required are dropped from every job,
and job_text_for_matching is rebuilt for every job from the columns it
summarises, so removed skills no longer reach the model input.

Skills: SKILL_RELINKS points core skills whose ESCO link was picked by wording
("Pharmacy Support" -> "navy operations") at the right ESCO concept.
RELATED_DROP removes aliases that came from an unrelated ESCO concept
("oversee casino" on Classroom Management). Resume parsing uses both as aliases,
so a wrong entry makes the parser report a skill the candidate does not have.
"""

from __future__ import annotations

import argparse
import csv
import re
from pathlib import Path

DATA = Path(__file__).resolve().parents[1] / "data"
JOBS_CSV = DATA / "reference_jobs.csv"
SKILLS_CSV = DATA / "skills_reference.csv"
REVIEW_NOTE = "Reviewed 2026-09-24 against the posting and its ESCO occupation profile; see docs/job-data-anomalies.md."
# Postings with their own requirement text; other sources list the mapped skill names.
POSTING_SOURCES = {"Kareerly_Job_DB"}
MAX_REQUIRED = 8

# job_id: required, nice-to-have, and optionally category / title / description.
JOB_FIXES: dict[str, dict] = {
    # --- JOB-001 to JOB-060 (JobStreet-informed curation) ---
    "JOB-001": {"required": "SK004 SK002 SK003 SK005 SK130 SK190 SK020", "nice": "SK001 SK011 SK006 SK193"},
    "JOB-002": {"category": "K04", "required": "SK012 SK013 SK197", "nice": "SK247"},
    "JOB-003": {"required": "SK029 SK031 SK030", "nice": "SK300"},
    "JOB-004": {"category": "K03", "required": "SK007 SK005 SK186 SK197 SK299", "nice": ""},
    "JOB-005": {"category": "K03", "required": "SK007 SK009 SK166 SK031 SK030", "nice": "SK011"},
    "JOB-006": {"required": "SK005 SK006 SK145 SK237", "nice": ""},
    "JOB-007": {"required": "SK009 SK166 SK151 SK210 SK007", "nice": "SK129 SK011 SK149"},
    "JOB-008": {"category": "K03", "required": "SK163 SK187 SK005 SK119 SK020", "nice": "SK146"},
    "JOB-009": {"required": "SK001 SK002 SK133 SK003 SK213 SK004", "nice": "SK011 SK136"},
    "JOB-010": {"required": "SK004 SK005 SK006 SK126 SK197", "nice": "SK001"},
    "JOB-011": {"required": "SK007 SK009 SK299", "nice": "SK098 SK186"},
    "JOB-012": {"required": "SK010 SK125 SK198", "nice": "SK146 SK132"},
    "JOB-013": {"required": "SK004 SK006 SK145 SK008", "nice": "SK001"},
    "JOB-014": {"category": "K03", "required": "SK011 SK166 SK147 SK009", "nice": "SK129"},
    "JOB-015": {"category": "K06", "required": "SK021 SK213 SK020 SK210", "nice": "SK216"},
    "JOB-016": {"required": "SK013 SK005 SK259 SK254 SK235 SK012", "nice": "SK006"},
    "JOB-017": {"required": "SK015 SK016 SK020 SK186 SK254", "nice": "SK021"},
    "JOB-019": {"category": "K07", "required": "SK028 SK032 SK276 SK020", "nice": ""},
    "JOB-020": {"required": "SK014 SK012 SK112 SK254", "nice": "SK204"},
    "JOB-021": {"category": "K04", "required": "SK187 SK005 SK013 SK112 SK034 SK197", "nice": "SK163"},
    "JOB-022": {"required": "SK112 SK233 SK197", "nice": "SK013 SK256"},
    "JOB-023": {"required": "SK235 SK013 SK005 SK259 SK197", "nice": ""},
    "JOB-024": {"required": "SK206 SK022 SK261", "nice": "SK211"},
    "JOB-025": {"category": "K05", "required": "SK015 SK020 SK082 SK202 SK186", "nice": "SK031"},
    "JOB-026": {"required": "SK112 SK034 SK234 SK187 SK119", "nice": "SK048"},
    "JOB-027": {"required": "SK005 SK013 SK197 SK223 SK242", "nice": "SK006"},
    "JOB-028": {"category": "K07", "required": "SK033 SK032 SK304", "nice": "SK553"},
    "JOB-029": {"required": "SK005 SK119 SK126 SK034 SK197", "nice": "SK001"},
    "JOB-030": {"category": "K05", "required": "SK114 SK112 SK016", "nice": "SK115"},
    "JOB-031": {"required": "SK026 SK263 SK264 SK316 SK023", "nice": ""},
    "JOB-033": {"required": "SK276 SK293 SK023 SK025 SK300", "nice": ""},
    "JOB-034": {"category": "K08", "required": "SK283 SK271 SK307 SK028 SK261", "nice": "SK024"},
    "JOB-035": {"required": "SK029 SK020 SK314 SK300", "nice": ""},
    "JOB-036": {"required": "SK276 SK023 SK030 SK300", "nice": "SK291"},
    "JOB-037": {"required": "SK026 SK265 SK316", "nice": "SK034 SK124"},
    "JOB-038": {"category": "K08", "required": "SK264 SK035 SK316", "nice": "SK124 SK300"},
    "JOB-039": {"category": "K08", "required": "SK023 SK274 SK271 SK005", "nice": "SK028"},
    "JOB-040": {"category": "K07", "required": "SK023 SK261 SK276 SK300", "nice": ""},
    "JOB-041": {"category": "K08", "required": "SK034 SK265 SK279 SK023", "nice": "SK004"},
    "JOB-042": {"category": "K07", "required": "SK276 SK300 SK008 SK006 SK048", "nice": "SK004"},
    "JOB-043": {"required": "SK028 SK138 SK006 SK285", "nice": "SK001"},
    "JOB-044": {"required": "SK024 SK098 SK263 SK005", "nice": "SK553"},
    "JOB-045": {"category": "K08", "required": "SK262 SK032 SK020 SK316", "nice": ""},
    "JOB-046": {"category": "K11", "required": "SK040 SK325 SK283", "nice": "SK042 SK038 SK321"},
    "JOB-048": {"category": "K08", "required": "SK027 SK044 SK034 SK316", "nice": "SK051 SK266 SK039"},
    "JOB-049": {"category": "K11", "required": "SK039 SK043 SK321 SK334", "nice": ""},
    "JOB-051": {"required": "SK042 SK347 SK040", "nice": "SK003"},
    "JOB-052": {"required": "SK038 SK325 SK497", "nice": "SK039"},
    "JOB-053": {"required": "SK321 SK334 SK040", "nice": "SK039"},
    "JOB-054": {"category": "K11", "required": "SK037 SK283 SK261 SK346", "nice": "SK308 SK242"},
    "JOB-055": {"required": "SK043 SK257 SK034 SK268", "nice": "SK039"},
    "JOB-056": {"category": "K11", "required": "SK040 SK334 SK037 SK325", "nice": "SK321"},
    "JOB-057": {"required": "SK042 SK003 SK040", "nice": "SK002"},
    "JOB-058": {"required": "SK034 SK037 SK028", "nice": "SK257"},
    "JOB-059": {"required": "SK040 SK042 SK330 SK283", "nice": "SK321"},
    "JOB-060": {"required": "SK278 SK032 SK005 SK242", "nice": "SK308"},
    # --- Coverage seeds: filler nice-to-haves and the two near-duplicates ---
    "JOB-081": {"required": "SK096 SK097", "nice": "SK095 SK091"},
    "JOB-082": {
        "title": "Forklift and Materials Handling Assistant",
        "required": "SK099 SK089",
        "nice": "SK581 SK091 SK093",
    },
    "JOB-085": {
        "title": "Reforestation and Nursery Assistant",
        "required": "SK107 SK106 SK101",
        "nice": "SK100 SK102",
    },
    # --- Seed and template jobs (section 2 of the anomalies doc) ---
    "JOB-114": {"required": "SK089 SK070 SK074", "nice": "SK069 SK091"},
    "JOB-130": {"category": "K19", "required": "SK087 SK080", "nice": "SK086 SK079"},
    "JOB-146": {"required": "SK103 SK104", "nice": "SK105 SK108 SK091"},
    "WEB-20260922-K11": {"required": "SK040 SK325 SK334", "nice": ""},
    "WEB-20260922-K17": {"required": "SK456 SK069 SK067", "nice": ""},
    "WEB-20260922-K20": {"required": "SK099 SK098 SK095", "nice": ""},
    "WEB-20260922-K21": {"required": "SK094 SK076 SK090 SK225", "nice": ""},
    "WEB-20260922-K24": {"required": "SK117 SK118 SK119 SK602", "nice": ""},
}

# The coverage seeds described themselves as seeds; these replace those descriptions.
SEED_DESCRIPTIONS = {
    "JOB-061": "Supports day-to-day HR work: maintains employee records, helps coordinate recruitment and onboarding, prepares HR documents, and answers routine staff queries.",
    "JOB-062": "Supports the purchasing team by preparing purchase requests, comparing supplier quotes, following up orders and deliveries, and keeping purchasing records up to date.",
    "JOB-063": "Assists the creative team in producing multimedia content, preparing graphics, layouts, and simple interface assets, and keeping design files organised.",
    "JOB-064": "Helps library users find materials, processes loans and returns, shelves and catalogues resources, and keeps library records accurate.",
    "JOB-065": "Supports teachers by preparing lesson materials, helping manage the classroom, checking learner work, and assisting individual students.",
    "JOB-066": "Designs and schedules training sessions, prepares learning materials, supports facilitators, and evaluates training results with participant feedback.",
    "JOB-067": "Guides clients through fitness routines, promotes healthy lifestyle habits, and tracks their wellness progress.",
    "JOB-068": "Supports clinic staff with patient intake and basic assessments, uses correct medical terminology, and keeps clinical records complete.",
    "JOB-069": "Provides daily personal care to elderly or dependent clients, monitors their wellbeing, and responds to emergencies with basic life support.",
    "JOB-070": "Supports pharmacy and laboratory staff with stock, dispensing preparation, and sample handling while following laboratory safety procedures.",
    "JOB-071": "Assists skilled trades on site with carpentry and general construction tasks, prepares materials and tools, and follows construction safety rules.",
    "JOB-072": "Assists with preventive maintenance and repair of mechanical and electronic equipment, records work done, and reports faults.",
    "JOB-073": "Prepares and updates CAD drawings from engineers' mark-ups, keeps drawing files organised, and supports design documentation.",
    "JOB-074": "Supports quality checks and site surveys, records measurements, and helps prepare inspection and survey reports.",
    "JOB-075": "Prepares and serves food, keeps the service and kitchen areas clean, and follows food safety standards.",
    "JOB-076": "Cleans and prepares guest rooms, restocks amenities, and responds to guest requests courteously.",
    "JOB-077": "Provides basic grooming services, handles laundry, and keeps service areas clean and ready for clients.",
    "JOB-078": "Handles bookings and reservations, coordinates event logistics, and communicates arrangements to guests and suppliers.",
    "JOB-079": "Assembles and packs products on the production line and checks finished items against quality standards.",
    "JOB-080": "Operates and monitors production machines, performs routine checks, and reports faults to maintenance.",
    "JOB-081": "Drives company vehicles on planned delivery routes, follows safe driving practices, and confirms deliveries with customers.",
    "JOB-082": "Moves, stacks, and stores goods using forklifts and other materials-handling equipment while following warehouse and storage safety rules.",
    "JOB-083": "Assists with planting, crop care, and harvest, including basic pest management and nursery work.",
    "JOB-084": "Supports daily aquaculture operations: feeding stock, checking water conditions, and handling harvested fish.",
    "JOB-085": "Raises seedlings in the nursery and supports tree-planting and reforestation activities, including site preparation and plant care.",
    "JOB-086": "Supports livestock and dairy production through feeding, milking, and keeping production records.",
    "JOB-087": "Assists government offices with frontline service, processes requests, and maintains public records.",
    "JOB-088": "Supports lawyers with legal research, prepares contract review summaries, and organises case files.",
    "JOB-089": "Provides administrative support to managers in a public office: schedules, correspondence, reports, and follow-ups on assigned actions.",
    "JOB-090": "Monitors premises and security systems, responds to incidents and emergencies, and records security reports.",
}

# skill_id: ESCO preferred label of the concept the skill should link to.
SKILL_RELINKS = {
    "SK022": "coordinate operational activities",  # was "ensure lawful business operations"
    "SK024": "supervise sales activities",  # was "mill operations"
    "SK052": "maintain records of work with service users",  # was "maintain customer records"
    "SK059": "apply person-centred care",  # was "provide lawn care"
    "SK061": "provide first aid",  # was "provide ICT support"
    "SK064": "ensure the appropriate supply in pharmacy",  # was "navy operations"
    "SK069": "use measurement instruments",  # was "take measurements of performance space"
    "SK071": "lay bricks",  # was "blast masonry"
    "SK078": "greet guests",  # was "train reception staff"
    "SK081": "provide tourism related information",  # was "tourism market"
    "SK087": "style hair",  # was "thermal treatment" (waste incineration)
    "SK089": "operate industrial equipment",  # was "operate router machinery"
    "SK104": "manage livestock",  # was "research livestock production"
    "SK106": "conserve natural resources",  # was "inform customers environmental protection"
}

# related_skills entries that describe different work from the skill.
RELATED_DROP = {
    "SK001": ["programming languages for smart contract"],
    "SK003": ["developing staff", "help strengthen staff", "build up staff"],
    "SK013": ["monetary estimating", "monetary planning", "financial planning", "monetary calculating", "financial calculating"],
    "SK014": ["collect payments", "take payments for bills", "handle payments", "processing payments", "accept payments"],
    "SK027": ["non-violent social conflict resolution", "social mediations", "process of creation and management of social life"],
    "SK031": [
        "effectively communicate in healthcare", "communicate effectively in health care",
        "use communication techniques to interact with patients families and caregivers",
        "communicate effectively with patients families and caregivers", "communicate effectively in healthcare",
    ],
    "SK034": ["correspond in written Montenegrin", "show competency in written Montenegrin"],
    "SK039": ["edit sound footage", "edit recorded sounds", "edit sound recording", "edit audio recordings"],
    "SK043": ["edit the negatives", "alter negatives", "retouch negatives", "editing of negatives"],
    "SK046": ["oversee casino", "supervise casino", "managing casino"],
    "SK048": ["train animals", "instruct animals", "deliver animal training", "implement animal training", "execute training programmes for animals"],
    "SK055": ["give a hand to pool users", "assisting pool users", "assist pool user", "help pool users"],
    "SK056": ["test students", "observe student's progress", "track student's progress", "oversee student's progress", "conduct examination processes for apprentices"],
    "SK060": ["caring for forest wildlife", "protecting flora and fauna", "caring for the wildlife", "flora and fauna protecting", "protect flora and fauna"],
    "SK068": ["computer-aided translation use", "employ computer-aided translation", "using computer-aided translation", "apply computer-aided translation", "operate computer-aided translation"],
    "SK070": ["electrical installation safety regulations", "standards for electrical safety", "electrical maintenance regulations", "electrical wiring safety regulations", "electrical wiring regulations"],
    "SK075": ["packing electronic equipment", "pack electronic devices", "pack computerised devices"],
    "SK085": ["taking orders", "take orders", "receive requests for food and beverages"],
    "SK088": ["the mashing process", "mashing process", "the process of mashing", "process of lautering", "lautering processes"],
    "SK090": ["monitoring mine production rates", "oversee mine productivity", "mine production rate monitoring", "oversee mine production rate", "overseeing mine production rate"],
    "SK092": ["robots assembling", "assembling robots", "robotic machines assembling", "assembling robotic machines", "robot assembling"],
    "SK094": ["review paint quality", "inspect quality of paint", "inspect paint condition", "check paint quality"],
    "SK112": ["enable customs compliance", "assure customs compliance", "secure customs compliance", "provide customs compliance", "ensuring customs compliance"],
    "SK114": ["verify group travel documents", "check documents for travel", "check travelling documentation", "review travel documents"],
    "SK118": [
        "responding to nuclear emergencies", "nuclear emergencies responding", "implement actions in response to nuclear emergency",
        "implementing actions in response to nuclear emergency", "dealing with emergencies at nuclear facilities",
    ],
    "SK119": ["report incidents on gaming", "reporting incidents on gaming", "denounce gaming incidents", "inform on gambling incidents"],
}


def split_ids(value: str) -> list[str]:
    return [item.strip().upper() for item in re.split(r"[;,|\s]+", value or "") if item.strip()]


def unique(values: list[str]) -> list[str]:
    return list(dict.fromkeys(value for value in values if value))


def read_csv(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    with path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        return list(reader.fieldnames or []), list(reader)


def write_csv(path: Path, fieldnames: list[str], rows: list[dict[str, str]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def load_esco(esco_dir: Path) -> dict[str, dict[str, str]]:
    with (esco_dir / "skills_en.csv").open(newline="", encoding="utf-8") as handle:
        return {row["preferredLabel"]: row for row in csv.DictReader(handle)}


def fix_skills(skills: list[dict[str, str]], esco: dict[str, dict[str, str]]) -> None:
    for row in skills:
        skill_id = row["skill_id"]
        drop = {term.lower() for term in RELATED_DROP.get(skill_id, [])}
        label = SKILL_RELINKS.get(skill_id)
        if label:
            concept = esco[label]
            old = {row["esco_preferred_label"].lower()} | {a.strip().lower() for a in re.split(r"[;\n]", row["esco_alternative_labels"])}
            drop |= old
            alternatives = [a.strip() for a in concept["altLabels"].splitlines() if a.strip()]
            row.update({
                "esco_skill_uri": concept["conceptUri"],
                "esco_preferred_label": concept["preferredLabel"],
                "esco_alternative_labels": "; ".join(alternatives),
                "esco_description": concept["description"].strip(),
                "esco_version": "v1.2.1",
                "mapping_confidence": "0.9",
                "mapping_status": "reviewed",
            })
        if not drop and not label:
            continue
        related = [t.strip() for t in row["related_skills"].split(";") if t.strip() and t.strip().lower() not in drop]
        if label:
            # Keep the name first and the category labels last, as the other rows do.
            head, tail = related[:2], related[2:]
            related = unique(head + [row["esco_preferred_label"]] + alternatives[:5] + tail)
        row["related_skills"] = "; ".join(related)


def mark_job_skills_reviewed(skills: list[dict[str, str]], jobs: list[dict[str, str]]) -> int:
    """Every imported ESCO skill still used by a job was checked with that job; record it.

    These rows are named after their ESCO concept, so the link itself is exact;
    what was unreviewed is whether any job should require them.
    """
    used = {s for row in jobs for s in split_ids(row["required_skill_ids"]) + split_ids(row["nice_to_have_skill_ids"])}
    promoted = 0
    for row in skills:
        if row["skill_id"] in used and row["mapping_status"] == "auto_generated_review":
            row["mapping_status"] = "reviewed"
            promoted += 1
    return promoted


def job_text(row: dict[str, str]) -> str:
    required = row["required_skills_comma_separated"]
    nice = row["nice_to_have_skills_optional"]
    mapped_required = [n for n in row["mapped_required_skill_names"].split("; ") if n and n.lower() not in required.lower()]
    mapped_nice = [n for n in row["mapped_nice_to_have_skill_names"].split("; ") if n and n.lower() not in nice.lower()]
    parts = [
        row["job_title"],
        row["job_description"],
        "Required skills: " + ", ".join(filter(None, [required] + mapped_required)),
        "Nice to have: " + ", ".join(filter(None, [nice] + mapped_nice)) if nice or mapped_nice else "",
        row["job_category"],
    ]
    return " ".join(" ".join(filter(None, parts)).split()).lower()


def fix_jobs(jobs: list[dict[str, str]], skill_names: dict[str, str], categories: dict[str, str]) -> None:
    for row in jobs:
        job_id = row["job_id"]
        fix = JOB_FIXES.get(job_id, {})
        if "title" in fix:
            row["job_title"] = fix["title"]
        if job_id in SEED_DESCRIPTIONS:
            row["job_description"] = SEED_DESCRIPTIONS[job_id]
        if "category" in fix:
            row["category_id"] = fix["category"]
            row["job_category"] = categories[fix["category"]]
            row["job_subcategory"] = categories[fix["category"]]

        required = split_ids(fix["required"]) if fix else split_ids(row["required_skill_ids"])
        nice = split_ids(fix["nice"]) if fix else split_ids(row["nice_to_have_skill_ids"])
        required = unique(required)
        nice = [skill_id for skill_id in unique(nice) if skill_id not in required]
        missing = [skill_id for skill_id in required + nice if skill_id not in skill_names]
        if missing:
            raise SystemExit(f"{job_id}: unknown skill IDs {missing}")
        if len(required) > MAX_REQUIRED:
            raise SystemExit(f"{job_id}: {len(required)} required skills (max {MAX_REQUIRED})")

        changed = fix or required != split_ids(row["required_skill_ids"]) or nice != split_ids(row["nice_to_have_skill_ids"])
        row["required_skill_ids"] = ";".join(required)
        row["mapped_required_skill_names"] = "; ".join(skill_names[s] for s in required)
        row["nice_to_have_skill_ids"] = ";".join(nice)
        row["mapped_nice_to_have_skill_names"] = "; ".join(skill_names[s] for s in nice)
        if row["source_dataset"] not in POSTING_SOURCES:
            row["required_skills_comma_separated"] = ", ".join(skill_names[s] for s in required)
            row["nice_to_have_skills_optional"] = ", ".join(skill_names[s] for s in nice)
        if changed:
            row["skill_id_mapping_status"] = "reviewed"
            row["skill_id_mapping_notes"] = REVIEW_NOTE
        row["job_text_for_matching"] = job_text(row)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--esco-dir", type=Path, required=True, help="folder with the ESCO v1.2.1 classification CSVs (skills_en.csv)")
    args = parser.parse_args()

    skill_fields, skills = read_csv(SKILLS_CSV)
    fix_skills(skills, load_esco(args.esco_dir))

    _, category_rows = read_csv(DATA / "category_reference.csv")
    categories = {row["category_id"]: row["category_name"] for row in category_rows}
    job_fields, jobs = read_csv(JOBS_CSV)
    unknown = set(JOB_FIXES) - {row["job_id"] for row in jobs}
    if unknown:
        raise SystemExit(f"JOB_FIXES names jobs that are not in reference_jobs.csv: {sorted(unknown)}")
    fix_jobs(jobs, {row["skill_id"]: row["skill_name"] for row in skills}, categories)
    promoted = mark_job_skills_reviewed(skills, jobs)
    write_csv(SKILLS_CSV, skill_fields, skills)
    write_csv(JOBS_CSV, job_fields, jobs)
    print(f"Updated {len(JOB_FIXES)} jobs' skills, {len(SEED_DESCRIPTIONS)} descriptions, "
          f"{len(SKILL_RELINKS)} ESCO links and {len(RELATED_DROP)} alias lists; "
          f"marked {promoted} imported skills used by jobs as reviewed.")


if __name__ == "__main__":
    main()

"""Synthetic Philippine resume generator for the evaluation corpus.

Why synthetic. Real resumes are personal information under the Data Privacy Act
of 2012, and the public scraped corpora carry undocumented provenance. Generated
resumes avoid both problems, and they buy two things that collected resumes
cannot:

  GROUND TRUTH FOR SKILL EXTRACTION. Because each resume is built from a known
  skill list, the expected-skills file for Objective 1 comes free. Annotating
  that by hand over 150 resumes would otherwise cost days.

  CONTROLLED ATTRIBUTES FOR THE FAIRNESS AUDIT. Region, education, experience,
  gender-coded name and school tier are set per resume, so a bias audit reduces
  to re-running retrieval with one attribute permuted.

LEAKAGE BOUNDARY. These resumes are conditioned on PSOC-informed occupation
profiles and the K13 taxonomy. They are NOT conditioned on any posting in the
job corpus. This is what separates them from the job-conditioned pseudo-resumes
used for training, and the two sets must never be mixed.

THE HONEST LIMITATION. Generated resumes are cleaner and more consistent than
real ones, which inflates extraction scores. Two defences are built in: noise is
injected deliberately (letter-spacing, Taglish headings, missing sections,
inconsistent dates, typos), and the study should hold out a small set of real
consented resumes to check that the synthetic set is not systematically easier.
Report both numbers.
"""

from __future__ import annotations

import json
import random
import re
from dataclasses import dataclass, asdict, field
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

# Names are randomly recombined given/surname pairs drawn from common Philippine
# name elements. They denote no real person and exist so the fairness audit has
# a gender signal to permute.
GIVEN_F = ["Maria","Ana","Jasmine","Rowena","Cristina","Angelica","Divina","Liezl",
           "Grace","Mercedes","Rosalie","Katrina","Jocelyn","Michelle","Rhea","Aileen"]
GIVEN_M = ["Jose","Juan","Mark","Rodel","Emmanuel","Christian","Ronaldo","Dennis",
           "Arnel","Joselito","Nolan","Ricardo","Ferdinand","Alvin","Jayson","Redentor"]
SURNAMES = ["Santos","Reyes","Cruz","Bautista","Ocampo","Garcia","Mendoza","Torres",
            "Aquino","Villanueva","Ramos","Del Rosario","Gonzales","Pascual","Bacani",
            "Fernandez","Dimaculangan","Manalo","Salvador","Tolentino"]

REGIONS = {
    "ncr":      ["Quezon City","Makati City","Pasig City","Taguig","Caloocan","Parañaque"],
    "luzon":    ["San Pablo, Laguna","Calamba, Laguna","Batangas City","Baguio City",
                 "Naga City","Angeles, Pampanga","Dagupan City"],
    "visayas":  ["Cebu City","Iloilo City","Bacolod City","Tacloban City","Dumaguete City"],
    "mindanao": ["Davao City","Cagayan de Oro","General Santos","Zamboanga City","Butuan City"],
}

SCHOOLS = {
    "state":      ["University of the Philippines {c}","Polytechnic University of the Philippines",
                   "Mindanao State University","Batangas State University","Cebu Technological University"],
    "private":    ["De La Salle {c}","San Beda University","Adamson University",
                   "University of San Carlos","Silliman University"],
    "provincial": ["{c} Colleges","{c} Institute of Technology","St. Anne College of {c}",
                   "{c} Community College"],
}

EDUCATION = {
    "highschool":  ("Senior High School Graduate", ["ABM Strand","TVL Strand","HUMSS Strand","STEM Strand"]),
    "tesda":       ("TESDA National Certificate", ["NC II","NC III"]),
    "vocational":  ("Vocational Diploma", ["2-year Technical Course"]),
    "bachelor":    ("Bachelor's Degree", ["BS {f}","BA {f}","Bachelor of Science in {f}"]),
    "postgraduate":("Master's Degree", ["MS {f}","MA {f}"]),
}

SECTION_STYLES = [
    {"skills":"SKILLS","exp":"WORK EXPERIENCE","edu":"EDUCATION","cert":"CERTIFICATIONS"},
    {"skills":"Technical Skills","exp":"Professional Experience","edu":"Educational Background","cert":"Trainings"},
    {"skills":"KEY SKILLS","exp":"EMPLOYMENT HISTORY","edu":"ACADEMIC BACKGROUND","cert":"SEMINARS ATTENDED"},
    {"skills":"Kasanayan / Skills","exp":"Karanasan sa Trabaho","edu":"Pinag-aralan","cert":"Mga Sertipiko"},
    {"skills":"Areas of Expertise","exp":"Experience","edu":"Education","cert":"Certificates"},
]

DUTY_VERBS = ["Handled","Assisted in","Managed","Prepared","Coordinated","Monitored",
              "Performed","Supported","Maintained","Processed","Supervised","Conducted"]

#: 19% of Kareerly/ESCO skill labels are themselves verb phrases ("Manage
#: supplies", "Develop tourism policies") rather than noun phrases ("Python
#: Programming", "Bookkeeping"). Prepending a generic duty verb to one of
#: these produced "Performed develop tourism policies" in 25.7% of generated
#: duty lines. This map conjugates the label's own leading verb to past tense
#: instead, so the same skill reads "Developed tourism policies."
_VERB_PAST_TENSE = {
    "analyse": "analysed", "analyze": "analyzed", "assist": "assisted",
    "apply": "applied", "perform": "performed", "adopt": "adopted",
    "undertake": "undertook", "comply": "complied", "monitor": "monitored",
    "prepare": "prepared", "support": "supported", "maintain": "maintained",
    "conduct": "conducted", "provide": "provided", "manage": "managed",
    "use": "used", "follow": "followed", "handle": "handled",
    "coordinate": "coordinated", "develop": "developed", "ensure": "ensured",
    "execute": "executed", "establish": "established", "identify": "identified",
    "implement": "implemented", "operate": "operated", "plan": "planned",
    "review": "reviewed", "supervise": "supervised", "train": "trained",
}
_VERB_HEAD = re.compile(
    r"^(" + "|".join(_VERB_PAST_TENSE) + r")\b", re.IGNORECASE
)


def _duty_line(skill_label: str, rng: random.Random) -> str:
    """One bullet, phrased correctly whether the skill is a noun or a verb phrase."""
    match = _VERB_HEAD.match(skill_label)
    if match:
        head = match.group(1).lower()
        past = _VERB_PAST_TENSE[head]
        rest = skill_label[match.end():].strip()
        body = f"{past} {rest}".strip()
        return f"- {body[0].upper()}{body[1:]} for the assigned department."
    return f"- {rng.choice(DUTY_VERBS)} {skill_label.lower()} for the assigned department."

OBJECTIVES = [
    "Seeking a position where I can apply my {skill} and grow professionally.",
    "A dedicated {role} with {yrs} years of experience in {domain}.",
    "Hardworking {role} looking for opportunities to contribute to a reputable company.",
    "{yrs} years of hands-on experience as a {role}. Willing to be trained and relocate.",
]


@dataclass
class ResumeSpec:
    """Every controlled attribute, recorded for the fairness audit."""
    resume_id: str
    name: str
    gender_signal: str          # f | m  -- the audit variable, never a claim about a person
    region: str
    city: str
    school_tier: str
    education_level: str
    years_experience: float
    k13_id: str
    occupation_group: str
    job_title: str
    skill_ids: List[str] = field(default_factory=list)
    skill_labels: List[str] = field(default_factory=list)
    noise_applied: List[str] = field(default_factory=list)
    layout_style: int = 0


def _letter_space(text: str) -> str:
    """Simulate the PDF extraction artefact the parser already handles."""
    return " ".join(text)


def _typo(text: str, rng: random.Random) -> str:
    """Swap two adjacent letters in one word, on one line only.

    The original implementation called text.split() on the whole document,
    which splits on every whitespace character including newlines, then
    rejoined with " ".join(...) -- destroying all line structure. On a
    150-resume run this collapsed 25 resumes (16.7%) to a single physical
    line, which is not a realistic degradation and would bias extraction
    metrics rather than test robustness to it. The fix confines the
    perturbation to one line so the rest of the layout survives intact.
    """
    lines = text.split("\n")
    candidates = [i for i, line in enumerate(lines) if len(line.split()) >= 4]
    if not candidates:
        return text

    line_index = rng.choice(candidates)
    words = lines[line_index].split()
    word_index = rng.randrange(len(words))
    word = words[word_index]
    if len(word) > 3:
        j = rng.randrange(1, len(word) - 1)
        words[word_index] = word[:j] + word[j + 1] + word[j] + word[j + 2:]
    lines[line_index] = " ".join(words)
    return "\n".join(lines)


class ResumeGenerator:
    def __init__(self, taxonomy, seed: int = 20260831, noise_rate: float = 0.55) -> None:
        self.tx = taxonomy
        self.rng = random.Random(seed)
        self.noise_rate = noise_rate

        # Occupation groups = taxonomy parent groups with enough skills to
        # populate a plausible profile.
        self.groups: Dict[str, List[str]] = {}
        for skill_id, skill in taxonomy.skills.items():
            if skill.parent_group_id and skill.k13_id:
                self.groups.setdefault(skill.parent_group_id, []).append(skill_id)
        self.groups = {g: s for g, s in self.groups.items() if len(s) >= 5}

    # ---- helpers ---------------------------------------------------------

    def _title_for(self, group_id: str) -> str:
        name = self.tx.group_to_subcategory.get(group_id, "").strip()
        if not name:
            return "Staff"
        head = re.split(r"[,/]| and ", name)[0].strip()
        suffix = self.rng.choice(["Assistant","Associate","Officer","Staff","Technician",
                                  "Specialist","Coordinator",""])
        return f"{head} {suffix}".strip()

    def _education_block(self, spec: ResumeSpec, field_hint: str) -> List[str]:
        label, patterns = EDUCATION[spec.education_level]
        pattern = self.rng.choice(patterns).replace("{f}", field_hint)
        school = self.rng.choice(SCHOOLS[spec.school_tier]).replace("{c}", spec.city.split(",")[0])
        year = 2026 - int(spec.years_experience) - self.rng.randint(0, 2)
        date_fmt = self.rng.choice([f"{year}", f"{year - 4} - {year}", f"Graduated {year}",
                                    f"{year - 4}–{year}"])
        return [f"{pattern}", f"{school}", f"{date_fmt}"] if label != "TESDA National Certificate" \
            else [f"{field_hint} {pattern}", f"TESDA Accredited Center, {spec.city}", f"{date_fmt}"]

    def _experience_block(self, spec: ResumeSpec) -> List[str]:
        lines: List[str] = []
        remaining = spec.years_experience
        title = spec.job_title
        seniority = ["", "Junior ", "Senior "]
        step = 0
        while remaining > 0 and step < 3:
            span = min(remaining, self.rng.choice([1, 2, 3]))
            end = 2026 - int(spec.years_experience - remaining)
            start = end - int(span)
            prefix = seniority[min(step, 2)] if step else ""
            company = self.rng.choice(["Metro","Prime","Summit","Bayan","Golden","Pacific",
                                       "Northstar","Sunrise"]) + " " + \
                      self.rng.choice(["Corporation","Inc.","Enterprises","Services","Group"])
            lines.append(f"{prefix}{title} — {company}, {spec.city}")
            lines.append(f"{start} to {end if step else 'Present'}")
            bullet_count = self.rng.randint(2, 3)
            pool = list(spec.skill_labels) if spec.skill_labels else ["daily operations"]
            self.rng.shuffle(pool)
            # More bullets than distinct skills: cycle the shuffled pool rather
            # than repeat one skill back-to-back.
            duty_skills = [pool[i % len(pool)] for i in range(bullet_count)]
            for skill in duty_skills:
                lines.append(_duty_line(skill, self.rng))
            lines.append("")
            remaining -= span
            step += 1
        if not lines:
            lines = ["On-the-Job Training — " + self.rng.choice(["Metro Services","Bayan Group"]),
                     "480 hours practicum", ""]
        return lines

    # ---- generation ------------------------------------------------------

    def generate(self, resume_id: str) -> Tuple[str, ResumeSpec]:
        rng = self.rng
        group = rng.choice(list(self.groups))
        pool = self.groups[group]
        k13 = self.tx.skills[pool[0]].k13_id

        gender = rng.choice(["f", "m"])
        name = f"{rng.choice(GIVEN_F if gender=='f' else GIVEN_M)} {rng.choice(SURNAMES)}"
        region = rng.choice(list(REGIONS))
        city = rng.choice(REGIONS[region])
        years = float(rng.choice([0, 1, 2, 2, 3, 4, 5, 6, 8, 10]))
        education = rng.choice(["highschool","tesda","vocational","bachelor","bachelor","postgraduate"]) \
            if years >= 1 else rng.choice(["highschool","tesda","vocational","bachelor"])

        chosen = rng.sample(pool, min(len(pool), rng.randint(4, 9)))
        spec = ResumeSpec(
            resume_id=resume_id, name=name, gender_signal=gender,
            region=region, city=city,
            school_tier=rng.choice(["state","private","provincial"]),
            education_level=education, years_experience=years,
            k13_id=k13, occupation_group=self.tx.group_to_subcategory.get(group, group),
            job_title=self._title_for(group),
            skill_ids=chosen,
            skill_labels=[self.tx.skills[s].label for s in chosen],
            layout_style=rng.randrange(len(SECTION_STYLES)),
        )

        style = SECTION_STYLES[spec.layout_style]
        field_hint = spec.occupation_group.split(",")[0]
        lines: List[str] = [spec.name, f"{spec.city} | 09{rng.randint(10**8, 10**9-1)} | "
                                       f"{spec.name.split()[0].lower()}.{spec.name.split()[-1].lower()}@email.com", ""]

        if rng.random() < 0.7:
            lines += [rng.choice(OBJECTIVES).format(
                skill=(spec.skill_labels[0] if spec.skill_labels else "skills").lower(),
                role=spec.job_title.lower(), yrs=int(spec.years_experience) or 1,
                domain=field_hint.lower()), ""]

        blocks = [
            (style["skills"], [", ".join(spec.skill_labels)]),
            (style["exp"], self._experience_block(spec)),
            (style["edu"], self._education_block(spec, field_hint)),
        ]
        if rng.random() < 0.45:
            blocks.append((style["cert"], [
                f"{rng.choice(['TESDA','DOLE','Red Cross','PRC'])} {rng.choice(['Certificate','Seminar','Training'])} "
                f"— {2026 - rng.randint(0,4)}"]))
        rng.shuffle(blocks)

        noise: List[str] = []
        for heading, body in blocks:
            head = heading
            if rng.random() < self.noise_rate * 0.25:
                head = _letter_space(heading); noise.append("letter_spaced_heading")
            if rng.random() < self.noise_rate * 0.20:
                noise.append("missing_heading")
            else:
                lines.append(head)
            lines += body
            lines.append("")

        text = "\n".join(lines)
        if rng.random() < self.noise_rate * 0.35:
            text = _typo(text, rng); noise.append("typo")
        if rng.random() < self.noise_rate * 0.15:
            text = re.sub(r"\n{2,}", "\n", text); noise.append("collapsed_whitespace")

        spec.noise_applied = sorted(set(noise))
        return text, spec


def build_corpus(
    taxonomy,
    count: int = 150,
    seed: int = 20260831,
    out_dir: Optional[Path] = None,
    noise_rate: float = 0.55,
) -> Dict[str, Any]:
    out_dir = Path(out_dir or Path("data/corpus/annotation"))
    out_dir.mkdir(parents=True, exist_ok=True)

    generator = ResumeGenerator(taxonomy, seed=seed, noise_rate=noise_rate)
    resumes: Dict[str, str] = {}
    specs: List[Dict[str, Any]] = []
    expected: List[Dict[str, Any]] = []

    for index in range(count):
        rid = f"SYN{index:03d}"
        text, spec = generator.generate(rid)
        resumes[rid] = text
        specs.append(asdict(spec))
        expected.append({"resume_id": rid, "expected_skill_ids": spec.skill_ids,
                         "expected_skill_labels": spec.skill_labels})

    (out_dir / "resumes_synthetic.json").write_text(json.dumps(resumes, indent=1), encoding="utf-8")
    (out_dir / "resume_manifest.json").write_text(json.dumps(specs, indent=1), encoding="utf-8")
    (out_dir / "expected_skills.jsonl").write_text(
        "\n".join(json.dumps(e) for e in expected), encoding="utf-8")

    import collections
    return {
        "resumes": len(resumes),
        "median_chars": sorted(len(v) for v in resumes.values())[len(resumes)//2],
        "by_region": dict(collections.Counter(s["region"] for s in specs)),
        "by_gender_signal": dict(collections.Counter(s["gender_signal"] for s in specs)),
        "by_education": dict(collections.Counter(s["education_level"] for s in specs)),
        "by_k13": dict(collections.Counter(s["k13_id"] for s in specs)),
        "noise_free": sum(1 for s in specs if not s["noise_applied"]),
        "expected_skills_total": sum(len(e["expected_skill_ids"]) for e in expected),
    }

"""Turn a candidate content file into the visible blocks of a resume.

Each layout variant fixes the section order, the section headings, how dates,
entries and skills are written. The PDF renderer draws these blocks and the
similarity checker reads their text, so both always see the same resume.

A block is (kind, text): name, headline, contact, heading, entry, meta, para,
bullet, line.
"""
from __future__ import annotations

import re

MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September",
          "October", "November", "December"]

TYPE_LABELS = {"part-time": "Part-time", "internship": "Internship", "freelance": "Freelance",
               "contract": "Contract", "volunteer": "Volunteer"}

LAYOUTS = {
    "classic_summary_first": {
        "order": ["summary", "skills", "experience", "education", "projects", "certifications", "languages"],
        "titles": {"summary": "Professional Summary", "skills": "Skills", "experience": "Work Experience",
                   "education": "Education", "projects": "Projects", "certifications": "Certifications",
                   "languages": "Languages"},
        "date": "mon", "entry": "title_dash_org", "skills": "grouped_lines", "contact": "one_line",
    },
    "skills_first": {
        "order": ["skills", "summary", "experience", "projects", "education", "certifications", "languages"],
        "titles": {"skills": "Key Skills", "summary": "Profile", "experience": "Experience",
                   "projects": "Projects", "education": "Education",
                   "certifications": "Certifications and Training", "languages": "Languages"},
        "date": "month", "entry": "title_pipe_org", "skills": "bullets", "contact": "stacked",
    },
    "education_first_graduate": {
        "order": ["education", "summary", "projects", "skills", "experience", "certifications", "languages"],
        "titles": {"education": "Education", "summary": "Career Objective",
                   "projects": "Academic and Personal Projects", "skills": "Technical Skills",
                   "experience": "Internship and Work Experience", "certifications": "Trainings and Seminars",
                   "languages": "Languages"},
        "date": "month", "entry": "title_dash_org", "skills": "comma", "contact": "stacked",
    },
    "project_heavy": {
        "order": ["summary", "projects", "skills", "experience", "education", "certifications"],
        "titles": {"summary": "Summary", "projects": "Selected Projects", "skills": "Tools and Skills",
                   "experience": "Experience", "education": "Education", "certifications": "Training"},
        "date": "mon", "entry": "title_at_org", "skills": "grouped_lines", "contact": "one_line",
    },
    "certification_focus": {
        "order": ["summary", "certifications", "skills", "experience", "education", "projects", "languages"],
        "titles": {"summary": "Professional Summary", "certifications": "Licenses and Certifications",
                   "skills": "Skills", "experience": "Work History", "education": "Education",
                   "projects": "Projects", "languages": "Languages"},
        "date": "mon", "entry": "title_pipe_org", "skills": "bullets", "contact": "one_line",
    },
    "compact_one_page": {
        "order": ["summary", "skills", "experience", "education", "certifications", "projects"],
        "titles": {"summary": "SUMMARY", "skills": "SKILLS", "experience": "EXPERIENCE",
                   "education": "EDUCATION", "certifications": "CERTIFICATIONS", "projects": "PROJECTS"},
        "date": "numeric", "entry": "one_line", "skills": "dots", "contact": "one_line",
    },
    "experienced_professional": {
        "order": ["summary", "highlights", "skills", "experience", "education", "certifications", "languages"],
        "titles": {"summary": "Professional Profile", "highlights": "Selected Achievements",
                   "skills": "Core Competencies", "experience": "Professional Experience",
                   "education": "Education", "certifications": "Certifications", "languages": "Languages"},
        "date": "month", "entry": "title_dash_org", "skills": "bullets", "contact": "stacked",
    },
    "experience_first": {
        "order": ["experience", "summary", "skills", "education", "certifications", "projects", "languages"],
        "titles": {"experience": "Employment History", "summary": "Summary of Qualifications",
                   "skills": "Skills", "education": "Education", "certifications": "Certifications",
                   "projects": "Projects", "languages": "Languages"},
        "date": "mon", "entry": "org_then_title", "skills": "comma", "contact": "one_line",
    },
    "bullet_heavy": {
        "order": ["summary", "skills", "experience", "education", "certifications", "projects"],
        "titles": {"summary": "PROFILE", "skills": "CORE SKILLS", "experience": "WORK EXPERIENCE",
                   "education": "EDUCATION", "certifications": "CERTIFICATIONS", "projects": "PROJECTS"},
        "date": "numeric", "entry": "title_pipe_org", "skills": "bullets", "contact": "stacked",
    },
    "mixed_paragraph": {
        "order": ["summary", "experience", "skills", "projects", "education", "certifications", "languages"],
        "titles": {"summary": "About", "experience": "Career History", "skills": "Skills and Tools",
                   "projects": "Projects", "education": "Education",
                   "certifications": "Courses and Certifications", "languages": "Languages"},
        "date": "month", "entry": "title_at_org", "skills": "grouped_lines", "contact": "one_line",
    },
}


def fmt_date(value: str, style: str) -> str:
    if not value or value == "Present":
        return "Present"
    parts = value.split("-")
    year = parts[0]
    if len(parts) == 1:
        return year
    month = int(parts[1])
    if style == "numeric":
        return f"{month:02d}/{year}"
    if style == "month":
        return f"{MONTHS[month - 1]} {year}"
    return f"{MONTHS[month - 1][:3]} {year}"


def date_range(item: dict, style: str) -> str:
    start = fmt_date(item.get("start", ""), style)
    end = fmt_date(item.get("end", ""), style)
    return f"{start} – {end}" if start else end


def _skills(content: dict, style: str) -> list[tuple[str, str]]:
    groups = content.get("skill_groups")
    flat = content.get("skills") or [s for g in groups or [] for s in g["items"]]
    if style == "grouped_lines" and groups:
        return [("line", f"{g['label']}: {', '.join(g['items'])}") for g in groups]
    if style == "bullets":
        if groups:
            return [("bullet", f"{g['label']}: {', '.join(g['items'])}") for g in groups]
        return [("bullet", s) for s in flat]
    if style == "dots":
        return [("line", " · ".join(flat))]
    return [("line", ", ".join(flat))]


def _entry(item: dict, layout: dict, org_key: str) -> list[tuple[str, str]]:
    title, org = item["title"], item.get(org_key, "")
    kind = item.get("type", "")
    label = f" ({TYPE_LABELS[kind]})" if kind in TYPE_LABELS else ""
    if kind == "internship" and re.search(r"\b(intern|OJT|immersion|trainee)", title, re.IGNORECASE):
        label = ""
    when = date_range(item, layout["date"])
    where = item.get("location", "")
    style = layout["entry"]
    if style == "title_dash_org":
        return [("entry", f"{title}{label} — {org}"), ("meta", " | ".join(x for x in (where, when) if x))]
    if style == "title_pipe_org":
        return [("entry", f"{title}{label} | {org}"), ("meta", " · ".join(x for x in (when, where) if x))]
    if style == "title_at_org":
        return [("entry", f"{title}{label}, {org}"), ("meta", " | ".join(x for x in (where, when) if x))]
    if style == "org_then_title":
        return [("entry", " — ".join(x for x in (org, where) if x)), ("meta", f"{title}{label}, {when}")]
    return [("entry", " | ".join(x for x in (f"{title}{label}", org, where, when) if x))]


def _section(name: str, content: dict, layout: dict) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    if name == "summary":
        out.append(("para", content["summary"]))
    elif name == "skills":
        out += _skills(content, layout["skills"])
    elif name == "highlights":
        out += [("bullet", h) for h in content.get("highlights", [])]
    elif name == "experience":
        for item in content.get("experience", []):
            out += _entry(item, layout, "employer")
            if item.get("paragraph"):
                out.append(("para", item["paragraph"]))
            out += [("bullet", b) for b in item.get("bullets", [])]
    elif name == "education":
        for item in content.get("education", []):
            out += _entry({**item, "title": item["credential"]}, layout, "school")
            out += [("bullet", n) for n in item.get("notes", [])]
    elif name == "projects":
        for item in content.get("projects", []):
            head = item["name"] + (f" ({item['context']})" if item.get("context") else "")
            out.append(("entry", head))
            if item.get("description"):
                out.append(("para", item["description"]))
            out += [("bullet", b) for b in item.get("bullets", [])]
    elif name == "certifications":
        for item in content.get("certifications", []):
            parts = [item["name"], item.get("issuer", ""), fmt_date(item.get("date", ""), layout["date"])]
            out.append(("bullet", " — ".join(p for p in parts if p)))
    elif name == "languages":
        if content.get("languages"):
            out.append(("line", ", ".join(content["languages"])))
    return out


def blocks(content: dict, variant: str) -> list[tuple[str, str]]:
    layout = LAYOUTS[variant]
    out = [("name", content["full_name"])]
    if content.get("headline"):
        out.append(("headline", content["headline"]))
    contact = [content["location"], content["email"], content["phone"]]
    if layout["contact"] == "stacked":
        out += [("contact", c) for c in contact]
    else:
        out.append(("contact", " | ".join(contact)))
    for name in layout["order"]:
        section = _section(name, content, layout)
        if section:
            out.append(("heading", layout["titles"][name]))
            out += section
    return out


def plain_text(content: dict, variant: str) -> str:
    lines = []
    for kind, text in blocks(content, variant):
        if kind == "heading":
            lines += ["", text.upper() if text.isupper() else text, "-" * len(text)]
        elif kind == "bullet":
            lines.append(f"  • {text}")
        else:
            lines.append(text)
    return "\n".join(lines).strip() + "\n"

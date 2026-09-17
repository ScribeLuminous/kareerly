"""Collect selected public postings into an isolated training-preparation batch.

Run from backend: python -m pipeline.curated_training --plan
pipeline/plans/ph_taxonomy_selected.json --output data/corpus/training/curated_ph/ph-taxonomy-2026-09-09

No relevance judgements or synthetic candidates are generated. Evidence links
are proposed skill annotations, never independently judged training labels.
Existing raw, labelled, split and model files are not rewritten.
"""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
from collections import Counter
from dataclasses import asdict
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.request import Request, urlopen

from .normalize import clean_multiline, normalize_record


class Page(HTMLParser):
    """Read visible text, structured job data and location metadata only."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.meta = {}
        self.scripts = []
        self.script = None
        self.hidden = 0

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag in ("script", "style", "noscript"):
            self.hidden += 1
            if tag == "script" and "ld+json" in attrs.get("type", ""):
                self.script = []
        if tag == "meta":
            key = attrs.get("name") or attrs.get("property") or attrs.get("itemprop")
            if key:
                self.meta[key] = attrs.get("content", attrs.get("value", ""))
        if tag in ("p", "li", "br", "div", "h1", "h2", "h3", "section"):
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in ("script", "style", "noscript"):
            if tag == "script" and self.script is not None:
                self.scripts.append("".join(self.script))
                self.script = None
            self.hidden = max(0, self.hidden - 1)
        if tag in ("p", "li", "div", "h1", "h2", "h3", "section"):
            self.parts.append("\n")

    def handle_data(self, data):
        if self.script is not None:
            self.script.append(data)
        elif not self.hidden:
            self.parts.append(data)

    @property
    def text(self):
        return "\n".join(" ".join(s.split()) for s in "".join(self.parts).splitlines() if s.strip())


def job_nodes(value):
    if isinstance(value, list):
        for item in value:
            yield from job_nodes(item)
    elif isinstance(value, dict):
        if value.get("@type") == "JobPosting" or "JobPosting" in (value.get("@type") or []):
            yield value
        if "@graph" in value:
            yield from job_nodes(value["@graph"])


def between(text, start, end):
    if start not in text or end not in text.split(start, 1)[1]:
        raise ValueError(f"Page structure changed: missing {start!r} / {end!r}")
    return text.split(start, 1)[1].split(end, 1)[0].strip()


def location_text(value):
    if isinstance(value, list):
        return " / ".join(location_text(v) for v in value)
    if isinstance(value, dict):
        address = value.get("address", value)
        country = address.get("addressCountry", "")
        if isinstance(country, dict):
            country = country.get("name", "")
        if str(country).upper() in ("PH", "PHL"):
            country = "Philippines"
        return ", ".join(str(x) for x in [address.get("addressLocality"), address.get("addressRegion"), country] if x)
    return str(value or "")


def extract(entry, response):
    source = entry["source"]
    if source == "smartrecruiters_html" and response.lstrip().startswith("{"):
        # SmartRecruiters negotiates a structured response for Accept: application/json.
        d = json.loads(response)
        if d.get("isApplyAvailable") is False:
            raise ValueError("SmartRecruiters posting is no longer accepting applications")
        sections = d["content"]["sections"]
        body = "\n".join(sections[k].get("title", "") + "\n" + sections[k].get("text", "")
                         for k in ("jobDescription", "qualifications", "additionalInformation") if k in sections)
        return d["jobTitle"].strip(), d["jobAdLocation"], clean_multiline(body), d.get("postedDate", "")
    if source == "greenhouse":
        d = json.loads(response)
        return d["title"], d["location"]["name"], clean_multiline(d["content"]), d.get("updated_at", "")
    if source == "lever":
        d = json.loads(response)
        body = [d.get("descriptionPlain") or d.get("description", "")]
        body += [str(x.get("text", "")) + "\n" + str(x.get("content", "")) for x in d.get("lists", [])]
        body.append(d.get("additionalPlain") or d.get("additional", ""))
        return d["text"], d["categories"]["location"], clean_multiline("\n".join(body)), ""
    page = Page()
    page.feed(response)
    if source == "employer_jsonld":
        nodes = [node for s in page.scripts for node in job_nodes(json.loads(s))]
        matches = [n for n in nodes if n.get("title", "").casefold() == entry["expected_title"].casefold()]
        if len(matches) != 1:
            raise ValueError("Expected exactly one matching JobPosting JSON-LD node")
        d = matches[0]
        expiry = d.get("validThrough")
        if expiry and datetime.fromisoformat(expiry.replace("Z", "+00:00")).date() < datetime.now(timezone.utc).date():
            raise ValueError(f"Posting expired on {expiry}")
        return d["title"], location_text(d.get("jobLocation", {})), clean_multiline(d["description"]), d.get("datePosted", "")
    if source == "smartrecruiters_html":
        title = page.meta.get("og:title", "").strip()
        location = page.meta.get("twitter:data1", "")
        description = between(page.text, "Job Description", "Job Location")
        return title, location, description, ""
    if source == "employer_html":
        location = between(page.text, "Full Time", "Apply for this Position")
        description = between(page.text, "Job Description", "Other Career Opportunities")
        return entry["expected_title"], location, description, ""
    raise ValueError(f"Unsupported source: {source}")


def skill_evidence(entry, description, taxonomy):
    annotations = []
    for proposed in entry["skills"]:
        skill = taxonomy.skills[proposed["id"]]
        # Flexible whitespace, but never invent evidence when the passage changed.
        pattern = r"\s+".join(re.escape(w) for w in proposed["evidence"].split())
        match = re.search(pattern, description, re.IGNORECASE)
        annotations.append({
            "skill_id": skill.skill_id, "preferred_label": skill.label,
            "k13_id": skill.k13_id, "concept_type": skill.concept_type,
            "annotation_origin": "assistant_proposed_mapping",
            "review_status": "pending_human_review",
            "evidence_found": bool(match),
            "evidence_text": match.group(0) if match else None,
            "start": match.start() if match else None,
            "end": match.end() if match else None,
            "requirement_level": "unjudged",
        })
    return annotations


def collect(plan_path, output, replay=None):
    from models.taxonomy import load

    plan = json.loads(Path(plan_path).read_text(encoding="utf-8"))
    replay = Path(replay) if replay else None
    prior = ({r["source_id"]: r for r in
              (json.loads(line) for line in (replay / "collection_log.jsonl").read_text().splitlines())}
             if replay else {})
    taxonomy = load(include_extensions=True)
    assert {"K12", "K13"}.issubset(taxonomy.categories)
    assert {"LEX-005", "LEX-021"}.issubset(taxonomy.skills)
    for entry in plan["postings"]:
        for skill in entry["skills"]:
            if skill["id"] not in taxonomy.skills:
                raise ValueError(f"Unknown taxonomy ID: {skill['id']}")
    output = Path(output)
    # Immutable batch: a rerun must select a new output directory.
    output.mkdir(parents=True, exist_ok=False)
    snapshots = output / "snapshots"
    snapshots.mkdir()
    (output / "collection_plan.json").write_text(json.dumps(plan, indent=2), encoding="utf-8")
    jobs, outcomes, evidence = [], [], []
    seen = set()
    for entry in plan["postings"]:
        url = entry.get("fetch_url", entry["url"])
        outcome = {"source_id": entry["source_id"], "source_url": entry["url"], "fetch_url": url}
        fetched_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
        outcome["fetched_at"] = fetched_at
        try:
            if "jooble" in url.lower():
                raise ValueError("Jooble is excluded from this collection")
            if replay:
                old = prior.get(entry["source_id"], {})
                if not old.get("snapshot_path"):
                    raise ValueError(old.get("error", "No snapshot available for offline replay"))
                data = (replay / old["snapshot_path"]).read_bytes()
                if hashlib.sha256(data).hexdigest() != old["snapshot_sha256"]:
                    raise ValueError("Snapshot hash mismatch")
                fetched_at = old["fetched_at"]
                outcome.update(fetched_at=fetched_at, http_status=old["http_status"],
                               final_url=old["final_url"], replayed_from=str(replay))
            else:
                request = Request(url, headers={"User-Agent": "KareerlyResearch/1.0", "Accept": "application/json,text/html"})
                with urlopen(request, timeout=35) as response:
                    data = response.read()
                    outcome.update(http_status=response.status, final_url=response.url)
            digest = hashlib.sha256(data).hexdigest()
            path = snapshots / (entry["source_id"] + ".txt")
            path.write_bytes(data)
            outcome.update(snapshot_sha256=digest, snapshot_path=str(path.relative_to(output)))
            title, location, description, posted = extract(entry, data.decode("utf-8"))
            if entry["expected_title"].casefold() not in title.casefold():
                raise ValueError(f"Unexpected title: {title}")
            if entry["location_marker"].casefold() not in location.casefold():
                raise ValueError(f"Philippine location needs verification: {location}")
            raw = {
                "source": entry["source"], "source_id": entry["source_id"],
                "source_url": entry["url"], "fetched_at": fetched_at,
                "access_basis": "public employer posting; project-owner authorized research collection",
                "licence": "Employer/ATS content; training and redistribution terms not independently verified",
                "payload": {"title": title, "company": entry["company"], "location": location,
                            "description": description, "description_is_snippet": False, "posted": posted},
            }
            job = asdict(normalize_record(raw))
            if job["fingerprint"] in seen:
                raise ValueError("Duplicate title/company/location in selected batch")
            seen.add(job["fingerprint"])
            # Normalization may change whitespace; offsets must refer to the
            # canonical text actually persisted in jobs.jsonl.
            annotations = skill_evidence(entry, job["description"], taxonomy)
            job.update(
                batch_id=plan["batch_id"], dataset_role="training_candidate",
                k13_categories=entry["categories"], taxonomy_skill_candidates=annotations,
                human_relevance_labels=[], supervised_training_ready=False,
                training_status="pending_relevance_labels_and_source_terms_review",
                split="unassigned", source_terms_status="unverified",
                requires_description_review=bool(entry.get("limited_requirements")),
                snapshot_sha256=digest, snapshot_path=outcome["snapshot_path"],
            )
            if entry.get("limited_requirements"):
                job.update(corpus_tier="context", exclusion_reason="Brief employer description; no qualifications supplied")
            jobs.append(job)
            for a in annotations:
                evidence.append({"job_id": job["job_id"], "source_url": job["source_url"], **a})
            outcome.update(status="collected", job_id=job["job_id"], corpus_tier=job["corpus_tier"], description_chars=job["description_chars"])
            print(f"Collected {title}: {job['corpus_tier']}, {len(description)} characters", flush=True)
        except Exception as exc:
            outcome.update(status="unavailable_or_needs_review", error=str(exc))
            print(f"Unavailable {entry['expected_title']}: {exc}", flush=True)
        outcomes.append(outcome)
    for name, records in (("jobs.jsonl", jobs), ("skill_review.jsonl", evidence), ("collection_log.jsonl", outcomes)):
        (output / name).write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in records), encoding="utf-8")
    summary = {
        "batch_id": plan["batch_id"], "selected": len(plan["postings"]), "collected": len(jobs),
        "unavailable_or_needs_review": len(outcomes)-len(jobs),
        "content_tiers": dict(Counter(j["corpus_tier"] for j in jobs)),
        "category_posting_counts": dict(Counter(k for j in jobs for k in j["k13_categories"])),
        "proposed_skill_links": len(evidence), "evidence_found": sum(a["evidence_found"] for a in evidence),
        "human_relevance_labels": 0, "supervised_training_ready": False,
        "taxonomy_scope": plan["taxonomy_scope"],
    }
    (output / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))
    return summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--replay", type=Path, help="Reprocess an existing batch offline, verifying snapshot hashes")
    args = parser.parse_args()
    collect(args.plan, args.output, args.replay)

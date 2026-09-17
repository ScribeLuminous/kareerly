"""Shared configuration for the Kareerly corpus pipeline.

The pipeline is deliberately split into four stages that each write to disk:

    collect   -> data/corpus/raw/<source>/*.jsonl      (immutable, provenance-stamped)
    normalize -> data/corpus/normalized/jobs.jsonl     (canonical schema)
    label     -> data/corpus/labelled/jobs.jsonl       (+ ESCO skill ids)
    report    -> data/corpus/reports/*.md              (corpus quality)

Every stage is re-runnable and never mutates the stage before it, so a bad
labelling run can be thrown away without re-harvesting.
"""

from __future__ import annotations

import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = BACKEND_DIR / "data"
CORPUS_DIR = DATA_DIR / "corpus"

RAW_DIR = CORPUS_DIR / "raw"
NORMALIZED_DIR = CORPUS_DIR / "normalized"
LABELLED_DIR = CORPUS_DIR / "labelled"
REPORTS_DIR = CORPUS_DIR / "reports"
REFERENCE_DIR = CORPUS_DIR / "reference"

for _directory in (RAW_DIR, NORMALIZED_DIR, LABELLED_DIR, REPORTS_DIR, REFERENCE_DIR):
    _directory.mkdir(parents=True, exist_ok=True)

# ESCO bulk download, unzipped into data/corpus/reference/esco/
ESCO_DIR = REFERENCE_DIR / "esco"
ESCO_SKILLS_CSV = ESCO_DIR / "skills_en.csv"
ESCO_OCCUPATIONS_CSV = ESCO_DIR / "occupations_en.csv"
ESCO_RELATIONS_CSV = ESCO_DIR / "occupationSkillRelations_en.csv"

TABIYA_NER_MODEL = os.getenv("KAREERLY_NER_MODEL", "tabiya/roberta-base-job-ner")
TABIYA_EMBED_MODEL = os.getenv("KAREERLY_EMBED_MODEL", "all-MiniLM-L6-v2")

JOOBLE_API_KEY = os.getenv("JOOBLE_API_KEY", "").strip()
JOOBLE_HOST = os.getenv("JOOBLE_HOST", "ph.jooble.org").strip()

# JSearch (RapidAPI). Monthly quota tied to your plan, not a lifetime cap.
JSEARCH_API_KEY = os.getenv("JSEARCH_API_KEY", "").strip()
JSEARCH_HOST = os.getenv("JSEARCH_HOST", "jsearch.p.rapidapi.com").strip()

# A posting shorter than this has no usable requirement text. Keep the record
# (it is still evidence about the source) but exclude it from the match corpus.
MIN_DESCRIPTION_CHARS = 200

PH_REGIONS = {
    "ncr": ["metro manila", "manila", "quezon city", "makati", "taguig", "pasig",
            "mandaluyong", "paranaque", "parañaque", "caloocan", "pasay", "muntinlupa",
            "marikina", "las pinas", "las piñas", "valenzuela", "bgc", "ortigas", "ncr"],
    "luzon": ["laguna", "cavite", "batangas", "rizal", "bulacan", "pampanga", "bataan",
              "zambales", "tarlac", "nueva ecija", "pangasinan", "la union", "baguio",
              "benguet", "ilocos", "cagayan", "isabela", "quezon province", "bicol",
              "albay", "camarines", "legazpi", "naga", "calamba", "santa rosa",
              "san pablo", "lipa", "antipolo", "clark", "subic"],
    "visayas": ["cebu", "mandaue", "lapu-lapu", "iloilo", "bacolod", "negros", "leyte",
                "tacloban", "bohol", "tagbilaran", "dumaguete", "aklan", "kalibo",
                "boracay", "samar", "capiz", "roxas"],
    "mindanao": ["davao", "cagayan de oro", "zamboanga", "general santos", "gensan",
                 "butuan", "iligan", "cotabato", "koronadal", "surigao", "bukidnon",
                 "misamis", "lanao", "sulu", "tawi-tawi", "basilan", "agusan"],
}

#!/usr/bin/env python3
"""
Kareerly Colab import readiness checker.

Checks file presence and module imports only.
Does not modify model logic or scoring behavior.
"""

from __future__ import annotations

import argparse
import importlib
from importlib.util import find_spec
import sys
from pathlib import Path


REQUIRED_BACKEND_FILES = [
    "backend/app/__init__.py",
    "backend/app/resume_parser.py",
    "backend/app/skill_extractor.py",
    "backend/app/resume_analyzer.py",
    "backend/app/job_matcher.py",
    "backend/app/learning_recommender.py",
    "backend/app/main.py",
    "backend/main.py",
    "backend/app/schemas.py",
]

REQUIRED_DATA_FILES = [
    "backend/data/skills_reference.csv",
    "backend/data/learning_resources.csv",
    "backend/models/job_index.csv",
]

OPTIONAL_DATA_FILES = [
    "backend/data/reference_jobs.csv",
]

REQUIRED_MODEL_FILES = [
    "backend/models/tfidf_vectorizer.joblib",
    "backend/models/job_tfidf_matrix.npz",
]

OPTIONAL_MODEL_FILES = [
    "backend/models/model_metadata.json",
]

EVALUATION_TARGETS = [
    "backend/evaluation/sample_resumes",
    "backend/evaluation/expected_skills.csv",
    "backend/evaluation/expected_job_matches.csv",
    "backend/evaluation/expected_skill_gaps.csv",
    "backend/evaluation/expected_course_recommendations.csv",
    "backend/evaluation/file_validation_cases.csv",
    "backend/evaluation/outputs",
]

REQUIRED_EVAL_PACKAGES = [
    "pandas",
    "numpy",
    "sklearn",
    "scipy",
    "joblib",
    "pypdf",
    "docx",
]

SERVER_ONLY_PACKAGES = [
    "fastapi",
    "uvicorn",
    "multipart",
    "pydantic",
]

MODULE_IMPORT_TESTS = [
    "app.resume_parser",
    "app.skill_extractor",
    "app.resume_analyzer",
    "app.learning_recommender",
    "app.job_matcher",
]


def check_paths(project_dir: Path, rel_paths: list[str]) -> tuple[list[str], list[str]]:
    found: list[str] = []
    missing: list[str] = []

    for rel_path in rel_paths:
        path = project_dir / rel_path
        if path.exists():
            found.append(rel_path)
        else:
            missing.append(rel_path)

    return found, missing


def check_packages(packages: list[str]) -> tuple[list[str], list[str]]:
    installed: list[str] = []
    missing: list[str] = []

    for package in packages:
        if find_spec(package) is not None:
            installed.append(package)
        else:
            missing.append(package)

    return installed, missing


def print_section(title: str) -> None:
    print(f"\n=== {title} ===")


def main() -> int:
    parser = argparse.ArgumentParser(description="Kareerly Colab import checklist verifier")
    parser.add_argument(
        "--project-dir",
        default=None,
        help="Project root path (e.g., /content/drive/MyDrive/kareerly_system).",
    )
    args = parser.parse_args()

    if args.project_dir:
        project_dir = Path(args.project_dir).expanduser().resolve()
    else:
        project_dir = Path(__file__).resolve().parents[2]

    backend_dir = project_dir / "backend"
    eval_dir = backend_dir / "evaluation"
    sample_resumes_dir = eval_dir / "sample_resumes"
    outputs_dir = eval_dir / "outputs"

    print("Kareerly Colab Import Test")
    print("Project dir:", project_dir)
    print("Backend dir:", backend_dir)

    if str(backend_dir) not in sys.path:
        sys.path.insert(0, str(backend_dir))

    print_section("Required Backend Files")
    _, missing_backend = check_paths(project_dir, REQUIRED_BACKEND_FILES)
    if missing_backend:
        for item in missing_backend:
            print(f"❌ Missing: {item}")
    else:
        print("✅ All required backend Python files found.")

    print_section("Required Data Files")
    _, missing_data = check_paths(project_dir, REQUIRED_DATA_FILES)
    if missing_data:
        for item in missing_data:
            print(f"❌ Missing: {item}")
    else:
        print("✅ Required data files found.")

    print_section("Optional Data Files")
    _, missing_optional_data = check_paths(project_dir, OPTIONAL_DATA_FILES)
    if missing_optional_data:
        for item in missing_optional_data:
            print(f"⚠️ Optional missing: {item}")
    else:
        print("✅ Optional data files present.")

    print_section("Required Model Files")
    _, missing_models = check_paths(project_dir, REQUIRED_MODEL_FILES)
    if missing_models:
        for item in missing_models:
            print(f"❌ Missing: {item}")
    else:
        print("✅ Required model artifacts found.")

    print_section("Optional Model Files")
    _, missing_optional_models = check_paths(project_dir, OPTIONAL_MODEL_FILES)
    if missing_optional_models:
        for item in missing_optional_models:
            print(f"⚠️ Optional missing: {item}")
    else:
        print("✅ Optional model artifacts present.")

    print_section("Evaluation Files/Folders")
    for rel_path in EVALUATION_TARGETS:
        path = project_dir / rel_path
        if path.exists():
            print(f"✅ Found: {rel_path}")
        else:
            print(f"⚠️ Missing: {rel_path}")

    if not outputs_dir.exists():
        outputs_dir.mkdir(parents=True, exist_ok=True)
        print("✅ Created missing folder: backend/evaluation/outputs")

    if sample_resumes_dir.exists():
        print("✅ sample_resumes folder is present.")
    else:
        print("⚠️ sample_resumes folder is missing.")

    print_section("Package Checks (Evaluation)")
    _, missing_eval_packages = check_packages(REQUIRED_EVAL_PACKAGES)
    if missing_eval_packages:
        print("❌ Missing required evaluation packages:", ", ".join(missing_eval_packages))
    else:
        print("✅ All required evaluation packages are installed.")

    print_section("Package Checks (FastAPI Server Only)")
    _, missing_server_packages = check_packages(SERVER_ONLY_PACKAGES)
    if missing_server_packages:
        print("⚠️ Missing server-only packages:", ", ".join(missing_server_packages))
    else:
        print("✅ All server-only packages are installed.")

    print_section("Module Import Tests")
    import_failures: list[str] = []
    for module_name in MODULE_IMPORT_TESTS:
        try:
            importlib.import_module(module_name)
            print(f"✅ Imported: {module_name}")
        except Exception as exc:
            import_failures.append(module_name)
            print(f"❌ Import failed: {module_name} -> {exc}")

    hard_failures = bool(missing_backend or missing_data or missing_models or import_failures)

    print_section("Summary")
    if hard_failures:
        print("❌ Import readiness check failed. Resolve required missing items above.")
        return 1

    print("✅ Import readiness check passed for baseline Colab evaluation.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

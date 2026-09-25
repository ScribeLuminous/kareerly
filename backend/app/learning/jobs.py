"""Scheduled learning jobs.

    python -m backend.app.learning.jobs run-all            # what the daily schedule runs
    python -m backend.app.learning.jobs train-ranker [--dry-run]
    python -m backend.app.learning.jobs discover-skills [--dry-run]
    python -m backend.app.learning.jobs status
    python -m backend.app.learning.jobs rollback [--to VERSION]

Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Without them it prints a
notice and exits 0, so an unconfigured schedule is visible but not failing.
Uses only numpy, pandas and scikit-learn: the bi-encoder is never loaded.
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path
from typing import Any, Dict

from dotenv import load_dotenv

from . import ranking_training, skill_discovery
from .supabase_client import SupabaseError, SupabaseRest

load_dotenv(Path(__file__).resolve().parents[2] / ".env")


def run_all(client: SupabaseRest, *, trigger: str = "scheduled", dry_run: bool = False) -> Dict[str, Any]:
    """Ranking and skill discovery are independent; one failing does not stop the other."""
    report: Dict[str, Any] = {}
    try:
        report["ranking"] = ranking_training.run_training(client, trigger=trigger, dry_run=dry_run)
    except Exception as exc:  # noqa: BLE001
        report["ranking"] = {"outcome": "failed", "reason": str(exc)}
    try:
        report["skills"] = skill_discovery.run_discovery(client, dry_run=dry_run)
    except Exception as exc:  # noqa: BLE001
        report["skills"] = {"outcome": "failed", "reason": str(exc)}
    return report


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["run-all", "train-ranker", "discover-skills", "status", "rollback"])
    parser.add_argument("--dry-run", action="store_true", help="compute and report, write nothing")
    parser.add_argument("--to", dest="target", help="rollback: version to reactivate (default: baseline)")
    parser.add_argument("--trigger", default="scheduled")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

    try:
        client = SupabaseRest.service_role()
    except SupabaseError as exc:
        print(json.dumps({"skipped": True, "reason": str(exc)}))
        return 0

    try:
        if args.command == "run-all":
            report = run_all(client, trigger=args.trigger, dry_run=args.dry_run)
        elif args.command == "train-ranker":
            report = ranking_training.run_training(client, trigger=args.trigger, dry_run=args.dry_run)
        elif args.command == "discover-skills":
            report = skill_discovery.run_discovery(client, dry_run=args.dry_run)
        elif args.command == "status":
            report = ranking_training.status(client)
        else:
            report = ranking_training.rollback(client, target_version=args.target, actor="cli")
    except (SupabaseError, ValueError) as exc:
        print(json.dumps({"error": str(exc)}))
        return 1
    print(json.dumps(report, indent=2, default=str))
    failed = [name for name, part in report.items() if isinstance(part, dict) and part.get("outcome") == "failed"] \
        if args.command == "run-all" else ([args.command] if report.get("outcome") == "failed" else [])
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

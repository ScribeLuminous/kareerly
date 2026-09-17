"""Kareerly corpus pipeline CLI.

    python -m pipeline.cli esco-check
    python -m pipeline.cli collect --source jsearch --plan pipeline/plans/ph_jsearch_k13.json
    python -m pipeline.cli collect --source tabular --path some_export.csv --licence "CC BY 4.0"
    python -m pipeline.cli normalize
    python -m pipeline.cli label --limit 50
    python -m pipeline.cli report
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, List

from .config import LABELLED_DIR, NORMALIZED_DIR, RAW_DIR, REPORTS_DIR
from .sources import available_sources, get_source


def cmd_esco_check(args: argparse.Namespace) -> int:
    from . import esco

    report = esco.status()
    if not report.get("ready"):
        print("ESCO reference NOT ready\n")
        print(report.get("error", "unknown error"))
        return 1

    print("ESCO reference ready\n")
    for key in ("skills", "occupations", "occupations_with_relations",
                "essential_relations", "optional_relations", "labels_indexed"):
        print(f"  {key:28} {report[key]:,}")

    ratio = report["essential_relations"] / max(report["optional_relations"], 1)
    print(f"\n  essential:optional ratio     {ratio:.2f}")
    print("\n  relationType gives you omega_r directly — no heuristic needed.")
    return 0


def cmd_collect(args: argparse.Namespace) -> int:
    if args.source == "jooble":
        print("Jooble collection is deprecated and excluded from the research corpus.")
        return 1
    kwargs: Dict[str, Any] = {"tos_acknowledged": args.i_have_read_the_terms}
    if args.source == "jsearch":
        kwargs["request_budget"] = args.request_budget
        if args.request_budget < 1:
            print("request-budget must be positive")
            return 1
    if args.path:
        kwargs["path"] = args.path
    if args.hf_dataset:
        kwargs["hf_dataset"] = args.hf_dataset
    if args.licence:
        kwargs["licence"] = args.licence

    try:
        source = get_source(args.source, **kwargs)
    except (PermissionError, ValueError, KeyError) as exc:
        print(f"Cannot use source '{args.source}':\n\n{exc}")
        return 1

    fetch_kwargs: Dict[str, Any] = {}
    if args.plan:
        plan = json.loads(Path(args.plan).read_text(encoding="utf-8"))
        fetch_kwargs.update(plan)

    out_dir = RAW_DIR / args.source
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{args.run_id}.jsonl"

    if out_path.exists():
        print(f"Refusing to overwrite raw snapshot: {out_path}. Use a new run-id.")
        return 1
    written = 0
    try:
        with out_path.open("x", encoding="utf-8") as out:
            for posting in source.fetch(**fetch_kwargs):
                out.write(posting.to_json() + "\n")
                written += 1
                if written % 200 == 0:
                    print(f"  {written} postings...")
    except (NotImplementedError, RuntimeError) as exc:
        print(f"\n{exc}")
        return 1
    except KeyboardInterrupt:
        print(f"\nInterrupted. {written} postings kept in {out_path}")

    print(f"\nWrote {written} raw postings -> {out_path}")
    if hasattr(source, "requests_used"):
        print(f"API requests used this run: {source.requests_used}")
    return 0


def cmd_normalize(args: argparse.Namespace) -> int:
    from .normalize import normalize_all

    counts = normalize_all()
    print("Normalization complete\n")
    for key, value in counts.items():
        print(f"  {key:12} {value:,}")
    if counts["match"] < 2000:
        print(f"\n  Note: {counts['match']} match-tier postings, target is 2,000–5,000.")
    return 0


def cmd_label(args: argparse.Namespace) -> int:
    from .label import label_all

    print(f"Labelling with Tabiya NER (this downloads ~500MB on first run)...\n")
    counts = label_all(
        tiers=tuple(args.tiers.split(",")),
        embed=not args.no_embed,
        limit=args.limit,
    )
    print("\nLabelling complete\n")
    for key, value in counts.items():
        print(f"  {key:14} {value:,}")
    return 0


def cmd_report(args: argparse.Namespace) -> int:
    from .quality import build_report

    report = build_report()
    print(report)
    return 0


def main(argv: List[str] = None) -> int:
    parser = argparse.ArgumentParser(prog="pipeline.cli", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("esco-check", help="verify the ESCO reference download").set_defaults(func=cmd_esco_check)

    collect = sub.add_parser("collect", help="harvest raw postings from a source")
    collect.add_argument("--source", required=True, choices=available_sources())
    collect.add_argument("--plan", help="JSON file of fetch kwargs (keywords, locations, ...)")
    collect.add_argument("--path", help="tabular source: local CSV/JSONL")
    collect.add_argument("--hf-dataset", help="tabular source: HuggingFace dataset id")
    collect.add_argument("--licence", help="licence string recorded on every row")
    collect.add_argument("--request-budget", type=int, default=50,
                         help="JSearch maximum API calls this run; check subscription quota")
    collect.add_argument("--run-id", default="run", help="output filename stem")
    collect.add_argument("--i-have-read-the-terms", action="store_true",
                         help="required for gated sources; records the decision as yours")
    collect.set_defaults(func=cmd_collect)

    normalize = sub.add_parser("normalize", help="raw -> canonical schema, dedupe, tier")
    normalize.set_defaults(func=cmd_normalize)

    label = sub.add_parser("label", help="Tabiya NER + ESCO entity linking")
    label.add_argument("--tiers", default="match", help="comma-separated corpus tiers")
    label.add_argument("--limit", type=int, help="stop after N jobs (for a smoke test)")
    label.add_argument("--no-embed", action="store_true", help="exact-label linking only")
    label.set_defaults(func=cmd_label)

    sub.add_parser("report", help="corpus quality report").set_defaults(func=cmd_report)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())

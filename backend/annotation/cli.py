"""Annotation harness CLI.

    python -m annotation.cli build   --runs bm25=runs/bm25.json taxonomy=runs/tax.json \
                                     --resumes resumes.json --jobs jobs.json --depth 10
    python -m annotation.cli assign  --annotators maria jose --overlap 0.15
    python -m annotation.cli annotate --annotator maria
    python -m annotation.cli status
    python -m annotation.cli agreement
    python -m annotation.cli export
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from .agreement import interpret, pairwise_agreement
from .export import write_qrels
from .pool import assign, build_pool, pool_statistics, read_pool, write_pool
from .schema import GRADES, Judgement
from .store import JudgementStore

BACKEND_DIR = Path(__file__).resolve().parents[1]
ANNOTATION_DIR = BACKEND_DIR / "data" / "corpus" / "annotation"
POOL_PATH = ANNOTATION_DIR / "pool.jsonl"
ASSIGNMENT_PATH = ANNOTATION_DIR / "assignments.json"
JUDGEMENTS_PATH = ANNOTATION_DIR / "judgements.jsonl"
QRELS_PATH = BACKEND_DIR / "data" / "corpus" / "evaluation" / "qrels.jsonl"

WRAP = 92


def _wrap(text: str, width: int = WRAP, indent: str = "  ") -> str:
    import textwrap
    return "\n".join(
        textwrap.fill(line, width, initial_indent=indent, subsequent_indent=indent)
        for line in str(text).splitlines() if line.strip()
    )


def cmd_build(args: argparse.Namespace) -> int:
    runs: Dict[str, Dict[str, List[str]]] = {}
    for spec in args.runs:
        name, _, path = spec.partition("=")
        if not path:
            print(f"Bad --runs entry '{spec}'. Use NAME=path.json")
            return 1
        runs[name] = json.loads(Path(path).read_text(encoding="utf-8"))

    resumes = json.loads(Path(args.resumes).read_text(encoding="utf-8"))
    jobs = json.loads(Path(args.jobs).read_text(encoding="utf-8"))

    items = build_pool(runs, resumes, jobs, depth=args.depth,
                       max_per_resume=args.max_per_resume, seed=args.seed)
    write_pool(items, POOL_PATH)

    stats = pool_statistics(items)
    print(f"Pool written -> {POOL_PATH}\n")
    for key, value in stats.items():
        print(f"  {key:32} {value}")

    est = stats["pool_size"] * 20 / 3600
    print(f"\n  estimated annotation time at 20s/pair: {est:.1f} hours")
    if stats["resumes"] < 150:
        print(f"  note: {stats['resumes']} resumes. Power analysis favours ~150+; "
              f"prefer more resumes judged shallowly over fewer judged deeply.")
    return 0


def cmd_assign(args: argparse.Namespace) -> int:
    items = read_pool(POOL_PATH)
    assignments = assign(items, args.annotators, overlap_fraction=args.overlap, seed=args.seed)
    ASSIGNMENT_PATH.write_text(json.dumps(assignments, indent=2), encoding="utf-8")

    print(f"Assignments written -> {ASSIGNMENT_PATH}\n")
    overlap = set.intersection(*(set(v) for v in assignments.values())) if len(assignments) > 1 else set()
    for name, ids in assignments.items():
        print(f"  {name:20} {len(ids):5} items")
    print(f"\n  shared overlap for kappa: {len(overlap)} items")
    if len(assignments) > 1 and len(overlap) < 50:
        print("  note: fewer than 50 shared items makes kappa unstable. Raise --overlap.")
    return 0


def cmd_annotate(args: argparse.Namespace) -> int:
    items = {item.pool_id: item for item in read_pool(POOL_PATH)}
    store = JudgementStore(JUDGEMENTS_PATH)

    if ASSIGNMENT_PATH.exists():
        assignments = json.loads(ASSIGNMENT_PATH.read_text(encoding="utf-8"))
        my_ids = assignments.get(args.annotator)
        if my_ids is None:
            print(f"'{args.annotator}' has no assignment. Known: {sorted(assignments)}")
            return 1
    else:
        my_ids = list(items)

    done = store.done_ids(args.annotator)
    todo = [pid for pid in my_ids if pid not in done]

    if not todo:
        print(f"Nothing left for {args.annotator}. {len(done)} already judged.")
        return 0

    print(f"\n  {args.annotator}: {len(todo)} to judge, {len(done)} done.")
    print("  Keys: 0 / 1 / 2 to grade  ·  s skip  ·  b back  ·  q save and quit\n")
    for grade, description in GRADES.items():
        print(f"    {grade} = {description}")

    index = 0
    history: List[str] = []

    while index < len(todo):
        item = items[todo[index]]
        print("\n" + "=" * WRAP)
        print(f"  [{index + 1}/{len(todo)}]   resume {item.resume_id}   job {item.job_id}")
        print("=" * WRAP)
        print("\n  RESUME")
        print(_wrap(item.resume_text[:args.text_chars]))
        print(f"\n  JOB — {item.job_title}")
        print(_wrap(item.job_text[:args.text_chars]))
        print("\n" + "-" * WRAP)

        started = time.time()
        try:
            answer = input("  grade [0/1/2, s, b, q] > ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            print("\n  saved. resume with the same command.")
            return 0

        if answer == "q":
            print(f"\n  saved. {len(done) + len(history)} judged in total.")
            return 0
        if answer == "s":
            index += 1
            continue
        if answer == "b":
            index = max(0, index - 1)
            continue
        if answer not in {"0", "1", "2"}:
            print("  ! enter 0, 1, 2, s, b or q")
            continue

        store.append(Judgement(
            pool_id=item.pool_id,
            resume_id=item.resume_id,
            job_id=item.job_id,
            grade=int(answer),
            annotator=args.annotator,
            duration_ms=int((time.time() - started) * 1000),
        ))
        history.append(item.pool_id)
        index += 1

    print(f"\n  Finished. {len(history)} judged this session.")
    return 0


def cmd_status(args: argparse.Namespace) -> int:
    store = JudgementStore(JUDGEMENTS_PATH)
    stats = store.statistics()

    print("Judgement store\n")
    print(f"  judgements       {stats['judgements']}")
    print(f"  revisions        {stats['revisions']}")
    print(f"  relevant rate    {stats['relevant_rate']}")
    print(f"  median seconds   {stats['median_seconds']}")
    print(f"  grades           {stats['grade_totals']}")

    if POOL_PATH.exists():
        total = len(read_pool(POOL_PATH))
        if ASSIGNMENT_PATH.exists():
            assignments = json.loads(ASSIGNMENT_PATH.read_text(encoding="utf-8"))
            print("\n  progress")
            for name, ids in assignments.items():
                done = len(store.done_ids(name))
                pct = 100 * done / len(ids) if ids else 0
                bar = "█" * int(pct / 4) + "·" * (25 - int(pct / 4))
                print(f"    {name:16} {done:5}/{len(ids):<5} {pct:5.1f}%  {bar}")
        else:
            print(f"\n  pool size {total}, no assignments yet")

    if stats["relevant_rate"] and stats["relevant_rate"] < 0.05:
        print("\n  ! relevant rate under 5%. Your pool may be dominated by "
              "non-relevant pairs; consider reducing depth or improving the runs.")
    return 0


def cmd_agreement(args: argparse.Namespace) -> int:
    results = pairwise_agreement(JudgementStore(JUDGEMENTS_PATH))
    if not results:
        print("No overlapping judgements yet. Run `assign` with 2+ annotators.")
        return 0

    for row in results:
        print(f"\n  {row['annotator_a']} vs {row['annotator_b']}  "
              f"(overlap {row['overlap']})")
        print(f"    raw agreement       {row['raw_agreement']:.4f}")
        print(f"    kappa unweighted    {row['kappa_unweighted']:+.4f}  ({row['interpretation']})")
        print(f"    kappa quadratic     {row['kappa_quadratic']:+.4f}")
        print(f"    kappa binary        {row['kappa_binary']:+.4f}")
        if row["disagreements"]:
            print(f"    disagreements       {len(row['disagreements'])} shown (max 20)")
    return 0


def cmd_export(args: argparse.Namespace) -> int:
    summary = write_qrels(JudgementStore(JUDGEMENTS_PATH), QRELS_PATH)
    print("qrels exported\n")
    for key, value in summary.items():
        print(f"  {key:20} {value}")
    print(f"\n  use with: python -m models.cli evaluate --qrels {QRELS_PATH} --runs NAME=run.json")
    return 0


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        prog="annotation.cli", description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    build = sub.add_parser("build", help="pool the top-K of each run")
    build.add_argument("--runs", nargs="+", required=True, metavar="NAME=PATH.json")
    build.add_argument("--resumes", required=True, help="JSON: resume_id -> text")
    build.add_argument("--jobs", required=True, help="JSON: job_id -> {title, text}")
    build.add_argument("--depth", type=int, default=10)
    build.add_argument("--max-per-resume", type=int, default=None)
    build.add_argument("--seed", type=int, default=20260824)
    build.set_defaults(func=cmd_build)

    assign_parser = sub.add_parser("assign", help="split the pool across annotators")
    assign_parser.add_argument("--annotators", nargs="+", required=True)
    assign_parser.add_argument("--overlap", type=float, default=0.15)
    assign_parser.add_argument("--seed", type=int, default=20260824)
    assign_parser.set_defaults(func=cmd_assign)

    annotate = sub.add_parser("annotate", help="judge pairs (resumable)")
    annotate.add_argument("--annotator", required=True)
    annotate.add_argument("--text-chars", type=int, default=1100)
    annotate.set_defaults(func=cmd_annotate)

    sub.add_parser("status", help="progress and grade distribution").set_defaults(func=cmd_status)
    sub.add_parser("agreement", help="Cohen's kappa on the overlap").set_defaults(func=cmd_agreement)
    sub.add_parser("export", help="write qrels.jsonl").set_defaults(func=cmd_export)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())

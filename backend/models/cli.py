"""Kareerly model training CLI.

    python -m models.cli synthesize --resumes-per-job 2
    python -m models.cli train-retriever --epochs 3
    python -m models.cli train-scorer --epochs 2
    python -m models.cli calibrate --judgements data/corpus/evaluation/qrels.jsonl
    python -m models.cli evaluate --qrels ... --runs ...
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, List


def cmd_synthesize(args: argparse.Namespace) -> int:
    """Build training pairs. Default source is Djinni (real, licensed, cited)."""
    if args.source == "djinni":
        from .djinni import build_pairs

        counts = build_pairs(
            max_pairs=args.max_pairs,
            dev_fraction=args.dev_fraction,
            categories=args.categories,
            seed=args.seed,
        )
    else:
        from .synthesize import build_pairs

        counts = build_pairs(
            resumes_per_job=args.resumes_per_job,
            dev_fraction=args.dev_fraction,
            seed=args.seed,
        )
    print(f"Training pairs built from '{args.source}'\n")
    for key, value in counts.items():
        if isinstance(value, list):
            print(f"  {key:26} {len(value)} ({', '.join(map(str, value[:6]))}...)")
        else:
            print(f"  {key:26} {value:,}")
    return 0


def cmd_train_retriever(args: argparse.Namespace) -> int:
    from .train_retriever import train

    summary = train(epochs=args.epochs, batch_size=args.batch_size,
                    learning_rate=args.learning_rate, device=args.device,
                    resume_from_checkpoint=not args.restart)
    print("\nM2 MatchRetriever trained\n")
    for key in ("base_model", "output_dir", "train_pairs", "dev_pairs", "epochs", "loss", "device"):
        print(f"  {key:16} {summary[key]}")
    return 0


def cmd_train_scorer(args: argparse.Namespace) -> int:
    from .train_scorer import train

    summary = train(epochs=args.epochs, batch_size=args.batch_size,
                    learning_rate=args.learning_rate)
    print("\nM3 MatchScorer trained\n")
    for key in ("base_model", "output_dir", "train_examples", "positives",
                "negatives", "epochs", "loss"):
        print(f"  {key:16} {summary[key]}")
    return 0


def cmd_calibrate(args: argparse.Namespace) -> int:
    from .calibrate import calibrate

    logits: List[float] = []
    labels: List[int] = []
    with Path(args.judgements).open(encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            record = json.loads(line)
            logits.append(float(record["logit"]))
            labels.append(1 if float(record.get("grade", 0)) >= args.threshold else 0)

    report = calibrate(logits, labels, bins=args.bins)
    print("Calibration fitted\n")
    print(f"  pairs                {report['n_pairs']:,}")
    print(f"  positive rate        {report['positive_rate']:.3f}")
    print(f"  z0                   {report['params']['z0']:+.4f}")
    print(f"  temperature T        {report['params']['temperature']:.4f}")
    print(f"\n  ECE (calibrated)     {report['calibrated']['ece']:.4f}")
    print(f"  ECE (v1 min-max)     {report['minmax_baseline']['ece']:.4f}")
    print(f"  improvement          {report['ece_improvement']:+.4f}")
    return 0


def cmd_evaluate(args: argparse.Namespace) -> int:
    from .evaluate import ablation_table, evaluate_run, load_qrels

    qrels = load_qrels(Path(args.qrels))
    runs: Dict[str, Dict[str, List[str]]] = {}
    for spec in args.runs:
        name, _, path = spec.partition("=")
        runs[name] = json.loads(Path(path).read_text(encoding="utf-8"))

    print(f"Judged resumes: {len(qrels)}\n")
    print(ablation_table(runs, qrels))
    return 0


def main(argv: List[str] = None) -> int:
    parser = argparse.ArgumentParser(prog="models.cli", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    synth = sub.add_parser("synthesize", help="build training pairs")
    synth.add_argument("--source", choices=["djinni", "pseudo"], default="djinni",
                       help="djinni = real licensed CVs (recommended); "
                            "pseudo = template resumes from your own job corpus")
    synth.add_argument("--max-pairs", type=int, default=20000)
    synth.add_argument("--categories", nargs="*", default=None,
                       help="restrict to these Primary Keyword values")
    synth.add_argument("--resumes-per-job", type=int, default=2)
    synth.add_argument("--dev-fraction", type=float, default=0.15)
    synth.add_argument("--seed", type=int, default=20260823)
    synth.set_defaults(func=cmd_synthesize)

    retr = sub.add_parser("train-retriever", help="M2 bi-encoder, contrastive")
    retr.add_argument("--epochs", type=int, default=3)
    retr.add_argument("--batch-size", type=int, default=16)
    retr.add_argument("--learning-rate", type=float, default=2e-5)
    retr.add_argument("--device", default="auto", choices=["auto", "cpu", "mps", "cuda"])
    retr.add_argument("--restart", action="store_true",
                      help="ignore any checkpoint and start over")
    retr.set_defaults(func=cmd_train_retriever)

    scor = sub.add_parser("train-scorer", help="M3 cross-encoder reranker")
    scor.add_argument("--epochs", type=int, default=2)
    scor.add_argument("--batch-size", type=int, default=16)
    scor.add_argument("--learning-rate", type=float, default=2e-5)
    scor.set_defaults(func=cmd_train_scorer)

    cal = sub.add_parser("calibrate", help="Platt scaling on judged pairs")
    cal.add_argument("--judgements", required=True,
                     help="JSONL with {logit, grade} per judged pair")
    cal.add_argument("--threshold", type=float, default=1.0)
    cal.add_argument("--bins", type=int, default=10)
    cal.set_defaults(func=cmd_calibrate)

    ev = sub.add_parser("evaluate", help="ranking metrics + ablation table")
    ev.add_argument("--qrels", required=True)
    ev.add_argument("--runs", nargs="+", required=True, metavar="NAME=PATH.json")
    ev.set_defaults(func=cmd_evaluate)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())

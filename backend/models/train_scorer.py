"""M3 — MatchScorer. Cross-encoder reranker, fine-tuned.

The cross-encoder reads the resume and the job *together*, so it can attend
across the pair — that is what lets it recognise that "Python programming" in a
resume satisfies "Python (computer programming)" in a posting when the
bi-encoder placed them merely nearby. It is far too slow to run over the whole
corpus, so it only ever sees M2's top-K.

Loss: BinaryCrossEntropyLoss over (resume, job, label) triples. Positives are
the synthesised pairs; negatives are the BM25-mined runner-ups. BCE is the
right choice here rather than a listwise loss because it produces a score that
is *monotone in probability*, which is what the Platt calibration in
`calibrate.py` then maps onto an absolute scale.

That two-step — train for ranking, then calibrate for interpretation — is the
fix for the defect where min-max normalisation gave a nonsense resume a 100%
top match.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional

from .config import PAIRS_DEV, PAIRS_TRAIN, SCORER_BASE, SCORER_OUT, SEED


def _load_triples(path: Path, max_negatives: int = 4) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            record = json.loads(line)
            rows.append({
                "sentence_A": record["query"],
                "sentence_B": record["positive"],
                "label": 1.0,
            })
            for negative in record.get("negatives", [])[:max_negatives]:
                rows.append({
                    "sentence_A": record["query"],
                    "sentence_B": negative,
                    "label": 0.0,
                })
    return rows


def train(
    train_path: Optional[Path] = None,
    dev_path: Optional[Path] = None,
    base_model: str = SCORER_BASE,
    output_dir: Optional[Path] = None,
    epochs: int = 2,
    batch_size: int = 16,
    learning_rate: float = 2e-5,
    max_negatives: int = 4,
) -> Dict[str, Any]:
    from datasets import Dataset
    from sentence_transformers import CrossEncoder
    from sentence_transformers.cross_encoder import (
        CrossEncoderTrainer,
        CrossEncoderTrainingArguments,
    )
    from sentence_transformers.cross_encoder.losses import BinaryCrossEntropyLoss

    train_path = train_path or PAIRS_TRAIN
    dev_path = dev_path or PAIRS_DEV
    output_dir = Path(output_dir or SCORER_OUT)

    train_rows = _load_triples(train_path, max_negatives)
    dev_rows = _load_triples(dev_path, max_negatives)
    if len(train_rows) < batch_size:
        batch_size = max(2, len(train_rows) // 2)
        print(f"  small training set — reducing batch size to {batch_size}")

    model = CrossEncoder(base_model, num_labels=1)
    loss = BinaryCrossEntropyLoss(model)

    args = CrossEncoderTrainingArguments(
        output_dir=str(output_dir / "_checkpoints"),
        num_train_epochs=epochs,
        per_device_train_batch_size=batch_size,
        per_device_eval_batch_size=batch_size,
        learning_rate=learning_rate,
        eval_strategy="epoch" if dev_rows else "no",
        save_strategy="no",
        logging_steps=max(1, len(train_rows) // (batch_size * 4)),
        seed=SEED,
        report_to=[],
    )

    trainer = CrossEncoderTrainer(
        model=model,
        args=args,
        train_dataset=Dataset.from_list(train_rows),
        eval_dataset=Dataset.from_list(dev_rows) if dev_rows else None,
        loss=loss,
    )
    trainer.train()

    output_dir.mkdir(parents=True, exist_ok=True)
    model.save_pretrained(str(output_dir))

    positives = sum(1 for row in train_rows if row["label"] == 1.0)
    summary = {
        "model": "M3_MatchScorer",
        "base_model": base_model,
        "output_dir": str(output_dir),
        "train_examples": len(train_rows),
        "positives": positives,
        "negatives": len(train_rows) - positives,
        "dev_examples": len(dev_rows),
        "epochs": epochs,
        "batch_size": batch_size,
        "loss": "BinaryCrossEntropyLoss",
        "log_history": trainer.state.log_history[-5:],
    }
    (output_dir / "training_summary.json").write_text(
        json.dumps(summary, indent=2), encoding="utf-8"
    )
    return summary

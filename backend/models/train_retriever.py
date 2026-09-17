"""M2 — MatchRetriever. Bi-encoder trained with contrastive learning.

Architecture: two-tower. The resume and the job are encoded independently into
the same vector space, so job embeddings are computed once and cached, and
retrieval at query time is a single matrix product. This is what makes the
system usable as the corpus grows from hundreds to thousands of postings.

Loss: MultipleNegativesRankingLoss. Given (anchor, positive, hard_negatives),
every other positive in the batch also acts as a negative, so a batch of B
pairs yields O(B^2) training signals from B labelled examples. That efficiency
is why ConFit uses it and why it is the right choice on a small corpus.

The model IS trained here — weights are updated and written to disk. This is
the artefact your coursework requires.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional

from .config import PAIRS_DEV, PAIRS_TRAIN, RETRIEVER_BASE, RETRIEVER_OUT, SEED


def _load_pairs(path: Path, max_negatives: int = 2) -> List[Dict[str, str]]:
    """Flatten to the (anchor, positive, negative_1..n) columns the loss expects."""
    rows: List[Dict[str, str]] = []
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            record = json.loads(line)
            row = {"anchor": record["query"], "positive": record["positive"]}
            for index, negative in enumerate(record.get("negatives", [])[:max_negatives]):
                row[f"negative_{index + 1}"] = negative
            rows.append(row)
    return rows


def resolve_device(requested: str = "auto") -> str:
    """Prefer an exposed accelerator, otherwise CPU.

    macOS sandbox restrictions can hide MPS. On 2026-09-10, an authorized
    outside-sandbox benchmark found MPS substantially faster for this backbone.
    Benchmark under the actual execution permissions instead of assuming that
    a sandbox's unavailable GPU means the machine has no usable accelerator.
    """
    import torch

    if requested != "auto":
        return requested
    if torch.cuda.is_available():
        return "cuda"
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def train(
    train_path: Optional[Path] = None,
    dev_path: Optional[Path] = None,
    base_model: str = RETRIEVER_BASE,
    output_dir: Optional[Path] = None,
    epochs: int = 3,
    batch_size: int = 16,
    learning_rate: float = 2e-5,
    max_negatives: int = 2,
    warmup_ratio: float = 0.1,
    device: str = "auto",
    save_steps: int = 200,
    resume_from_checkpoint: bool = True,
) -> Dict[str, Any]:
    from datasets import Dataset
    from sentence_transformers import (
        SentenceTransformer,
        SentenceTransformerTrainer,
        SentenceTransformerTrainingArguments,
    )
    from sentence_transformers.losses import MultipleNegativesRankingLoss

    train_path = train_path or PAIRS_TRAIN
    dev_path = dev_path or PAIRS_DEV
    output_dir = Path(output_dir or RETRIEVER_OUT)

    train_rows = _load_pairs(train_path, max_negatives)
    dev_rows = _load_pairs(dev_path, max_negatives)
    if len(train_rows) < batch_size:
        batch_size = max(2, len(train_rows) // 2)
        print(f"  small training set — reducing batch size to {batch_size}")

    train_dataset = Dataset.from_list(train_rows)
    eval_dataset = Dataset.from_list(dev_rows) if dev_rows else None

    device = resolve_device(device)
    print(f"  device: {device}   train={len(train_rows)} dev={len(dev_rows)} "
          f"batch={batch_size} epochs={epochs}", flush=True)

    model = SentenceTransformer(base_model, device=device)
    loss = MultipleNegativesRankingLoss(model)

    args = SentenceTransformerTrainingArguments(
        output_dir=str(output_dir / "_checkpoints"),
        num_train_epochs=epochs,
        per_device_train_batch_size=batch_size,
        per_device_eval_batch_size=batch_size,
        learning_rate=learning_rate,
        warmup_ratio=warmup_ratio,
        eval_strategy="epoch" if eval_dataset else "no",
        # Checkpoint periodically. A long run that dies with save_strategy="no"
        # loses everything -- which is exactly what happened on the first
        # Djinni attempt: three hours, no artefact, nothing to resume.
        save_strategy="steps",
        save_steps=save_steps,
        save_total_limit=2,
        logging_steps=max(1, min(50, len(train_rows) // (batch_size * 8) or 1)),
        disable_tqdm=False,
        seed=SEED,
        use_cpu=device == "cpu",
        report_to=[],
        # in-batch negatives require that no two rows in a batch share a positive
        batch_sampler="no_duplicates",
    )

    trainer = SentenceTransformerTrainer(
        model=model,
        args=args,
        train_dataset=train_dataset,
        eval_dataset=eval_dataset,
        loss=loss,
    )
    checkpoint_dir = output_dir / "_checkpoints"
    has_checkpoint = checkpoint_dir.exists() and any(
        child.name.startswith("checkpoint-") for child in checkpoint_dir.iterdir()
    )
    if resume_from_checkpoint and has_checkpoint:
        print(f"  resuming from a checkpoint in {checkpoint_dir}", flush=True)
        trainer.train(resume_from_checkpoint=True)
    else:
        trainer.train()

    output_dir.mkdir(parents=True, exist_ok=True)
    model.save(str(output_dir))

    summary = {
        "model": "M2_MatchRetriever",
        "base_model": base_model,
        "output_dir": str(output_dir),
        "train_pairs": len(train_rows),
        "dev_pairs": len(dev_rows),
        "epochs": epochs,
        "batch_size": batch_size,
        "learning_rate": learning_rate,
        "loss": "MultipleNegativesRankingLoss",
        "device": device,
        "log_history": trainer.state.log_history[-5:],
    }
    (output_dir / "training_summary.json").write_text(
        json.dumps(summary, indent=2), encoding="utf-8"
    )
    return summary

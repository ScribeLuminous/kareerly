"""Full-resume evidence for the bi-encoder.

The fine-tuned encoder was trained on one input per candidate: a role, up to
32 skills and the first 1,400 characters of evidence, read with a 256-token
limit. A single input therefore never sees most of a two-page resume: work
experience and projects listed after the summary and education are cut off.

Instead of changing the trained model, the resume is read as several inputs
in the same training format:

* the profile input, exactly as before (skills from the whole resume, the
  opening of the text as evidence), so short resumes score as they always did;
* one input per section, and per window of a long section, each small enough
  that its skills and evidence fit in the 256-token limit.

Each input is compared with the job and the job keeps its highest cosine
("max-passage" aggregation, as in passage-level document ranking). The
reasoning: a resume is relevant to a job when some part of it is, and averaging
would let a long, varied resume dilute the one section that matters.

A maximum over many inputs is biased upward, for unrelated jobs too, while the
Fit-Now and Aspiration floors were calibrated on the single profile input. So
section cosines are lowered by a fixed offset before the maximum
(matching_service.SECTION_EVIDENCE_OFFSET, calibrated on the mock-resume
diagnostic):

    semantic = max(profile cosine, best section cosine - offset)

A short resume, read whole by the profile input, scores exactly as before; a
later section raises the score only when it is clearly more relevant than the
opening. It never lowers a match the profile input found.

The result is still a cosine similarity between embeddings. It measures how
alike the texts are, not the chance of being hired.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import List, Sequence

from .bi_encoder_service import build_model_input
from .resume_analyzer import split_resume_sections

# Evidence characters per section input. With the skills found in that window
# this stays under the encoder's 256-token limit (checked against the
# checkpoint's tokenizer in tests/test_resume_evidence.py when it is installed).
CHUNK_CHARS = 700
# A window repeats the end of the previous one, so a sentence split between
# windows is still read whole once.
CHUNK_OVERLAP_CHARS = 120
# Shorter fragments (a lone contact line, a one-word heading) carry too little
# evidence to be compared on their own and are merged with a neighbour.
MIN_CHUNK_CHARS = 120
# Resume text is capped at 60,000 characters; this bounds the encoder calls
# per report. Reached only by resumes of roughly six pages or more.
MAX_EVIDENCE_CHUNKS = 24


@dataclass(frozen=True)
class EvidenceChunk:
    section: str
    text: str


def _pieces(body: str) -> List[str]:
    """Lines or sentences, with any piece longer than a window split on words."""
    pieces = [piece.strip() for piece in re.split(r"\n+|(?<=[.;!?])\s+", body) if piece.strip()]
    result: List[str] = []
    for piece in pieces:
        while len(piece) > CHUNK_CHARS:
            cut = piece.rfind(" ", 0, CHUNK_CHARS)
            cut = cut if cut > CHUNK_CHARS // 2 else CHUNK_CHARS
            result.append(piece[:cut].strip())
            piece = piece[cut:].strip()
        if piece:
            result.append(piece)
    return result


def _windows(body: str) -> List[str]:
    windows: List[str] = []
    current: List[str] = []
    length = 0
    for piece in _pieces(body):
        if current and length + len(piece) + 1 > CHUNK_CHARS:
            windows.append(" ".join(current))
            # Carry the tail of this window into the next one.
            carried: List[str] = []
            carried_length = 0
            for previous in reversed(current):
                if carried_length + len(previous) > CHUNK_OVERLAP_CHARS:
                    break
                carried.insert(0, previous)
                carried_length += len(previous) + 1
            current, length = carried, carried_length
        current.append(piece)
        length += len(piece) + 1
    if current:
        windows.append(" ".join(current))
    return windows


def resume_evidence_chunks(resume_text: str) -> List[EvidenceChunk]:
    """The resume as section-labelled windows covering all of its text, in order."""
    chunks: List[EvidenceChunk] = []
    for heading, body in split_resume_sections(resume_text or ""):
        for window in _windows(body):
            label = heading if heading in {"resume", "profile"} else heading.upper()
            text = window if heading in {"resume", "profile"} else f"{label}: {window}"
            if chunks and len(window) < MIN_CHUNK_CHARS and len(chunks[-1].text) + len(text) <= CHUNK_CHARS + MIN_CHUNK_CHARS:
                chunks[-1] = EvidenceChunk(chunks[-1].section, f"{chunks[-1].text} {text}")
                continue
            chunks.append(EvidenceChunk(heading, text))
    # A short first fragment (usually the name and contact line) joins the next.
    if len(chunks) > 1 and len(chunks[0].text) < MIN_CHUNK_CHARS:
        chunks[1] = EvidenceChunk(chunks[1].section, f"{chunks[0].text} {chunks[1].text}")
        chunks.pop(0)
    return chunks


@dataclass(frozen=True)
class CandidateEvidence:
    """Encoder inputs for one resume and the section each one reads."""

    inputs: List[str]
    sections: List[str]
    chunk_count: int
    truncated: bool


def candidate_model_inputs(resume_text: str, skill_names: Sequence[str] = ()) -> CandidateEvidence:
    """The profile input followed by one input per evidence window."""
    profile = build_model_input(resume_text, skill_names=skill_names)
    all_chunks = resume_evidence_chunks(resume_text)
    chunks = all_chunks[:MAX_EVIDENCE_CHUNKS]
    # Section inputs list only the skills their own window names, so a window
    # is judged on what it shows rather than on the whole resume again.
    inputs = [profile] + [build_model_input(chunk.text) for chunk in chunks]
    # A resume of a single window is already read whole by the profile input.
    if len(chunks) <= 1 and len(resume_text or "") <= CHUNK_CHARS:
        inputs = [profile]
        chunks = []
    return CandidateEvidence(
        inputs=inputs,
        sections=["profile_summary"] + [chunk.section for chunk in chunks],
        chunk_count=len(chunks),
        truncated=len(all_chunks) > MAX_EVIDENCE_CHUNKS,
    )

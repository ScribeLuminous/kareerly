"""Reading order for multi-column PDF pages.

PDF text has no reading order of its own: a two-column resume is often stored
line by line across the page, so plain extraction interleaves the columns
("Skills  Work Experience" / "Excel  Support Agent, 2021") and a skill phrase in
one column can be split by, or glued to, words from the other.

This finds a vertical gutter from the word boxes, then reads the page in bands:
a line that crosses the gutter (a name, a heading, a summary across the page)
is read on its own, and between such lines the left column is read top to
bottom before the right one. A column is split again if it has a gutter of its
own, so three-column layouts come out in order too.
"""
import re
from dataclasses import dataclass
from typing import Iterable, Optional

# A gutter narrower than this is ordinary word spacing or a tab stop.
MIN_GUTTER_WIDTH = 9.0
# Gutters are looked for in this middle band of the text area.
GUTTER_SEARCH_MARGIN = 0.12
# Lines allowed to cross a gutter (a name, headings or a summary above the columns).
MAX_CROSSING_LINE_SHARE = 0.35
# Each column needs this share of the page's characters and this many lines, so
# right-aligned dates or page numbers are not mistaken for a column.
MIN_COLUMN_CHAR_SHARE = 0.10
MIN_COLUMN_LINES = 3
MAX_SPLIT_DEPTH = 2
# A sidebar of short items (contact lines, skill names, languages) can hold
# less than MIN_COLUMN_CHAR_SHARE of a page full of job descriptions. It is
# still a column when it has this share and enough lines, its gutter is clean
# and wide, and its lines are mostly words rather than dates or numbers.
MIN_SIDEBAR_CHAR_SHARE = 0.04
MIN_SIDEBAR_LINES = 6
MIN_SIDEBAR_GUTTER_WIDTH = 20.0
_DATE_TOKEN = re.compile(
    r"^(?:\d[\d./\-–—]*|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?|present|current|now|[-–—|])$",
    re.IGNORECASE,
)


@dataclass
class Word:
    text: str
    x0: float
    x1: float
    top: float
    bottom: float


def _line_clusters(words: list[Word]) -> list[list[Word]]:
    """Words grouped into visual lines, top to bottom, each line left to right."""
    lines: list[list[Word]] = []
    for word in sorted(words, key=lambda item: (item.top, item.x0)):
        height = max(word.bottom - word.top, 1.0)
        if lines:
            current = lines[-1]
            anchor = current[0]
            tolerance = max(2.0, 0.45 * max(anchor.bottom - anchor.top, height))
            if abs(word.top - anchor.top) <= tolerance:
                current.append(word)
                continue
        lines.append([word])
    for line in lines:
        line.sort(key=lambda item: item.x0)
    return lines


def _find_gutter(words: list[Word], lines: list[list[Word]]) -> Optional[tuple[float, float]]:
    if len(lines) < 2 * MIN_COLUMN_LINES:
        return None
    left_edge = min(word.x0 for word in words)
    right_edge = max(word.x1 for word in words)
    width = right_edge - left_edge
    if width <= 4 * MIN_GUTTER_WIDTH:
        return None

    start = int(left_edge + GUTTER_SEARCH_MARGIN * width)
    stop = int(right_edge - GUTTER_SEARCH_MARGIN * width)
    if stop <= start:
        return None

    # For every x, how many lines have a word covering it.
    crossing = [0] * (stop - start + 1)
    for line in lines:
        covered = set()
        for word in line:
            first = max(start, int(word.x0))
            last = min(stop, int(word.x1 + 0.999))
            covered.update(range(first, last + 1))
        for x in covered:
            crossing[x - start] += 1

    allowed = int(MAX_CROSSING_LINE_SHARE * len(lines))
    total_chars = sum(len(word.text) for word in words) or 1
    best: Optional[tuple[float, float, int, float]] = None
    run_start: Optional[int] = None
    for index in range(len(crossing) + 1):
        open_x = index < len(crossing) and crossing[index] <= allowed
        if open_x and run_start is None:
            run_start = index
            continue
        if open_x or run_start is None:
            continue
        gap_start, gap_end = start + run_start, start + index - 1
        run_start = None
        if gap_end - gap_start < MIN_GUTTER_WIDTH:
            continue
        # The gutter is the emptiest stretch of the run at least a gutter wide:
        # the run's edges can hold the ragged ends of a column's longer lines,
        # and a single space between two words of a heading is not a gutter.
        segment = crossing[gap_start - start:gap_end - start + 1]
        window = int(MIN_GUTTER_WIDTH) + 1
        min_crossing = min(max(segment[i:i + window]) for i in range(len(segment) - window + 1))
        widest: tuple[int, int] = (0, -1)
        stretch_start: Optional[int] = None
        for offset, count in enumerate(segment + [min_crossing + 1]):
            if count <= min_crossing and stretch_start is None:
                stretch_start = offset
            elif count > min_crossing and stretch_start is not None:
                if offset - 1 - stretch_start > widest[1] - widest[0]:
                    widest = (stretch_start, offset - 1)
                stretch_start = None
        gap_start, gap_end = gap_start + widest[0], gap_start + widest[1]
        if gap_end - gap_start < MIN_GUTTER_WIDTH:
            continue
        left_chars = sum(len(w.text) for w in words if w.x1 <= gap_start + 1)
        right_chars = sum(len(w.text) for w in words if w.x0 >= gap_end - 1)
        left_lines = sum(1 for line in lines if any(w.x1 <= gap_start + 1 for w in line))
        right_lines = sum(1 for line in lines if any(w.x0 >= gap_end - 1 for w in line))
        if left_lines < MIN_COLUMN_LINES or right_lines < MIN_COLUMN_LINES:
            continue
        # Right-aligned dates are part of the lines they sit on, not a column of
        # their own: reading them separately would move every date away from
        # its job or degree.
        if not _mostly_words([w for w in words if w.x1 <= gap_start + 1]) or not _mostly_words([w for w in words if w.x0 >= gap_end - 1]):
            continue
        narrow_ok = True
        for side_chars, side_lines, side_words in (
            (left_chars, left_lines, [w for w in words if w.x1 <= gap_start + 1]),
            (right_chars, right_lines, [w for w in words if w.x0 >= gap_end - 1]),
        ):
            if side_chars >= MIN_COLUMN_CHAR_SHARE * total_chars:
                continue
            if not (
                side_chars >= MIN_SIDEBAR_CHAR_SHARE * total_chars
                and side_lines >= MIN_SIDEBAR_LINES
                and gap_end - gap_start >= MIN_SIDEBAR_GUTTER_WIDTH
                and min_crossing <= 1
                and _mostly_words(side_words)
            ):
                narrow_ok = False
        if not narrow_ok:
            continue
        # A gutter is only real if most lines have text on one side of it only.
        one_sided = sum(
            1 for line in lines
            if not any(w.x0 < gap_end - 1 and w.x1 > gap_start + 1 for w in line)
        )
        if one_sided < 0.5 * len(lines):
            continue
        candidate = (float(gap_start), float(gap_end), min_crossing, -(gap_end - gap_start))
        if best is None or (candidate[2], candidate[3]) < (best[2], best[3]):
            best = candidate
    if best is None:
        return None
    return best[0], best[1]


def _mostly_words(words: list[Word]) -> bool:
    """True for a sidebar of words; False for a column of right-aligned dates or numbers."""
    tokens = [w.text.strip() for w in words if w.text.strip()]
    if not tokens:
        return False
    dates = sum(1 for token in tokens if _DATE_TOKEN.match(token))
    return dates <= 0.3 * len(tokens)


def _line_text(line: Iterable[Word]) -> str:
    return " ".join(word.text for word in line if word.text)


def order_words(words: list[Word], depth: int = 0) -> list[str]:
    """Lines of text in reading order."""
    if not words:
        return []
    lines = _line_clusters(words)
    gutter = _find_gutter(words, lines) if depth <= MAX_SPLIT_DEPTH else None
    if gutter is None:
        return [text for text in (_line_text(line) for line in lines) if text]

    gap_start, gap_end = gutter
    output: list[str] = []
    left: list[Word] = []
    right: list[Word] = []

    def flush() -> None:
        output.extend(order_words(left, depth + 1))
        output.extend(order_words(right, depth + 1))
        left.clear()
        right.clear()

    for line in lines:
        spans = any(word.x0 < gap_end - 1 and word.x1 > gap_start + 1 for word in line)
        if spans:
            flush()
            output.append(_line_text(line))
            continue
        for word in line:
            (left if word.x1 <= (gap_start + gap_end) / 2 else right).append(word)
    flush()
    return [text for text in output if text]


def detect_columns(words: list[Word]) -> bool:
    lines = _line_clusters(words)
    return _find_gutter(words, lines) is not None


def page_words(page) -> list[Word]:
    """Word boxes of a pdfplumber page."""
    raw = page.extract_words(
        x_tolerance=1.5,
        y_tolerance=2.5,
        keep_blank_chars=False,
        use_text_flow=False,
    )
    return [
        Word(text=str(item.get("text", "")), x0=float(item["x0"]), x1=float(item["x1"]),
             top=float(item["top"]), bottom=float(item["bottom"]))
        for item in raw
        if str(item.get("text", "")).strip()
    ]

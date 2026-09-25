"""Rejoin skill names that PDF extraction split into pieces.

A PDF stores positioned glyphs, not words. A wide gap between two letters, a
line wrap or a change of font inside a word comes out as a space or a line
break: "Sales force", "Zen\\ndesk", "Quick Books", "Java Script". Matching then
finds neither piece as a skill, so a skill printed in the resume is missing in
Step 1 and reported as a gap.

Pieces are joined only when all of these hold, so ordinary phrases stay apart:

* the joined word is a known single-word skill name or alias of six or more
  letters (from the skill taxonomy, with its usual capitalisation);
* the pieces are separated by spaces on one line or by one line break, never a
  blank line or punctuation;
* the capitalisation fits the name: the first piece starts with a capital, and
  the next piece starts with a capital exactly where the name has one
  ("Quick Books" -> QuickBooks, "Sales force" -> Salesforce) and in lower case
  where it does not. "a sales force of 12" and "Sales Force" stay as written;
* the spaced form is not itself a known phrase.
"""
import re
from typing import Iterable, Mapping

MIN_JOINED_LENGTH = 6
MIN_PIECE_LENGTH = 2
MAX_PIECES = 3

_WORD = re.compile(r"[A-Za-z]+")
# Spaces on one line, or one line break (a wrap), between two pieces.
_SEPARATOR = re.compile(r"[ \t]{1,3}|[ \t]*\r?\n[ \t]*")


def build_split_word_vocabulary(names: Iterable[str]) -> dict[str, tuple[str, ...]]:
    """Lower-cased single-word names -> their written forms, e.g. quickbooks -> ("QuickBooks",).

    Multi-word entries are split so "Microsoft Excel" contributes "Microsoft".
    """
    vocabulary: dict[str, set[str]] = {}
    for name in names:
        for token in _WORD.findall(str(name or "")):
            if len(token) < MIN_JOINED_LENGTH:
                continue
            vocabulary.setdefault(token.lower(), set()).add(token)
    result: dict[str, tuple[str, ...]] = {}
    for key, forms in vocabulary.items():
        # A capitalised or CamelCase spelling carries the boundary information;
        # an all-lower-case alias only says the word is lower case throughout.
        cased = sorted(form for form in forms if form != form.lower() and form != form.upper())
        result[key] = tuple(cased) if cased else (key,)
    return result


def _boundaries_fit(pieces: list[str], form: str) -> bool:
    """Whether each piece starts with the case the written form has at that point."""
    if not pieces[0][0].isupper():
        return False
    offset = 0
    for index, piece in enumerate(pieces):
        if index:
            expected_upper = form[offset].isupper()
            if piece.isupper() and len(piece) > 1:
                # ALL CAPS text says nothing about a lower-case boundary.
                if not expected_upper:
                    return False
            elif piece[0].isupper() != expected_upper:
                return False
        offset += len(piece)
    return True


def repair_split_skill_words(text: str, vocabulary: Mapping[str, tuple[str, ...]],
                             known_phrases: Iterable[str] = ()) -> str:
    """Text with split skill names rejoined (see the module docstring for the rules)."""
    if not text or not vocabulary:
        return text or ""
    phrases = set(known_phrases)
    words = list(_WORD.finditer(text))
    if len(words) < 2:
        return text

    output: list[str] = []
    cursor = 0
    index = 0
    while index < len(words):
        joined = False
        for count in range(min(MAX_PIECES, len(words) - index), 1, -1):
            group = words[index:index + count]
            pieces = [match.group(0) for match in group]
            if any(len(piece) < MIN_PIECE_LENGTH for piece in pieces):
                continue
            separators = [text[group[i].end():group[i + 1].start()] for i in range(count - 1)]
            if not all(_SEPARATOR.fullmatch(separator) for separator in separators):
                continue
            # A word glued to the pieces ("xSales force") is not a split name.
            if group[0].start() > 0 and text[group[0].start() - 1].isalnum():
                continue
            end = group[-1].end()
            if end < len(text) and text[end].isalnum():
                continue
            key = "".join(pieces).lower()
            if len(key) < MIN_JOINED_LENGTH or key not in vocabulary:
                continue
            if " ".join(pieces).lower() in phrases:
                continue
            fitting = [form for form in vocabulary[key] if _boundaries_fit(pieces, form)]
            if not fitting:
                continue
            output.append(text[cursor:group[0].start()])
            output.append(fitting[0])
            cursor = end
            index += count
            joined = True
            break
        if not joined:
            index += 1
    output.append(text[cursor:])
    return "".join(output)

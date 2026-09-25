import re
import unicodedata
from typing import Any, BinaryIO, Union

from docx import Document
from docx.oxml.ns import qn
from pypdf import PdfReader


# Resumes are normally one to three pages. These limits prevent a malformed or
# book-length upload from making alias scanning spend minutes on extracted text.
MAX_RESUME_PAGES = 15
MAX_RESUME_TEXT_CHARS = 60000
_MC_FALLBACK = "{http://schemas.openxmlformats.org/markup-compatibility/2006}Fallback"


def _append_with_limit(parts: list[str], value: str, current_length: int) -> tuple[int, bool]:
    if not value or current_length >= MAX_RESUME_TEXT_CHARS:
        return current_length, True

    remaining = MAX_RESUME_TEXT_CHARS - current_length
    parts.append(value[:remaining])
    next_length = current_length + min(len(value), remaining)
    return next_length, next_length >= MAX_RESUME_TEXT_CHARS


def repair_letter_spaced_text(text: str) -> str:
    """
    Handles PDF extraction where text appears like:
    c u s t o m e r s u p p o r t

    Keeps the original text and appends one compact fallback version
    for section/skill matching.
    """
    if not isinstance(text, str):
        return ""

    text = text.replace("\u00a0", " ")

    single_char_tokens = re.findall(r"\b[A-Za-z0-9]\b", text)
    word_tokens = re.findall(r"\b[A-Za-z0-9]+\b", text)

    looks_letter_spaced = (
        len(single_char_tokens) >= 30
        and len(single_char_tokens) / max(len(word_tokens), 1) >= 0.60
    )

    if not looks_letter_spaced:
        return text

    compact = re.sub(r"\s+", "", text)

    # Prevent adding the same compact fallback more than once.
    if compact and compact in text:
        return text

    return text + "\n\n" + compact


# Invisible characters that PDF and Word files put inside words: zero-width
# spaces and joiners, word joiners and byte-order marks.
_INVISIBLE_CHARS = re.compile("[\u200b-\u200d\u2060\ufeff]")
# A word broken with a hyphen at the end of a line and continued in lowercase
# on the next ("Sales-\nforce"). Hyphenated names split on a capital letter
# ("Jan-\nMar") and ranges ("2021 -\nPresent") are left alone.
_LINE_END_HYPHEN = re.compile(r"(?<=[A-Za-z])-[ \t]*\n[ \t]*(?=[a-z])")


def normalize_extracted_text(text: str) -> str:
    """Undo layout artifacts that split words in extracted document text.

    PDF writers store "ffi"/"fl" ligatures as single characters, so "Office"
    reads as "O" + U+FB03 + "ce" and no longer contains the word; NFKC turns them (and
    full-width letters) back into plain letters. Soft hyphens and zero-width
    characters sit inside words without being visible, and a hyphenated line
    break splits one word into two. Without this, a skill named plainly in the
    resume is neither extracted nor found when skill gaps are calculated.
    """
    if not isinstance(text, str) or not text:
        return ""
    text = unicodedata.normalize("NFKC", text)
    # A soft hyphen at a line end marks the same break as a hyphen.
    text = re.sub("\u00ad[ \t]*\n[ \t]*", "", text).replace("\u00ad", "")
    text = _INVISIBLE_CHARS.sub("", text)
    return _LINE_END_HYPHEN.sub("", text)


def extract_text_from_pdf(source: Union[str, BinaryIO]) -> str:
    """Text of a PDF with an extractable text layer (a path or a binary stream)."""
    text_chunks = []
    total_length = 0

    try:
        reader = PdfReader(source)

        for page_number, page in enumerate(reader.pages):
            if page_number >= MAX_RESUME_PAGES:
                break
            try:
                page_text = page.extract_text() or ""
            except Exception:
                page_text = ""

            if page_text:
                total_length, reached_limit = _append_with_limit(text_chunks, page_text, total_length)
                if reached_limit:
                    break

    except Exception as exc:
        raise RuntimeError(f"Failed to read PDF: {exc}") from exc

    # Image-only (scanned) pages have no text layer and yield nothing here;
    # there is no OCR, so such a resume reads as empty or very short text.
    return normalize_extracted_text("\n".join(text_chunks))


def _docx_paragraph_texts(root: Any) -> list[str]:
    """Every paragraph under an OOXML part, in reading order.

    ``Document.paragraphs`` lists only top-level body paragraphs, so resume
    templates lost everything inside content controls (w:sdt), nested tables
    and text boxes. Walking every w:p finds them all. A text box is stored
    twice (a DrawingML choice and a VML fallback), so fallback content is
    skipped; a paragraph inside a text box is read once, as its own paragraph,
    not again as part of the paragraph that anchors the box.
    """
    texts = []
    for paragraph in root.iter(qn("w:p")):
        if any(ancestor.tag == _MC_FALLBACK for ancestor in paragraph.iterancestors()):
            continue
        parts = []
        for node in paragraph.iter(qn("w:t"), qn("w:tab"), qn("w:br"), qn("w:cr"), qn("w:noBreakHyphen")):
            # Text-box paragraphs nested in this one are read on their own.
            if next(node.iterancestors(qn("w:p"))) is not paragraph:
                continue
            if node.tag == qn("w:t"):
                parts.append(node.text or "")
            elif node.tag == qn("w:noBreakHyphen"):
                # Word stores a non-breaking hyphen ("E-commerce") as an element, not text.
                parts.append("-")
            else:
                parts.append("\t" if node.tag == qn("w:tab") else "\n")
        text = "".join(parts).strip()
        if text:
            texts.append(text)
    return texts


def extract_text_from_docx(source: Union[str, BinaryIO]) -> str:
    """Text of a DOCX resume (a path or a binary stream), headers included."""
    try:
        doc = Document(source)
        parts: list[str] = []
        total_length = 0

        roots = []
        for section in doc.sections:
            # Resume templates often put the name and contact line in the
            # header, and some put a skills or links line in the footer.
            roots.extend(
                part._element
                for part in (section.header, section.first_page_header, section.footer, section.first_page_footer)
                if not part.is_linked_to_previous
            )
        roots.append(doc.element.body)

        seen_roots = set()
        for root in roots:
            if id(root) in seen_roots:
                continue
            seen_roots.add(id(root))
            for text in _docx_paragraph_texts(root):
                total_length, reached_limit = _append_with_limit(parts, text, total_length)
                if reached_limit:
                    return normalize_extracted_text("\n".join(parts))

        return normalize_extracted_text("\n".join(parts))

    except Exception as exc:
        raise RuntimeError(f"Failed to read DOCX: {exc}") from exc


def extract_resume_text(file_path: str) -> str:
    extension = file_path.lower().rsplit(".", 1)[-1]

    if extension == "pdf":
        return extract_text_from_pdf(file_path)

    if extension == "docx":
        return extract_text_from_docx(file_path)

    raise ValueError("Unsupported file type for resume extraction")


def clean_resume_text(text: str) -> str:
    if not isinstance(text, str):
        return ""

    text = repair_letter_spaced_text(text[:MAX_RESUME_TEXT_CHARS])

    text = re.sub(r"\r\n|\r", "\n", text)
    text = re.sub(r"[\t]+", " ", text)
    text = re.sub(r"[ ]{2,}", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)

    return text.strip()[:MAX_RESUME_TEXT_CHARS]


def normalize_for_matching(text: str) -> str:
    if not text:
        return ""

    text = repair_letter_spaced_text(text[:MAX_RESUME_TEXT_CHARS])

    text = text.lower()
    text = re.sub(r"[^a-z0-9+#.\s]", " ", text)
    text = re.sub(r"\s+", " ", text)

    return text.strip()[:MAX_RESUME_TEXT_CHARS]

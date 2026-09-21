import re
from pypdf import PdfReader
from docx import Document


# Resumes are normally one to three pages. These limits prevent a malformed or
# book-length upload from making alias scanning spend minutes on extracted text.
MAX_RESUME_PAGES = 15
MAX_RESUME_TEXT_CHARS = 60000


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


def extract_text_from_pdf(file_path: str) -> str:
    text_chunks = []
    total_length = 0

    try:
        reader = PdfReader(file_path)

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

    return "\n".join(text_chunks)


def extract_text_from_docx(file_path: str) -> str:
    try:
        doc = Document(file_path)
        parts = []
        total_length = 0
        reached_limit = False

        for paragraph in doc.paragraphs:
            if paragraph.text:
                total_length, reached_limit = _append_with_limit(parts, paragraph.text, total_length)
                if reached_limit:
                    break

        if not reached_limit:
            for table in doc.tables:
                for row in table.rows:
                    for cell in row.cells:
                        if cell.text:
                            total_length, reached_limit = _append_with_limit(parts, cell.text, total_length)
                            if reached_limit:
                                break
                    if reached_limit:
                        break
                if reached_limit:
                    break

        return "\n".join(parts)

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

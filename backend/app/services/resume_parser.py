import re
from pypdf import PdfReader
from docx import Document


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

    try:
        reader = PdfReader(file_path)

        for page in reader.pages:
            try:
                page_text = page.extract_text() or ""
            except Exception:
                page_text = ""

            if page_text:
                text_chunks.append(page_text)

    except Exception as exc:
        raise RuntimeError(f"Failed to read PDF: {exc}") from exc

    return "\n".join(text_chunks)


def extract_text_from_docx(file_path: str) -> str:
    try:
        doc = Document(file_path)
        paragraphs = [paragraph.text for paragraph in doc.paragraphs if paragraph.text]
        return "\n".join(paragraphs)

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

    text = repair_letter_spaced_text(text)

    text = re.sub(r"\r\n|\r", "\n", text)
    text = re.sub(r"[\t]+", " ", text)
    text = re.sub(r"[ ]{2,}", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)

    return text.strip()


def normalize_for_matching(text: str) -> str:
    if not text:
        return ""

    text = repair_letter_spaced_text(text)

    text = text.lower()
    text = re.sub(r"[^a-z0-9+#.\s]", " ", text)
    text = re.sub(r"\s+", " ", text)

    return text.strip()
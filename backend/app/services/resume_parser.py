import io
import logging
import re
import time
import unicodedata
import zipfile
from dataclasses import dataclass, field
from typing import Any, BinaryIO, Iterable, Mapping, Optional, Union

from docx import Document
from docx.oxml.ns import qn
from lxml import etree
from pypdf import PdfReader

from . import ocr, pdf_layout
from .doc_conversion import OLE_SIGNATURE, DocConversionError, convert_doc
from .split_words import repair_split_skill_words

logger = logging.getLogger(__name__)

# Bumped whenever extraction changes in a way that can change the skills read
# from the same file. A saved analysis with an older version was read by an
# older parser, so the dashboard offers to read the original file again.
RESUME_PARSER_VERSION = "2026.09-ocr-columns-doc"

SUPPORTED_RESUME_EXTENSIONS = {"pdf", "docx", "doc"}
MAX_RESUME_BYTES = 5 * 1024 * 1024
MAX_DOCX_ENTRIES = 2000
MAX_DOCX_UNCOMPRESSED_BYTES = 60 * 1024 * 1024
MAX_DOCX_IMAGES_TO_SCAN = 6
MAX_DOCX_IMAGE_BYTES = 4 * 1024 * 1024
MIN_DOCX_IMAGE_WIDTH = 150
MIN_DOCX_IMAGE_HEIGHT = 40
MIN_DOCX_TEXT_WITHOUT_IMAGE_WARNING = 100
# A page with fewer letters than this in its text layer is treated as scanned.
MIN_USABLE_PAGE_CHARS = 40
_CID_MARKER = re.compile(r"\(cid:\d+\)")
_DRAWINGML_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
_DGM_NS = "http://schemas.openxmlformats.org/drawingml/2006/diagram"
_VML_NS = "urn:schemas-microsoft-com:vml"
_SAFE_XML_PARSER = etree.XMLParser(resolve_entities=False, no_network=True, huge_tree=False)

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


# ============================================================
# UPLOAD CHECKS
# ============================================================

UNREADABLE_PDF_MESSAGE = (
    "This PDF could not be read. It may be damaged or incomplete. "
    "Please save or export it again, or upload a DOCX version."
)
UNREADABLE_DOCX_MESSAGE = (
    "This Word document could not be read. It may be damaged. "
    "Please save it again, or upload a PDF version."
)


class ResumeFileError(ValueError):
    """An upload that cannot be read; the message is safe to show the user."""


def resume_extension(filename: str) -> str:
    return str(filename or "").lower().rsplit(".", 1)[-1] if "." in str(filename or "") else ""


def validate_resume_upload(filename: str, file_bytes: bytes) -> str:
    """The file's real format ("pdf", "docx" or "doc"), checked by content, not only by name."""
    extension = resume_extension(filename)
    if extension not in SUPPORTED_RESUME_EXTENSIONS:
        raise ResumeFileError("Please upload a PDF, DOCX or DOC resume.")
    if not file_bytes:
        raise ResumeFileError("Uploaded resume file is empty.")
    if len(file_bytes) > MAX_RESUME_BYTES:
        raise ResumeFileError(f"Resume file must be {MAX_RESUME_BYTES // (1024 * 1024)}MB or smaller.")

    head = file_bytes[:1024]
    if b"%PDF-" in head:
        actual = "pdf"
    elif file_bytes.startswith(b"PK\x03\x04"):
        actual = "docx"
    elif file_bytes.startswith(OLE_SIGNATURE):
        actual = "doc"
    else:
        actual = ""

    if extension == "pdf" and actual != "pdf":
        raise ResumeFileError("This file is not a valid PDF. Please upload a PDF, DOCX or DOC resume.")
    if extension in {"docx", "doc"} and actual not in {"docx", "doc"}:
        if file_bytes.lstrip()[:5] == b"{\\rtf":
            raise ResumeFileError("This file is an RTF document. Please save it as DOCX or PDF and upload it again.")
        raise ResumeFileError("This file is not a valid Word document. Please upload a PDF, DOCX or DOC resume.")
    # A .docx renamed to .doc (or the reverse) is read as what it really is.
    return actual


def _check_docx_archive(file_bytes: bytes) -> None:
    """Refuse zip bombs and archives that are not Word documents before parsing."""
    try:
        with zipfile.ZipFile(io.BytesIO(file_bytes)) as archive:
            entries = archive.infolist()
            if len(entries) > MAX_DOCX_ENTRIES:
                raise ResumeFileError("This Word document has too many parts to read.")
            if sum(entry.file_size for entry in entries) > MAX_DOCX_UNCOMPRESSED_BYTES:
                raise ResumeFileError("This Word document is too large to read once unpacked.")
            names = {entry.filename for entry in entries}
            if "word/document.xml" not in names:
                raise ResumeFileError("This file is not a valid Word document. Please upload a PDF, DOCX or DOC resume.")
            if "EncryptionInfo" in names:
                raise ResumeFileError("This Word document is password-protected. Please remove the password and upload it again.")
    except zipfile.BadZipFile as exc:
        raise ResumeFileError("This Word document is damaged and could not be opened.") from exc


# ============================================================
# EXTRACTION RESULT
# ============================================================

@dataclass
class ResumeExtraction:
    """Text of a resume and how it was obtained."""

    text: str
    source_format: str
    method: str = "text"
    warnings: list[str] = field(default_factory=list)
    pages_read: int = 0
    ocr_pages: list[int] = field(default_factory=list)
    ocr_images: int = 0
    column_pages: list[int] = field(default_factory=list)
    ocr_status: str = "not_needed"

    def metadata(self) -> dict[str, Any]:
        return {
            "parser_version": RESUME_PARSER_VERSION,
            "source_format": self.source_format,
            "method": self.method,
            "pages_read": self.pages_read,
            "ocr_status": self.ocr_status,
            "ocr_pages": list(self.ocr_pages),
            "ocr_images": self.ocr_images,
            "multi_column_pages": list(self.column_pages),
        }


OCR_USED_WARNING = (
    "Part of this resume is a scanned image, so it was read with text recognition (OCR). "
    "Check the extracted skills and add any that were missed."
)
OCR_UNAVAILABLE_WARNING = (
    "This resume looks scanned (image-only), but text recognition (OCR) is not available right now, "
    "so text on the scanned pages could not be read. Upload a text-based PDF or DOCX, or add your skills manually."
)
OCR_FAILED_WARNING = (
    "This resume looks scanned (image-only), and text recognition (OCR) could not read it. "
    "Upload a clearer scan, a text-based PDF or a DOCX, or add your skills manually."
)
OCR_PAGE_LIMIT_WARNING = (
    "Only the first {count} scanned pages were read with text recognition (OCR); later scanned pages were skipped."
)
PAGE_LIMIT_WARNING = "Only the first {count} pages of this resume were read."
DOCX_IMAGE_OCR_USED_WARNING = (
    "Text inside images in this document was read with text recognition (OCR). "
    "Check the extracted skills and add any that were missed."
)
DOCX_IMAGE_OCR_FAILED_WARNING = (
    "Images in this document could not be read with text recognition (OCR). "
    "Add any skills that appear only inside images manually."
)


def _usable_chars(text: str) -> int:
    """Letters in real words, ignoring undecodable-glyph markers such as "(cid:12)"."""
    text = _CID_MARKER.sub(" ", text or "")
    return sum(len(word) for word in re.findall(r"[A-Za-z]{2,}", text))


def _ocr_lines(text: str) -> list[str]:
    """OCR output without the noise lines a photo, border or logo produces."""
    lines = []
    for line in normalize_extracted_text(text).splitlines():
        line = re.sub(r"[ \t]+", " ", line).strip(" |_~-=")
        if not line:
            continue
        letters = sum(char.isalpha() for char in line)
        words = re.findall(r"[A-Za-z]{2,}", line)
        if letters < 3 or letters < 0.5 * len(line.replace(" ", "")) or not any(len(word) >= 3 for word in words):
            continue
        lines.append(line)
    return lines


# ============================================================
# PDF
# ============================================================

def _read_source_bytes(source: Union[str, BinaryIO, bytes]) -> bytes:
    if isinstance(source, (bytes, bytearray)):
        return bytes(source)
    if isinstance(source, str):
        with open(source, "rb") as handle:
            return handle.read(MAX_RESUME_BYTES + 1)
    return source.read()


def _pdf_layout_text(plumber_pdf: Any, page_index: int) -> tuple[Optional[str], bool]:
    """(text in column reading order, True) for a multi-column page, else (None, False)."""
    if plumber_pdf is None:
        return None, False
    try:
        words = pdf_layout.page_words(plumber_pdf.pages[page_index])
        if words and pdf_layout.detect_columns(words):
            return "\n".join(pdf_layout.order_words(words)), True
    except Exception:
        pass
    return None, False


def _render_pdf_page(pdfium_doc: Any, page_index: int) -> Any:
    page = pdfium_doc[page_index]
    try:
        width, height = page.get_size()
        scale = ocr.OCR_DPI / 72.0
        pixels = width * height * scale * scale
        if pixels > ocr.OCR_MAX_PIXELS:
            scale *= (ocr.OCR_MAX_PIXELS / pixels) ** 0.5
        bitmap = page.render(scale=scale, grayscale=True)
        try:
            return bitmap.to_pil()
        finally:
            bitmap.close()
    finally:
        page.close()


def extract_pdf_document(source: Union[str, BinaryIO, bytes], use_ocr: bool = True) -> ResumeExtraction:
    """Text of a PDF: the text layer in reading order, and OCR for pages without one."""
    data = _read_source_bytes(source)
    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            # Many resumes are "encrypted" with an empty password to block editing.
            if not reader.decrypt(""):
                raise ResumeFileError("This PDF is password-protected. Please remove the password and upload it again.")
        page_count = len(reader.pages)
    except ResumeFileError:
        raise
    except Exception as exc:
        # A damaged or cut-off file: the user can fix it, so it is their error
        # to see, without the PDF library's wording.
        logger.warning("Unreadable PDF upload: %s", exc)
        raise ResumeFileError(UNREADABLE_PDF_MESSAGE) from exc

    result = ResumeExtraction(text="", source_format="pdf")
    pages_to_read = min(page_count, MAX_RESUME_PAGES)
    if page_count > MAX_RESUME_PAGES:
        result.warnings.append(PAGE_LIMIT_WARNING.format(count=MAX_RESUME_PAGES))

    plumber_pdf = None
    try:
        import pdfplumber

        plumber_pdf = pdfplumber.open(io.BytesIO(data))
    except Exception:
        plumber_pdf = None

    page_texts: list[str] = []
    scanned_pages: list[int] = []
    try:
        for page_index in range(pages_to_read):
            try:
                page_text = reader.pages[page_index].extract_text() or ""
            except Exception:
                page_text = ""
            layout_text, is_multi_column = _pdf_layout_text(plumber_pdf, page_index)
            if is_multi_column and _usable_chars(layout_text) >= 0.8 * _usable_chars(page_text):
                page_text = layout_text or ""
                result.column_pages.append(page_index + 1)
            page_text = _CID_MARKER.sub(" ", page_text)
            if _usable_chars(page_text) < MIN_USABLE_PAGE_CHARS:
                scanned_pages.append(page_index)
            page_texts.append(page_text)
    finally:
        if plumber_pdf is not None:
            plumber_pdf.close()

    result.pages_read = pages_to_read
    if scanned_pages and use_ocr:
        _ocr_pdf_pages(data, scanned_pages, page_texts, result)
    elif scanned_pages:
        result.ocr_status = "skipped"

    parts: list[str] = []
    total_length = 0
    for page_text in page_texts:
        if not page_text.strip():
            continue
        total_length, reached_limit = _append_with_limit(parts, page_text, total_length)
        if reached_limit:
            break
    result.text = normalize_extracted_text("\n".join(parts))
    if result.ocr_pages:
        result.method = "text+ocr" if len(result.ocr_pages) < pages_to_read else "ocr"
    return result


def _ocr_pdf_pages(data: bytes, scanned_pages: list[int], page_texts: list[str], result: ResumeExtraction) -> None:
    if not ocr.ocr_available():
        result.ocr_status = "unavailable"
        result.warnings.append(OCR_UNAVAILABLE_WARNING)
        return
    try:
        import pypdfium2 as pdfium
    except Exception:
        result.ocr_status = "unavailable"
        result.warnings.append(OCR_UNAVAILABLE_WARNING)
        return

    budget = ocr.OcrBudget()
    failures = 0
    skipped = 0
    try:
        pdfium_doc = pdfium.PdfDocument(data)
    except Exception:
        result.ocr_status = "failed"
        result.warnings.append(OCR_FAILED_WARNING)
        return
    try:
        for page_index in scanned_pages:
            if not budget.take_page():
                skipped += 1
                continue
            try:
                image = _render_pdf_page(pdfium_doc, page_index)
                lines = _ocr_lines(ocr.ocr_image(image, budget))
            except Exception:  # OcrFailed, OcrUnavailable, or an image that would not render
                failures += 1
                continue
            recognised = "\n".join(lines)
            if _usable_chars(recognised) > _usable_chars(page_texts[page_index]):
                page_texts[page_index] = recognised
                result.ocr_pages.append(page_index + 1)
    finally:
        pdfium_doc.close()

    attempted = len(scanned_pages) - skipped
    if result.ocr_pages:
        result.ocr_status = "partial" if failures or skipped else "used"
        result.warnings.append(OCR_USED_WARNING)
        if failures:
            result.warnings.append(OCR_FAILED_WARNING)
    elif failures:
        result.ocr_status = "failed"
        result.warnings.append(OCR_FAILED_WARNING)
    elif attempted:
        # Recognition ran and found no text: blank pages or pure graphics.
        result.ocr_status = "no_text"
    if skipped:
        result.warnings.append(OCR_PAGE_LIMIT_WARNING.format(count=ocr.OCR_MAX_PAGES))


def extract_text_from_pdf(source: Union[str, BinaryIO, bytes]) -> str:
    """Text of a PDF (a path, bytes or a binary stream)."""
    return extract_pdf_document(source).text


# ============================================================
# DOCX
# ============================================================

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


def _docx_smartart_texts(document_part: Any) -> list[str]:
    """Text of SmartArt diagrams (a skills "graphic" in many templates).

    The text lives in the diagram's data part; its drawing part repeats it for
    display, so only the data part is read.
    """
    texts: list[str] = []
    for relationship in document_part.rels.values():
        if relationship.is_external or not str(relationship.reltype).endswith("/diagramData"):
            continue
        try:
            root = etree.fromstring(relationship.target_part.blob, parser=_SAFE_XML_PARSER)
        except Exception:
            continue
        for point in root.iter(f"{{{_DGM_NS}}}pt"):
            if point.get("type") not in (None, "node"):
                continue
            text = "".join(node.text or "" for node in point.iter(f"{{{_DRAWINGML_NS}}}t")).strip()
            if text:
                texts.append(text)
    return texts


def _docx_image_parts(root: Any, document_part: Any) -> list[Any]:
    """Image parts shown in the body, once each; VML fallbacks of the same picture are skipped."""
    seen: set[str] = set()
    parts: list[Any] = []
    for node in root.iter(f"{{{_DRAWINGML_NS}}}blip", f"{{{_VML_NS}}}imagedata"):
        if any(ancestor.tag == _MC_FALLBACK for ancestor in node.iterancestors()):
            continue
        rel_id = node.get(qn("r:embed")) or node.get(qn("r:id"))
        if not rel_id or rel_id not in document_part.rels:
            continue
        relationship = document_part.rels[rel_id]
        if relationship.is_external:
            continue
        part = relationship.target_part
        name = str(getattr(part, "partname", rel_id))
        if name in seen:
            continue
        seen.add(name)
        parts.append(part)
    return parts


def _ocr_docx_images(image_parts: list[Any], known_lines: set[str], result: ResumeExtraction) -> list[str]:
    """Text recognised in embedded images that the document text does not already contain."""
    candidates = []
    for part in image_parts[:MAX_DOCX_IMAGES_TO_SCAN]:
        blob = getattr(part, "blob", b"") or b""
        if not blob or len(blob) > MAX_DOCX_IMAGE_BYTES:
            continue
        image = ocr.open_image_safely(blob)
        if image is None:
            continue
        width, height = image.size
        # Icons, bullets and dividers are too small to hold a line of text.
        if width < MIN_DOCX_IMAGE_WIDTH or height < MIN_DOCX_IMAGE_HEIGHT:
            continue
        candidates.append(image)
    if not candidates:
        return []
    if not ocr.ocr_available():
        result.ocr_status = "unavailable"
        return []

    budget = ocr.OcrBudget()
    lines: list[str] = []
    failures = 0
    for image in candidates:
        if not budget.take_page():
            break
        try:
            recognised = _ocr_lines(ocr.ocr_image(image, budget))
        except Exception:  # OcrFailed, OcrUnavailable, or an image that would not render
            failures += 1
            continue
        new_lines = []
        for line in recognised:
            key = _line_key(line)
            if key and key not in known_lines:
                known_lines.add(key)
                new_lines.append(line)
        if new_lines:
            result.ocr_images += 1
            lines.extend(new_lines)
    if result.ocr_images:
        result.ocr_status = "used"
    elif failures:
        result.ocr_status = "failed"
    else:
        result.ocr_status = "no_text"
    return lines


def _line_key(line: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", normalize_extracted_text(line).lower())


def extract_docx_document(source: Union[str, BinaryIO, bytes], use_ocr: bool = True) -> ResumeExtraction:
    """Text of a DOCX resume: body, headers, footers, text boxes, SmartArt and text in images."""
    data = _read_source_bytes(source)
    _check_docx_archive(data)
    result = ResumeExtraction(text="", source_format="docx")
    try:
        doc = Document(io.BytesIO(data))
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

        texts: list[str] = []
        seen_roots = set()
        for root in roots:
            if id(root) in seen_roots:
                continue
            seen_roots.add(id(root))
            texts.extend(_docx_paragraph_texts(root))
        known_lines = {_line_key(text) for text in texts}
        for text in _docx_smartart_texts(doc.part):
            key = _line_key(text)
            if key and key not in known_lines:
                known_lines.add(key)
                texts.append(text)

        if use_ocr:
            image_parts = _docx_image_parts(doc.element.body, doc.part)
            ocr_lines = _ocr_docx_images(image_parts, known_lines, result)
            if ocr_lines:
                texts.extend(ocr_lines)
                result.method = "text+ocr"
                result.warnings.append(DOCX_IMAGE_OCR_USED_WARNING)
            elif result.ocr_status == "failed" or (
                result.ocr_status == "unavailable" and _usable_chars("\n".join(texts)) < MIN_DOCX_TEXT_WITHOUT_IMAGE_WARNING
            ):
                # Without OCR, only warn when the images may hold the resume itself:
                # a headshot or logo beside a full text resume is not worth one.
                result.warnings.append(DOCX_IMAGE_OCR_FAILED_WARNING)

        for text in texts:
            total_length, reached_limit = _append_with_limit(parts, text, total_length)
            if reached_limit:
                break
        result.text = normalize_extracted_text("\n".join(parts))
        return result

    except ResumeFileError:
        raise
    except Exception as exc:
        logger.warning("Unreadable DOCX upload: %s", exc)
        raise ResumeFileError(UNREADABLE_DOCX_MESSAGE) from exc


def extract_text_from_docx(source: Union[str, BinaryIO, bytes]) -> str:
    """Text of a DOCX resume (a path, bytes or a binary stream), headers included."""
    return extract_docx_document(source).text


# ============================================================
# DOC (Word 97-2003)
# ============================================================

def extract_doc_document(data: bytes, use_ocr: bool = True) -> ResumeExtraction:
    """Text of a legacy .doc resume, converted by LibreOffice or antiword."""
    try:
        kind, converted = convert_doc(data)
    except DocConversionError as exc:
        raise ResumeFileError(str(exc)) from exc
    if kind == "docx":
        result = extract_docx_document(converted, use_ocr=use_ocr)
    else:
        text = str(converted)[:MAX_RESUME_TEXT_CHARS]
        # antiword marks pictures with "[pic]"; they carry no text.
        text = re.sub(r"\[pic\]", " ", text)
        result = ResumeExtraction(text=normalize_extracted_text(text), source_format="doc")
    result.source_format = "doc"
    result.method = f"converted_{kind}" if result.method == "text" else f"converted_{kind}+ocr"
    return result


# ============================================================
# ENTRY POINTS
# ============================================================

def extract_resume_document(
    file_bytes: bytes,
    filename: str,
    split_word_vocabulary: Optional[Mapping[str, tuple[str, ...]]] = None,
    known_phrases: Iterable[str] = (),
    use_ocr: bool = True,
) -> ResumeExtraction:
    """Validated, extracted and repaired text of an uploaded resume.

    ``split_word_vocabulary`` (see split_words.py) rejoins skill names the
    document split into pieces. Raises ResumeFileError for files that cannot
    be read, with a message meant for the user.
    """
    kind = validate_resume_upload(filename, file_bytes)
    started = time.monotonic()
    if kind == "pdf":
        result = extract_pdf_document(file_bytes, use_ocr=use_ocr)
    elif kind == "docx":
        result = extract_docx_document(file_bytes, use_ocr=use_ocr)
    else:
        result = extract_doc_document(file_bytes, use_ocr=use_ocr)
    if split_word_vocabulary:
        result.text = repair_split_skill_words(result.text, split_word_vocabulary, known_phrases)
    logger.info(
        "Resume text extracted",
        extra={
            "source_format": result.source_format,
            "method": result.method,
            "ocr_status": result.ocr_status,
            "text_length": len(result.text),
            "elapsed_ms": round((time.monotonic() - started) * 1000, 1),
        },
    )
    return result


def extract_resume_text(file_path: str) -> str:
    extension = resume_extension(file_path)
    if extension not in SUPPORTED_RESUME_EXTENSIONS:
        raise ValueError("Unsupported file type for resume extraction")
    with open(file_path, "rb") as handle:
        data = handle.read(MAX_RESUME_BYTES + 1)
    return extract_resume_document(data, file_path).text


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

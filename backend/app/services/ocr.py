"""Text recognition (OCR) for scanned resume pages and images in documents.

Tesseract runs as a subprocess that reads the image from stdin and writes text
to stdout, so no copy of a resume page is written to disk. Every call has a
timeout, images are size-checked before decoding, and a semaphore keeps a burst
of scanned uploads from running more than a couple of OCR jobs at once.
"""
import io
import os
import shutil
import subprocess
import threading
import time
from typing import Optional

from PIL import Image

# Tesseract is fastest and most accurate on text around 10-12pt at 200-300 DPI.
OCR_DPI = 250
# A page rendered larger than this is scaled down before recognition. A US
# Letter page at 250 DPI is about 5.8 megapixels.
OCR_MAX_PIXELS = 12_000_000
# Scanned resumes are one to three pages; anything past this is not read.
OCR_MAX_PAGES = 5
OCR_PAGE_TIMEOUT_SECONDS = 25
# Stop starting new pages once one document has used this much OCR time.
OCR_TOTAL_BUDGET_SECONDS = 60
OCR_MAX_CONCURRENT = max(1, int(os.getenv("KAREERLY_OCR_MAX_CONCURRENT", "2") or 2))
OCR_LANGUAGES = os.getenv("KAREERLY_OCR_LANGUAGES", "eng") or "eng"

_ocr_slots = threading.BoundedSemaphore(OCR_MAX_CONCURRENT)


class OcrUnavailable(RuntimeError):
    """The tesseract binary is not installed on this server."""


class OcrFailed(RuntimeError):
    """Tesseract ran but did not return text (timeout, crash or unreadable image)."""


def tesseract_path() -> Optional[str]:
    configured = os.getenv("KAREERLY_TESSERACT_CMD", "").strip()
    if configured:
        return configured if os.path.isfile(configured) and os.access(configured, os.X_OK) else None
    return shutil.which("tesseract")


def ocr_available() -> bool:
    return tesseract_path() is not None


class OcrBudget:
    """Wall-clock OCR allowance for one document."""

    def __init__(self, seconds: Optional[float] = None, max_pages: Optional[int] = None):
        self.deadline = time.monotonic() + (OCR_TOTAL_BUDGET_SECONDS if seconds is None else seconds)
        self.pages_left = OCR_MAX_PAGES if max_pages is None else max_pages

    def remaining(self) -> float:
        return self.deadline - time.monotonic()

    def take_page(self) -> bool:
        if self.pages_left <= 0 or self.remaining() <= 1:
            return False
        self.pages_left -= 1
        return True


def _png_bytes(image: Image.Image) -> bytes:
    if image.mode not in {"L", "RGB"}:
        image = image.convert("RGB")
    # Grayscale is enough for OCR and a third of the size to pipe.
    image = image.convert("L")
    width, height = image.size
    if width * height > OCR_MAX_PIXELS:
        scale = (OCR_MAX_PIXELS / float(width * height)) ** 0.5
        image = image.resize((max(1, int(width * scale)), max(1, int(height * scale))))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def ocr_image(image: Image.Image, budget: Optional[OcrBudget] = None) -> str:
    """Recognised text of one image. Raises OcrUnavailable or OcrFailed."""
    command = tesseract_path()
    if not command:
        raise OcrUnavailable("Text recognition (OCR) is not installed on the server.")

    timeout = OCR_PAGE_TIMEOUT_SECONDS
    if budget is not None:
        timeout = max(1.0, min(timeout, budget.remaining()))

    payload = _png_bytes(image)
    env = {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        # One thread per page: several requests may OCR at once on a small instance.
        "OMP_THREAD_LIMIT": "1",
    }
    if os.environ.get("TESSDATA_PREFIX"):
        env["TESSDATA_PREFIX"] = os.environ["TESSDATA_PREFIX"]

    with _ocr_slots:
        try:
            completed = subprocess.run(
                [command, "stdin", "stdout", "-l", OCR_LANGUAGES, "--psm", "3"],
                input=payload,
                capture_output=True,
                timeout=timeout,
                env=env,
                check=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise OcrFailed("Text recognition timed out.") from exc
        except OSError as exc:
            raise OcrFailed(f"Text recognition could not start: {exc}") from exc

    if completed.returncode != 0:
        detail = completed.stderr.decode("utf-8", "replace").strip().splitlines()
        raise OcrFailed(f"Text recognition failed: {detail[-1] if detail else completed.returncode}")
    return completed.stdout.decode("utf-8", "replace")


def open_image_safely(data: bytes, max_pixels: int = OCR_MAX_PIXELS * 4) -> Optional[Image.Image]:
    """Decode an embedded image, refusing decompression bombs and unknown formats."""
    try:
        with Image.open(io.BytesIO(data)) as probe:
            width, height = probe.size
            if width * height > max_pixels:
                return None
            probe.load()
            return probe.copy()
    except Exception:
        return None

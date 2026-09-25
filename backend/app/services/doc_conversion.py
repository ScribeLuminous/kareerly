"""Read legacy Word 97-2003 (.doc) resumes through an external converter.

python-docx cannot open the binary .doc format. Two converters are supported:

* LibreOffice (``soffice``), when installed, converts the file to DOCX so it goes
  through the same reader as a DOCX upload (tables, text boxes, headers).
* antiword, a small text-only reader, is used otherwise.

Both run without a shell, with a timeout, in a private temporary directory that
is deleted afterwards, so neither the upload nor the converted copy is kept.
LibreOffice gets a throwaway profile, and headless conversion never runs
document macros.
"""
import os
import shutil
import signal
import subprocess
import tempfile
import threading
from pathlib import Path
from typing import Optional

OLE_SIGNATURE = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
DOC_CONVERSION_TIMEOUT_SECONDS = 45
# The converted DOCX or text is read by the normal limits; this only bounds what
# a converter may write before we stop reading it.
MAX_CONVERTED_BYTES = 20 * 1024 * 1024
_conversion_slots = threading.BoundedSemaphore(max(1, int(os.getenv("KAREERLY_DOC_MAX_CONCURRENT", "2") or 2)))


class DocConversionError(RuntimeError):
    """The .doc file could not be converted; the message is safe to show users."""


def _which(env_name: str, *names: str) -> Optional[str]:
    configured = os.getenv(env_name, "").strip()
    if configured:
        return configured if os.path.isfile(configured) and os.access(configured, os.X_OK) else None
    for name in names:
        found = shutil.which(name)
        if found:
            return found
    return None


def soffice_path() -> Optional[str]:
    return _which("KAREERLY_SOFFICE_CMD", "soffice", "libreoffice")


def antiword_path() -> Optional[str]:
    return _which("KAREERLY_ANTIWORD_CMD", "antiword")


def doc_conversion_available() -> bool:
    return bool(soffice_path() or antiword_path())


def _run(command: list[str], workdir: str, timeout: float) -> subprocess.CompletedProcess:
    env = {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "HOME": workdir,
        "TMPDIR": workdir,
        "LANG": "C.UTF-8",
        "LC_ALL": "C.UTF-8",
    }
    antiword_home = os.environ.get("ANTIWORDHOME")
    if antiword_home:
        env["ANTIWORDHOME"] = antiword_home
    process = subprocess.Popen(
        command,
        cwd=workdir,
        env=env,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        start_new_session=True,
    )
    try:
        stdout, stderr = process.communicate(timeout=timeout)
    except subprocess.TimeoutExpired as exc:
        # LibreOffice starts helper processes; stop the whole group.
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except OSError:
            process.kill()
        process.communicate()
        raise DocConversionError("Converting the .doc file took too long. Please save it as DOCX or PDF and upload it again.") from exc
    return subprocess.CompletedProcess(command, process.returncode, stdout[:MAX_CONVERTED_BYTES], stderr[-4000:])


def convert_doc_with_soffice(file_bytes: bytes, timeout: float = DOC_CONVERSION_TIMEOUT_SECONDS) -> bytes:
    """DOCX bytes of a .doc file, converted by LibreOffice."""
    command = soffice_path()
    if not command:
        raise DocConversionError("LibreOffice is not installed on the server.")
    with tempfile.TemporaryDirectory(prefix="kareerly-doc-") as workdir:
        os.chmod(workdir, 0o700)
        source = Path(workdir) / "resume.doc"
        source.write_bytes(file_bytes)
        os.chmod(source, 0o600)
        profile = Path(workdir) / "profile"
        result = _run(
            [
                command,
                f"-env:UserInstallation={profile.as_uri()}",
                "--headless", "--invisible", "--norestore", "--nolockcheck", "--nodefault", "--nologo",
                "--convert-to", "docx:MS Word 2007 XML",
                "--outdir", workdir,
                str(source),
            ],
            workdir,
            timeout,
        )
        converted = Path(workdir) / "resume.docx"
        if result.returncode != 0 or not converted.exists():
            raise DocConversionError("The .doc file could not be converted. Please save it as DOCX or PDF and upload it again.")
        if converted.stat().st_size > MAX_CONVERTED_BYTES:
            raise DocConversionError("The converted .doc file is too large to read.")
        return converted.read_bytes()


def convert_doc_with_antiword(file_bytes: bytes, timeout: float = DOC_CONVERSION_TIMEOUT_SECONDS) -> str:
    """Plain text of a .doc file, read by antiword."""
    command = antiword_path()
    if not command:
        raise DocConversionError("antiword is not installed on the server.")
    with tempfile.TemporaryDirectory(prefix="kareerly-doc-") as workdir:
        os.chmod(workdir, 0o700)
        source = Path(workdir) / "resume.doc"
        source.write_bytes(file_bytes)
        os.chmod(source, 0o600)
        # -w 0: no re-wrapping, so words are not split at an arbitrary width.
        result = _run([command, "-m", "UTF-8.txt", "-w", "0", str(source)], workdir, timeout)
        if result.returncode != 0:
            detail = result.stderr.decode("utf-8", "replace").lower()
            if "rich text" in detail or "rtf" in detail:
                raise DocConversionError("This .doc file is really an RTF document. Please save it as DOCX or PDF and upload it again.")
            if "encrypt" in detail or "password" in detail:
                raise DocConversionError("This .doc file is password-protected. Please remove the password and upload it again.")
            raise DocConversionError("The .doc file could not be read. Please save it as DOCX or PDF and upload it again.")
        return result.stdout.decode("utf-8", "replace")


def convert_doc(file_bytes: bytes) -> tuple[str, bytes | str]:
    """("docx", DOCX bytes) from LibreOffice, else ("text", text) from antiword."""
    if not file_bytes.startswith(OLE_SIGNATURE):
        if file_bytes.lstrip()[:5] == b"{\\rtf":
            raise DocConversionError("This .doc file is really an RTF document. Please save it as DOCX or PDF and upload it again.")
        raise DocConversionError("This file is not a Word 97-2003 document. Please upload a PDF, DOCX or DOC resume.")
    if not doc_conversion_available():
        raise DocConversionError(
            "Old Word (.doc) files cannot be read on this server yet. Please save the resume as DOCX or PDF and upload it again."
        )
    errors: list[DocConversionError] = []
    with _conversion_slots:
        if soffice_path():
            try:
                return "docx", convert_doc_with_soffice(file_bytes)
            except DocConversionError as exc:
                errors.append(exc)
        if antiword_path():
            try:
                return "text", convert_doc_with_antiword(file_bytes)
            except DocConversionError as exc:
                errors.append(exc)
    raise errors[-1]

"""Build the resume fixtures used by test_resume_formats.py.

Run from the repository root:

    python -m backend.tests.fixtures.resumes.build_fixtures

The files are committed, so tests do not need these tools; rebuilding needs
Pillow, python-docx and, for the .doc file, LibreOffice (``soffice``). Every
resume is fictional.
"""
import io
import shutil
import subprocess
import tempfile
import zlib
from pathlib import Path

from docx import Document
from docx.opc.constants import RELATIONSHIP_TYPE as RT
from docx.opc.packuri import PackURI
from docx.opc.part import Part
from docx.oxml import parse_xml
from docx.shared import Inches
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
]


# ------------------------------------------------------------------
# PDF with positioned text runs
# ------------------------------------------------------------------

def _escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def positioned_text_pdf(pages: list[list[tuple[float, float, str]]], size: float = 10.5) -> bytes:
    """A PDF whose pages draw (x, y, text) runs in the given order.

    The order of the runs is the order of the content stream, which is what
    plain extraction follows; drawing two columns row by row reproduces the
    interleaving seen in resumes exported from design tools.
    """
    objects: list[bytes] = [b"<< /Type /Catalog /Pages 2 0 R >>", b""]
    font_number = 3
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
    page_numbers = []
    streams: list[tuple[int, bytes]] = []
    for runs in pages:
        content = " ".join(
            f"BT /F1 {size} Tf 1 0 0 1 {x:.1f} {y:.1f} Tm ({_escape(text)}) Tj ET" for x, y, text in runs
        ).encode("latin-1")
        page_number = len(objects) + 1
        content_number = page_number + 1
        objects.append(
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 {font_number} 0 R >> >> "
            f"/Contents {content_number} 0 R >>".encode()
        )
        objects.append(b"")
        streams.append((content_number, zlib.compress(content)))
        page_numbers.append(page_number)
    kids = " ".join(f"{number} 0 R" for number in page_numbers)
    objects[1] = f"<< /Type /Pages /Kids [{kids}] /Count {len(page_numbers)} >>".encode()
    stream_by_number = dict(streams)

    out = io.BytesIO()
    out.write(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(out.tell())
        if number in stream_by_number:
            data = stream_by_number[number]
            out.write(f"{number} 0 obj << /Length {len(data)} /Filter /FlateDecode >> stream\n".encode())
            out.write(data + b"\nendstream endobj\n")
        else:
            out.write(f"{number} 0 obj ".encode() + body + b" endobj\n")
    xref = out.tell()
    out.write(f"xref\n0 {len(offsets) + 1}\n0000000000 65535 f \n".encode())
    for offset in offsets:
        out.write(f"{offset:010d} 00000 n \n".encode())
    out.write(f"trailer << /Size {len(offsets) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
    return out.getvalue()


def two_column_pdf() -> bytes:
    """A sidebar resume: skills on the left, experience on the right, stored row by row."""
    header = [
        (220, 750, "Andrea Villanueva"),
        (72, 728, "Customer support specialist helping retail and e-commerce brands answer customers quickly."),
    ]
    left = ["SKILLS", "Customer", "Service", "Microsoft", "Excel", "Data Entry", "Filipino and English"]
    right = [
        "WORK EXPERIENCE",
        "Support Agent, Example Retail Co",
        "2021 - Present",
        "Answered tickets in Zendesk and kept",
        "invoices up to date in QuickBooks.",
        "Trained four new agents.",
        "Team Lead, Sample Shop",
    ]
    runs = list(header)
    for row, (left_text, right_text) in enumerate(zip(left, right)):
        y = 690 - 16 * row
        runs.append((72, y, left_text))
        runs.append((250, y, right_text))
    runs.append((72, 540, "EDUCATION  Bachelor of Science in Business Administration, Example University, 2020"))
    return positioned_text_pdf([runs])


def split_words_pdf() -> bytes:
    """Skill names split by glyph gaps, a font change and line wraps, plus a decoy phrase."""
    runs = [
        (72, 750, "Rafael Domingo"),
        (72, 728, "Sales operations assistant. Led a sales force of 12 agents across two branches."),
        (72, 700, "SKILLS"),
        # "Sales force": two runs with a gap, as a kerned or re-encoded word comes out.
        (72, 684, "CRM: Sales"), (130, 684, "force"), (170, 684, "and Hub"), (214, 684, "Spot"),
        # "Quick Books": split before the capital letter.
        (72, 668, "Bookkeeping in Quick"), (180, 668, "Books"),
        # "Zen" / "desk": a word wrapped onto the next line without a hyphen.
        (72, 652, "Support tickets in Zen"),
        (72, 638, "desk and reports in Java"),
        (72, 624, "Script dashboards"),
        (72, 596, "EXPERIENCE"),
        (72, 580, "Sales Operations Assistant, Example Trading, 2022 - Present"),
    ]
    return positioned_text_pdf([runs])


def decoy_pdf() -> bytes:
    """Ordinary phrases that must not become skills when split words are rejoined."""
    runs = [
        (72, 750, "Carmela Reyes"),
        (72, 728, "Store supervisor. Led a sales force of 12 agents and won the Sales Force Award 2022."),
        (72, 712, "Wrote a quick books summary for the owner each month."),
        (72, 696, "SKILLS  Customer Service, Inventory Management, Cash Handling"),
        (72, 668, "EXPERIENCE  Store Supervisor, Example Mart, 2019 - Present"),
    ]
    return positioned_text_pdf([runs])


# ------------------------------------------------------------------
# Scanned pages
# ------------------------------------------------------------------

def _font(size: int) -> ImageFont.FreeTypeFont:
    for candidate in FONT_CANDIDATES:
        if Path(candidate).exists():
            return ImageFont.truetype(candidate, size)
    raise SystemExit("No TrueType font found; install fonts-dejavu to rebuild the fixtures.")


def text_image(lines: list[str], width: int = 1700, height: int = 2200, size: int = 34, top: int = 150) -> Image.Image:
    """A page image of the lines, as a 200 DPI scan of a Letter page would look."""
    image = Image.new("L", (width, height), 255)
    draw = ImageDraw.Draw(image)
    font = _font(size)
    y = top
    for line in lines:
        if line:
            draw.text((150, y), line, fill=0, font=font)
        y += int(size * 1.6)
    return image


SCANNED_LINES = [
    "Marites Santos",
    "Accounting assistant | Quezon City",
    "",
    "SKILLS",
    "Customer Service, Zendesk, Microsoft Excel",
    "QuickBooks, Salesforce, Data Entry",
    "",
    "WORK EXPERIENCE",
    "Accounts Assistant, Example Foods Inc., 2020 - Present",
    "Prepared invoices and reconciled payments every week.",
    "",
    "EDUCATION",
    "Bachelor of Science in Accountancy, Example University, 2019",
]


def scanned_pdf() -> bytes:
    """An image-only PDF: no text layer at all."""
    buffer = io.BytesIO()
    text_image(SCANNED_LINES).save(buffer, format="PDF", resolution=200.0)
    return buffer.getvalue()


def mixed_pdf() -> bytes:
    """Page 1 has a text layer; page 2 is a scanned skills page."""
    from pypdf import PdfReader, PdfWriter

    text_page = positioned_text_pdf([[
        (72, 750, "Marites Santos"),
        (72, 728, "Accounting assistant with four years of experience in food manufacturing."),
        (72, 700, "WORK EXPERIENCE"),
        (72, 684, "Accounts Assistant, Example Foods Inc., 2020 - Present"),
        (72, 668, "Prepared invoices and reconciled payments every week."),
    ]])
    scan = io.BytesIO()
    text_image(["SKILLS", "Zendesk, QuickBooks, Salesforce", "Microsoft Excel, Data Entry"]).save(
        scan, format="PDF", resolution=200.0)
    writer = PdfWriter()
    for source in (text_page, scan.getvalue()):
        for page in PdfReader(io.BytesIO(source)).pages:
            writer.add_page(page)
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


# ------------------------------------------------------------------
# DOCX with a text box, an image and SmartArt
# ------------------------------------------------------------------

_TEXT_BOX_RUN = """
<w:r xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
     xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
     xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
     xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
     xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
     xmlns:v="urn:schemas-microsoft-com:vml">
  <mc:AlternateContent>
    <mc:Choice Requires="wps">
      <w:drawing>
        <wp:inline distT="0" distB="0" distL="0" distR="0">
          <wp:extent cx="2743200" cy="457200"/>
          <wp:docPr id="10" name="Tools box"/>
          <a:graphic>
            <a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
              <wps:wsp>
                <wps:cNvSpPr txBox="1"/>
                <wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2743200" cy="457200"/></a:xfrm>
                  <a:prstGeom prst="rect"><a:avLst/></a:prstGeom></wps:spPr>
                <wps:txbx>
                  <w:txbxContent>
                    <w:p><w:r><w:t>Tools: Zendesk and HubSpot</w:t></w:r></w:p>
                  </w:txbxContent>
                </wps:txbx>
                <wps:bodyPr/>
              </wps:wsp>
            </a:graphicData>
          </a:graphic>
        </wp:inline>
      </w:drawing>
    </mc:Choice>
    <mc:Fallback>
      <w:pict>
        <v:shape style="width:216pt;height:36pt" type="#_x0000_t202">
          <v:textbox>
            <w:txbxContent>
              <w:p><w:r><w:t>Tools: Zendesk and HubSpot</w:t></w:r></w:p>
            </w:txbxContent>
          </v:textbox>
        </v:shape>
      </w:pict>
    </mc:Fallback>
  </mc:AlternateContent>
</w:r>
"""

_SMARTART_DATA = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<dgm:dataModel xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram"
               xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <dgm:ptLst>
    <dgm:pt modelId="{00000000-0000-0000-0000-000000000000}" type="doc"><dgm:t><a:bodyPr/><a:p><a:endParaRPr/></a:p></dgm:t></dgm:pt>
    <dgm:pt modelId="{00000000-0000-0000-0000-000000000001}"><dgm:t><a:bodyPr/><a:p><a:r><a:t>Customer Service</a:t></a:r></a:p></dgm:t></dgm:pt>
    <dgm:pt modelId="{00000000-0000-0000-0000-000000000002}"><dgm:t><a:bodyPr/><a:p><a:r><a:t>Data Entry</a:t></a:r></a:p></dgm:t></dgm:pt>
  </dgm:ptLst>
  <dgm:cxnLst/>
</dgm:dataModel>
"""

# Word stores a rendered copy of the diagram too; its text must not be read twice.
_SMARTART_DRAWING = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<dsp:drawing xmlns:dsp="http://schemas.microsoft.com/office/drawing/2008/diagram"
             xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <dsp:spTree><dsp:sp><dsp:txBody><a:p><a:r><a:t>Customer Service</a:t></a:r></a:p></dsp:txBody></dsp:sp>
  <dsp:sp><dsp:txBody><a:p><a:r><a:t>Data Entry</a:t></a:r></a:p></dsp:txBody></dsp:sp></dsp:spTree>
</dsp:drawing>
"""


def embedded_content_docx() -> bytes:
    document = Document()
    document.add_paragraph("Joanna Lim")
    document.add_paragraph("Customer care representative for an online grocery.")
    paragraph = document.add_paragraph()
    paragraph._p.append(parse_xml(_TEXT_BOX_RUN))
    document.add_paragraph("CERTIFICATES")
    image = io.BytesIO()
    text_image(["Certified in QuickBooks and Salesforce"], width=1400, height=140, size=40, top=40).save(image, format="PNG")
    document.add_picture(io.BytesIO(image.getvalue()), width=Inches(5))
    # The same picture again (a repeated banner): one image part, read once.
    document.add_picture(io.BytesIO(image.getvalue()), width=Inches(5))
    # A headshot-like graphic without text.
    photo = io.BytesIO()
    Image.new("RGB", (300, 300), (180, 150, 120)).save(photo, format="PNG")
    document.add_picture(io.BytesIO(photo.getvalue()), width=Inches(1))
    document.add_paragraph("EXPERIENCE")
    document.add_paragraph("Customer Care Representative, Example Grocer, 2022 - Present")

    part = document.part
    data = Part(PackURI("/word/diagrams/data1.xml"),
                "application/vnd.openxmlformats-officedocument.drawingml.diagramData+xml",
                _SMARTART_DATA.encode(), part.package)
    drawing = Part(PackURI("/word/diagrams/drawing1.xml"),
                   "application/vnd.ms-office.drawingml.diagramDrawing+xml",
                   _SMARTART_DRAWING.encode(), part.package)
    part.relate_to(data, RT.DIAGRAM_DATA)
    part.relate_to(drawing, "http://schemas.microsoft.com/office/2007/relationships/diagramDrawing")

    buffer = io.BytesIO()
    document.save(buffer)
    return buffer.getvalue()


# ------------------------------------------------------------------
# Legacy .doc
# ------------------------------------------------------------------

def legacy_docx() -> bytes:
    document = Document()
    document.add_paragraph("Benjie Ramos")
    document.add_paragraph("Office assistant with experience in records and billing.")
    document.add_paragraph("SKILLS")
    document.add_paragraph("Customer Service, Zendesk, QuickBooks, Microsoft Excel")
    document.add_paragraph("EXPERIENCE")
    document.add_paragraph("Office Assistant, Example Clinic, 2018 - Present")
    for duty in [
        "Scheduled patient appointments and answered phone and email enquiries.",
        "Encoded patient billing records and prepared monthly statements for the clinic manager.",
        "Kept supplier invoices and receipts in order and reconciled petty cash every Friday.",
        "Handled walk-in patients at the front desk and kept the waiting area organised.",
    ]:
        document.add_paragraph(duty, style="List Bullet")
    document.add_paragraph("Records Clerk, Example Pharmacy, 2016 - 2018")
    for duty in [
        "Filed prescriptions and maintained the stock ledger.",
        "Prepared daily sales summaries for the pharmacist in charge.",
    ]:
        document.add_paragraph(duty, style="List Bullet")
    document.add_paragraph("EDUCATION")
    document.add_paragraph("Bachelor of Science in Office Administration, Example State University, 2016")
    buffer = io.BytesIO()
    document.save(buffer)
    return buffer.getvalue()


def legacy_doc() -> bytes:
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if not soffice:
        raise SystemExit("LibreOffice is needed to rebuild legacy_resume.doc.")
    with tempfile.TemporaryDirectory() as workdir:
        source = Path(workdir) / "legacy_resume.docx"
        source.write_bytes(legacy_docx())
        subprocess.run(
            [soffice, f"-env:UserInstallation={(Path(workdir) / 'profile').as_uri()}", "--headless",
             "--convert-to", "doc:MS Word 97", "--outdir", workdir, str(source)],
            check=True, capture_output=True, timeout=120,
        )
        return (Path(workdir) / "legacy_resume.doc").read_bytes()


FIXTURES = {
    "two_column_resume.pdf": two_column_pdf,
    "split_words_resume.pdf": split_words_pdf,
    "decoy_phrases_resume.pdf": decoy_pdf,
    "scanned_resume.pdf": scanned_pdf,
    "mixed_text_and_scan_resume.pdf": mixed_pdf,
    "embedded_content_resume.docx": embedded_content_docx,
    "legacy_resume.doc": legacy_doc,
}


def main() -> None:
    for name, build in FIXTURES.items():
        (HERE / name).write_bytes(build())
        print(f"wrote {name}")


if __name__ == "__main__":
    main()

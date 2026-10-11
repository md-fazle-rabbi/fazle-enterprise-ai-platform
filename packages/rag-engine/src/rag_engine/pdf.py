"""
Renders every PDF page to an image, routes through the same vision/OCR pipeline as a
standalone image. PyMuPDF needs no separate system package, unlike Tesseract, it bundles
MuPDF in the wheel.

The limits from upload_limits.py are applied here, in the one place that opens the file. A
password protected file, too many pages, and a rendered page over the byte limit stop the
work before the vision model is called. A page that would render too large is rendered at a
lower dpi instead.

PyMuPDF ships partial type stubs: several of its own methods still
resolve to Any internally, and Document isn't typed as Iterable despite
being iterable at runtime. Ignored per-line with the specific error code
mypy actually reports, rather than a blanket ignore on the import, so a
future, better-typed PyMuPDF release surfaces these as genuine
unused-ignore errors instead of hiding silently.
"""

import math

import pymupdf

from rag_engine import upload_limits


class PdfLimitError(ValueError):
    """A PDF is over a limit. The message is fixed text written here, safe to show a caller."""


def _scale_for(width_pt: float, height_pt: float, dpi: int) -> float:
    """Zoom for one page: dpi / 72, lowered when the render would pass the pixel budget."""
    wanted = dpi / 72
    area = max(width_pt * height_pt, 1.0)
    allowed = math.sqrt(upload_limits.MAX_PAGE_PIXELS / area)
    return min(wanted, allowed)


def pdf_to_page_images(pdf_bytes: bytes, dpi: int = 150) -> list[bytes]:
    """dpi=150 balances legibility for vision extraction against request
    size, a many-page document at print resolution would blow API limits."""
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")  # type: ignore[no-untyped-call]
    try:
        if doc.needs_pass:
            raise PdfLimitError("The PDF is password protected.")
        page_count = doc.page_count
        # Why: counted before any page is rendered, so a long file costs almost nothing.
        if page_count > upload_limits.MAX_PDF_PAGES:
            raise PdfLimitError(
                f"The PDF has {page_count} pages. "
                f"The limit is {upload_limits.MAX_PDF_PAGES}."
            )
        pages = list(doc)  # type: ignore[call-overload]
        images: list[bytes] = []
        for number, page in enumerate(pages, start=1):
            scale = _scale_for(page.rect.width, page.rect.height, dpi)
            matrix = pymupdf.Matrix(scale, scale)  # type: ignore[no-untyped-call]
            png = page.get_pixmap(matrix=matrix).tobytes("png")
            if len(png) > upload_limits.MAX_PAGE_PNG_BYTES:
                raise PdfLimitError(
                    f"Page {number} renders to more than "
                    f"{upload_limits.MAX_PAGE_PNG_BYTES} bytes."
                )
            images.append(png)
        return images
    finally:
        doc.close()  # type: ignore[no-untyped-call]

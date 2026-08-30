"""
Renders every PDF page to an image, routes through the same vision/OCR
pipeline as a standalone image. PyMuPDF needs no separate system package,
unlike Tesseract, it bundles MuPDF in the wheel.

PyMuPDF ships partial type stubs: several of its own methods still
resolve to Any internally, and Document isn't typed as Iterable despite
being iterable at runtime. Ignored per-line with the specific error code
mypy actually reports, rather than a blanket ignore on the import, so a
future, better-typed PyMuPDF release surfaces these as genuine
unused-ignore errors instead of hiding silently.
"""

import pymupdf


def pdf_to_page_images(pdf_bytes: bytes, dpi: int = 150) -> list[bytes]:
    """dpi=150 balances legibility for vision extraction against request
    size, a many-page document at print resolution would blow API limits."""
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")  # type: ignore[no-untyped-call]
    matrix = pymupdf.Matrix(dpi / 72, dpi / 72)  # type: ignore[no-untyped-call]
    try:
        pages = list(doc)  # type: ignore[call-overload]
        return [page.get_pixmap(matrix=matrix).tobytes("png") for page in pages]
    finally:
        doc.close()  # type: ignore[no-untyped-call]

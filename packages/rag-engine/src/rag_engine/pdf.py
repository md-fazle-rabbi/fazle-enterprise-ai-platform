"""
Renders every PDF page to an image, routes through the same vision/OCR
pipeline as a standalone image. PyMuPDF (fitz) needs no separate system
package, unlike Tesseract, it bundles MuPDF in the wheel.
"""

import fitz  # type: ignore[import-untyped]


def pdf_to_page_images(pdf_bytes: bytes, dpi: int = 150) -> list[bytes]:
    """dpi=150 balances legibility for vision extraction against request
    size, a many-page document at print resolution would blow API limits."""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    matrix = fitz.Matrix(dpi / 72, dpi / 72)  # PDF's native unit is 72 dpi
    try:
        return [page.get_pixmap(matrix=matrix).tobytes("png") for page in doc]
    finally:
        doc.close()

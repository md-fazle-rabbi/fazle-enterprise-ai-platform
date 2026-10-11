"""
Size and shape limits for everything a caller can send to the API, kept in one place so the
numbers can be read, argued about and tested together. Each limit has its reason next to it.

The vendor limits named below were checked against their docs on 2026-10-10. Handlers and
tests read these names at call time, so changing a number here changes them all.
"""

import io

from fastapi import HTTPException
from PIL import Image

KIB = 1024
MIB = 1024 * KIB

# Why: Gemini accepts inline image data up to 20MB for the whole request, prompt included.
# 8 MiB leaves a wide margin even if the SDK sends the bytes as base64, which adds a third.
MAX_IMAGE_BYTES = 8 * MIB
# Why: a small PNG can describe a huge image (a decompression bomb), and OCR decodes the
# whole image into memory. At up to about 4 bytes a pixel, 50 million pixels is around
# 200 MB at worst, and it still allows a 48 megapixel phone photo.
MAX_IMAGE_PIXELS = 50_000_000
# Why: Gemini documents PNG, JPEG, WEBP, HEIC and HEIF. Pillow here reads the first three
# without a plugin. GIF was accepted before and is not in Gemini's list.
ALLOWED_IMAGE_FORMATS = frozenset({"PNG", "JPEG", "WEBP"})

# Why: room for a text heavy file of the allowed length.
MAX_PDF_BYTES = 10 * MIB
# Why: every page is one vision call and one text in the single Voyage request, so the
# cost and the wait grow with the page count.
MAX_PDF_PAGES = 20
# Why: a page is rendered at 150 dpi, about 2 million pixels for Letter or A4. A page
# declared very large would ask for a render of hundreds of millions of pixels, so larger
# pages are rendered at a lower dpi to stay under this budget.
MAX_PAGE_PIXELS = 6_000_000
# Why: each rendered page goes to the vision model as an inline image, so it follows the
# same byte limit as an uploaded image.
MAX_PAGE_PNG_BYTES = MAX_IMAGE_BYTES

# Why: redaction runs over the whole text, and spaCy's default limit is 1,000,000 characters
# (spaCy docs). This keeps a tenfold margin. It is roughly 25,000 tokens of English.
MAX_TEXT_CHARS = 100_000
MAX_SOURCE_PATH_CHARS = 512
# Why: ingestion sends every chunk in one Voyage request, and voyage-4-large takes up to
# 1,000 texts and 120K tokens per request. A chunk is built to hold about 400 tiktoken
# tokens, so 200 chunks is about 80,000 tokens, a third under Voyage's cap, which counts
# with its own tokenizer.
MAX_CHUNKS_PER_DOCUMENT = 200

# Why: the web app (chat-form.tsx and lib/chat/handler.ts) and conversations.py already stop
# a question at 2,000 characters. The classifier scores a long question in up to 64
# segments, so the backend must not accept more than the web app sends.
MAX_QUESTION_CHARS = 2_000
# Why: every retrieved parent chunk goes through the classifier, so top_k multiplies that cost.
MAX_TOP_K = 20

# Why: boundaries, part headers and the file name that wrap the file bytes in a multipart body.
MULTIPART_OVERHEAD_BYTES = 64 * KIB
# Why: a client that escapes every non ASCII character as \uXXXX sends 6 bytes per character,
# so a valid request fits under this. Text made only of escaped emoji can be larger and gets
# a 413 instead of a 422. The extra 4 KiB covers the other fields.
_JSON_BYTES_PER_CHAR = 6
_JSON_SLACK_BYTES = 4 * KIB
MAX_INGEST_BODY_BYTES = (
    MAX_TEXT_CHARS + MAX_SOURCE_PATH_CHARS
) * _JSON_BYTES_PER_CHAR + _JSON_SLACK_BYTES
MAX_QUERY_BODY_BYTES = MAX_QUESTION_CHARS * _JSON_BYTES_PER_CHAR + _JSON_SLACK_BYTES

# Why: the largest body each POST path may carry. Paths are matched exactly, like the
# firewall, so a new endpoint that takes a body has to be added here.
BODY_LIMITS: dict[str, int] = {
    "/ingest": MAX_INGEST_BODY_BYTES,
    "/ingest/image": MAX_IMAGE_BYTES + MULTIPART_OVERHEAD_BYTES,
    "/ingest/pdf": MAX_PDF_BYTES + MULTIPART_OVERHEAD_BYTES,
    "/query": MAX_QUERY_BODY_BYTES,
    "/query/stream": MAX_QUERY_BODY_BYTES,
    "/search": MAX_QUERY_BODY_BYTES,
}

_UNSUPPORTED_IMAGE = "Unsupported image. Upload a PNG, JPEG or WEBP file."


def check_image(image_bytes: bytes) -> None:
    """
    Refuses anything that is not a PNG, JPEG or WEBP, and anything with too many pixels.
    Pillow reads only the header here and does not decode the image, so this stays cheap.
    """
    try:
        with Image.open(io.BytesIO(image_bytes)) as image:
            image_format = image.format
            width, height = image.size
    except (Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise HTTPException(
            status_code=422, detail="The image has too many pixels."
        ) from None
    except OSError:
        # Why: Pillow's UnidentifiedImageError is an OSError. The parser's own message
        # stays out of the response.
        raise HTTPException(status_code=415, detail=_UNSUPPORTED_IMAGE) from None

    if image_format not in ALLOWED_IMAGE_FORMATS:
        raise HTTPException(status_code=415, detail=_UNSUPPORTED_IMAGE)
    if width * height > MAX_IMAGE_PIXELS:
        raise HTTPException(
            status_code=422,
            detail=(
                f"The image is {width} by {height} pixels. "
                f"The limit is {MAX_IMAGE_PIXELS:,} pixels in total."
            ),
        )


def check_pdf_header(pdf_bytes: bytes) -> None:
    """Readers accept the PDF header anywhere in the first 1024 bytes, so this does too."""
    if b"%PDF-" not in pdf_bytes[:1024]:
        raise HTTPException(status_code=415, detail="The file is not a PDF.")


def check_chunk_count(count: int) -> None:
    if count > MAX_CHUNKS_PER_DOCUMENT:
        raise HTTPException(
            status_code=422,
            detail=(
                f"The document has {count} sections. "
                f"The limit is {MAX_CHUNKS_PER_DOCUMENT}."
            ),
        )

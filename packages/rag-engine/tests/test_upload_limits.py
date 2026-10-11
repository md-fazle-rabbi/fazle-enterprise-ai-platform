"""
Tests for the size and shape limits on request bodies and uploads.

The middleware tests use a tiny app with a 100 byte limit, so they need no database. The
route tests use the real app, and those that reach a handler need Postgres, like
test_ingest.py. The vision model, the embedding call and the Hugging Face classifier
download are faked, so nothing here spends an API quota.
"""

import io
import uuid
from collections.abc import AsyncIterator
from typing import Annotated

import pymupdf
import pytest
from fastapi import FastAPI, File, Request, UploadFile
from httpx import ASGITransport, AsyncClient
from PIL import Image
from rag_engine import upload_limits
from rag_engine.main import app
from rag_engine.models import Document
from rag_engine.pdf import PdfLimitError, pdf_to_page_images
from rag_engine.routers import ingest_image, ingest_pdf
from rag_engine.security.firewall import InjectionAssessment
from rag_engine.security.size_limit import RequestSizeLimitMiddleware
from sqlalchemy import func, select, text

LIMIT = 100


def _headers() -> dict[str, str]:
    return {"X-Tenant-ID": str(uuid.uuid4())}


def _client_for(target: FastAPI) -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=target), base_url="http://test")


def _image(image_format: str = "PNG", size: tuple[int, int] = (10, 10)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color="white").save(buf, format=image_format)
    return buf.getvalue()


def _pdf(page_count: int) -> bytes:
    doc = pymupdf.open()
    try:
        for number in range(1, page_count + 1):
            doc.new_page().insert_text((72, 72), f"page {number}")
        return bytes(doc.tobytes())
    finally:
        doc.close()


def _encrypted_pdf() -> bytes:
    doc = pymupdf.open()
    try:
        doc.new_page().insert_text((72, 72), "secret")
        return bytes(
            doc.tobytes(
                encryption=pymupdf.PDF_ENCRYPT_AES_256,
                owner_pw="owner-password",
                user_pw="user-password",
            )
        )
    finally:
        doc.close()


async def _document_count(tenant: str) -> int:
    async with app.state.session_factory() as session:
        await session.execute(
            text("SELECT set_config('app.tenant_id', :tenant_id, true)"),
            {"tenant_id": tenant},
        )
        return await session.scalar(select(func.count()).select_from(Document)) or 0


@pytest.fixture
def no_classifier_download(monkeypatch):
    """Skips the classifier download the app does at startup."""
    monkeypatch.setattr("rag_engine.main._get_pipeline", lambda: None)


@pytest.fixture
def forbidden_vision(monkeypatch):
    """Fails the test if a rejected upload still reaches the vision model."""

    async def _never(image_bytes: bytes) -> tuple[str, str]:
        raise AssertionError("the vision model was called for a rejected upload")

    monkeypatch.setattr(ingest_image, "extract_image_content", _never)
    monkeypatch.setattr(ingest_pdf, "extract_image_content", _never)


# ---- the middleware, on a tiny app ------------------------------------------------------


def _mini_app() -> tuple[FastAPI, list[int]]:
    seen: list[int] = []
    mini = FastAPI()

    @mini.post("/small")
    async def small(request: Request) -> dict[str, int]:
        body = await request.body()
        seen.append(len(body))
        return {"size": len(body)}

    @mini.post("/upload")
    async def upload(file: Annotated[UploadFile, File()]) -> dict[str, int]:
        content = await file.read()
        seen.append(len(content))
        return {"size": len(content)}

    @mini.post("/unlisted")
    async def unlisted(request: Request) -> dict[str, int]:
        return {"size": len(await request.body())}

    mini.add_middleware(
        RequestSizeLimitMiddleware, limits={"/small": LIMIT, "/upload": LIMIT}
    )
    return mini, seen


async def _chunks(sizes: list[int]) -> AsyncIterator[bytes]:
    for size in sizes:
        yield b"x" * size


@pytest.mark.asyncio
async def test_body_at_the_limit_passes():
    mini, seen = _mini_app()
    async with _client_for(mini) as client:
        response = await client.post("/small", content=b"x" * LIMIT)
    assert response.status_code == 200
    assert seen == [LIMIT]


@pytest.mark.asyncio
async def test_declared_oversize_is_rejected_before_the_route_runs():
    mini, seen = _mini_app()
    async with _client_for(mini) as client:
        response = await client.post("/small", content=b"x" * (LIMIT + 1))
    assert response.status_code == 413
    assert "too large" in response.json()["detail"]
    assert response.headers["connection"] == "close"
    assert seen == []


@pytest.mark.asyncio
async def test_oversize_without_a_declared_length_is_stopped_while_streaming():
    mini, seen = _mini_app()
    async with _client_for(mini) as client:
        response = await client.post("/small", content=_chunks([60, 60, 60]))
    assert response.status_code == 413
    assert response.headers["connection"] == "close"
    assert seen == []


@pytest.mark.asyncio
async def test_oversize_multipart_upload_is_413_not_400():
    mini, seen = _mini_app()

    async def body() -> AsyncIterator[bytes]:
        yield (
            b'--b\r\nContent-Disposition: form-data; name="file"; filename="a.bin"\r\n'
            b"Content-Type: application/octet-stream\r\n\r\n"
        )
        for _ in range(5):
            yield b"x" * 50
        yield b"\r\n--b--\r\n"

    async with _client_for(mini) as client:
        response = await client.post(
            "/upload",
            content=body(),
            headers={"content-type": "multipart/form-data; boundary=b"},
        )
    assert response.status_code == 413
    assert seen == []


@pytest.mark.asyncio
async def test_paths_without_a_limit_are_not_capped():
    mini, _ = _mini_app()
    async with _client_for(mini) as client:
        response = await client.post("/unlisted", content=b"x" * (LIMIT * 10))
    assert response.status_code == 200


# ---- the middleware, on the real app ----------------------------------------------------


@pytest.mark.asyncio
async def test_oversize_query_body_never_reaches_the_firewall(monkeypatch):
    seen: list[str] = []

    async def _spy(value: str) -> InjectionAssessment:
        seen.append(value)
        return InjectionAssessment(
            pattern_hit=False, classifier_score=0.0, action="allow"
        )

    monkeypatch.setattr("rag_engine.security.middleware.assess", _spy)
    body = {"question": "a" * upload_limits.MAX_QUERY_BODY_BYTES}
    async with _client_for(app) as client:
        response = await client.post("/query", json=body, headers=_headers())
    assert response.status_code == 413
    assert seen == []


@pytest.mark.asyncio
async def test_oversize_image_body_is_413():
    payload = b"0" * (
        upload_limits.MAX_IMAGE_BYTES + upload_limits.MULTIPART_OVERHEAD_BYTES
    )
    async with _client_for(app) as client:
        response = await client.post(
            "/ingest/image",
            headers=_headers(),
            files={"file": ("big.png", payload, "image/png")},
        )
    assert response.status_code == 413


@pytest.mark.asyncio
async def test_oversize_pdf_body_is_413():
    payload = b"0" * (
        upload_limits.MAX_PDF_BYTES + upload_limits.MULTIPART_OVERHEAD_BYTES
    )
    async with _client_for(app) as client:
        response = await client.post(
            "/ingest/pdf",
            headers=_headers(),
            files={"file": ("big.pdf", payload, "application/pdf")},
        )
    assert response.status_code == 413


@pytest.mark.asyncio
async def test_oversize_ingest_body_is_413():
    body = {"source_path": "a.md", "text": "a" * upload_limits.MAX_INGEST_BODY_BYTES}
    async with _client_for(app) as client:
        response = await client.post("/ingest", json=body, headers=_headers())
    assert response.status_code == 413


# ---- field limits (need Postgres) -------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.usefixtures("no_classifier_download")
async def test_ingest_text_over_the_character_limit_is_422():
    body = {"source_path": "a.md", "text": "a" * (upload_limits.MAX_TEXT_CHARS + 1)}
    async with app.router.lifespan_context(app), _client_for(app) as client:
        response = await client.post("/ingest", json=body, headers=_headers())
    assert response.status_code == 422


@pytest.mark.asyncio
@pytest.mark.usefixtures("no_classifier_download")
@pytest.mark.parametrize(
    ("path", "payload"),
    [
        ("/query", {"question": "a" * (upload_limits.MAX_QUESTION_CHARS + 1)}),
        ("/query", {"question": "ok", "top_k": upload_limits.MAX_TOP_K + 1}),
        ("/query", {"question": "ok", "top_k": 0}),
        ("/search", {"query": "a" * (upload_limits.MAX_QUESTION_CHARS + 1)}),
    ],
    ids=["question-too-long", "top-k-too-big", "top-k-zero", "search-too-long"],
)
async def test_json_inputs_outside_the_limits_are_422(path, payload):
    async with app.router.lifespan_context(app), _client_for(app) as client:
        response = await client.post(path, json=payload, headers=_headers())
    assert response.status_code == 422


@pytest.mark.asyncio
@pytest.mark.usefixtures("no_classifier_download")
async def test_ingest_with_too_many_sections_is_422_and_stores_nothing(monkeypatch):
    monkeypatch.setattr(upload_limits, "MAX_CHUNKS_PER_DOCUMENT", 2)
    tenant = str(uuid.uuid4())
    body = {
        "source_path": "sections.md",
        "text": "# A\n\nalpha.\n\n# B\n\nbeta.\n\n# C\n\ngamma.\n",
    }
    async with app.router.lifespan_context(app), _client_for(app) as client:
        response = await client.post(
            "/ingest", json=body, headers={"X-Tenant-ID": tenant}
        )
        stored = await _document_count(tenant)
    assert response.status_code == 422
    assert "3 sections" in response.json()["detail"]
    assert stored == 0


# ---- images (need Postgres) -------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.usefixtures("no_classifier_download", "forbidden_vision")
@pytest.mark.parametrize(
    "payload",
    [_image("GIF"), _image("BMP"), b"this is not an image"],
    ids=["gif", "bmp", "text"],
)
async def test_image_of_an_unsupported_type_is_415(payload):
    async with app.router.lifespan_context(app), _client_for(app) as client:
        response = await client.post(
            "/ingest/image",
            headers=_headers(),
            files={"file": ("upload.png", payload, "image/png")},
        )
    assert response.status_code == 415


@pytest.mark.asyncio
@pytest.mark.usefixtures("no_classifier_download", "forbidden_vision")
async def test_image_over_the_pixel_limit_is_422(monkeypatch):
    monkeypatch.setattr(upload_limits, "MAX_IMAGE_PIXELS", 100)
    async with app.router.lifespan_context(app), _client_for(app) as client:
        response = await client.post(
            "/ingest/image",
            headers=_headers(),
            files={"file": ("wide.png", _image("PNG", (20, 20)), "image/png")},
        )
    assert response.status_code == 422
    assert "pixels" in response.json()["detail"]


@pytest.mark.asyncio
@pytest.mark.usefixtures("no_classifier_download")
@pytest.mark.parametrize("image_format", ["PNG", "JPEG", "WEBP"])
async def test_png_jpeg_and_webp_are_accepted(image_format, monkeypatch):
    async def _extract(image_bytes: bytes) -> tuple[str, str]:
        return "A short note about quarterly revenue.", "image"

    monkeypatch.setattr(ingest_image, "extract_image_content", _extract)
    async with app.router.lifespan_context(app), _client_for(app) as client:
        response = await client.post(
            "/ingest/image",
            headers=_headers(),
            files={
                "file": ("ok.img", _image(image_format), "application/octet-stream")
            },
        )
    assert response.status_code == 201


# ---- PDFs (need Postgres) ---------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.usefixtures("no_classifier_download", "forbidden_vision")
async def test_pdf_over_the_page_limit_is_422_and_never_reaches_the_vision_model(
    monkeypatch,
):
    monkeypatch.setattr(upload_limits, "MAX_PDF_PAGES", 3)
    tenant = str(uuid.uuid4())
    async with app.router.lifespan_context(app), _client_for(app) as client:
        response = await client.post(
            "/ingest/pdf",
            headers={"X-Tenant-ID": tenant},
            files={"file": ("long.pdf", _pdf(4), "application/pdf")},
        )
        stored = await _document_count(tenant)
    assert response.status_code == 422
    assert "4 pages" in response.json()["detail"]
    assert "limit is 3" in response.json()["detail"]
    assert stored == 0


@pytest.mark.asyncio
@pytest.mark.usefixtures("no_classifier_download", "forbidden_vision")
async def test_file_that_is_not_a_pdf_is_415():
    async with app.router.lifespan_context(app), _client_for(app) as client:
        response = await client.post(
            "/ingest/pdf",
            headers=_headers(),
            files={"file": ("fake.pdf", b"this is not a pdf", "application/pdf")},
        )
    assert response.status_code == 415


@pytest.mark.asyncio
@pytest.mark.usefixtures("no_classifier_download", "forbidden_vision")
async def test_password_protected_pdf_is_422():
    async with app.router.lifespan_context(app), _client_for(app) as client:
        response = await client.post(
            "/ingest/pdf",
            headers=_headers(),
            files={"file": ("locked.pdf", _encrypted_pdf(), "application/pdf")},
        )
    assert response.status_code == 422
    assert "password protected" in response.json()["detail"]


# ---- the renderer, called directly ------------------------------------------------------


def test_pages_are_rendered_within_the_pixel_budget(monkeypatch):
    monkeypatch.setattr(upload_limits, "MAX_PAGE_PIXELS", 500_000)
    [png] = pdf_to_page_images(_pdf(1))
    with Image.open(io.BytesIO(png)) as image:
        pixels = image.width * image.height
    assert 0 < pixels <= 500_000 * 1.05


def test_a_page_over_the_byte_limit_is_rejected(monkeypatch):
    monkeypatch.setattr(upload_limits, "MAX_PAGE_PNG_BYTES", 100)
    with pytest.raises(PdfLimitError, match="Page 1"):
        pdf_to_page_images(_pdf(1))


def test_default_page_limit_is_enforced_before_rendering():
    too_many = upload_limits.MAX_PDF_PAGES + 1
    with pytest.raises(PdfLimitError, match=f"{too_many} pages"):
        pdf_to_page_images(_pdf(too_many))

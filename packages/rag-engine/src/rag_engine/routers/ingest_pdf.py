"""
PDF ingestion. Each page is rendered to an image, read by the vision model (OCR as the
fallback), and checked by the same injection firewall and PII redaction as text and
image ingestion.

Every page is read, checked, redacted and embedded before anything is written. One
blocked page rejects the whole file: a page that carries an injection shows attacker
intent, so the rest of the file gets no benefit of the doubt, and a rejected upload
leaves nothing behind (no document row, no chunks, no embedding calls).

Idempotent by content hash. If the stored document was redacted under an older
pii.PII_ANALYZER_VERSION, re-posting the same bytes re-derives its chunks under the
current rules (see _reprocess_stale_pdf), as ingest.py and ingest_image.py do.
"""

import hashlib
import uuid
from dataclasses import dataclass
from typing import Annotated

import structlog
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from rag_engine.chunking import count_tokens
from rag_engine.db import get_session, get_tenant_id
from rag_engine.embeddings import embed_documents
from rag_engine.models import Chunk, Document
from rag_engine.pdf import pdf_to_page_images
from rag_engine.pii import PII_ANALYZER_VERSION, redact_pii
from rag_engine.security.firewall import assess
from rag_engine.vision import extract_image_content

logger = structlog.get_logger()
router = APIRouter(prefix="/ingest/pdf", tags=["ingest"])


class PdfIngestResponse(BaseModel):
    document_id: uuid.UUID
    page_count: int
    deduplicated: bool
    # Why: a page with no readable content (blank, or only a logo) is skipped instead of
    # failing the file. The caller is told which pages, so a gap is never a surprise.
    skipped_pages: list[int] = Field(default_factory=list)


@dataclass(frozen=True, slots=True)
class _Page:
    number: int  # 1-based
    text: str  # already redacted
    modality: str


@dataclass(frozen=True, slots=True)
class _ScreenedPdf:
    pages: list[_Page]
    skipped_pages: list[int]
    pii_types: list[str]


async def _screen_pdf(page_images: list[bytes]) -> _ScreenedPdf:
    """
    Read, firewall-check and redact every page without touching the database.

    Raises 400 if ANY page is blocked and 422 if no page produced readable content.
    """
    pages: list[_Page] = []
    skipped_pages: list[int] = []
    pii_types: set[str] = set()

    for page_number, image_bytes in enumerate(page_images, start=1):
        try:
            text, modality = await extract_image_content(image_bytes)
        except ValueError:
            logger.warning("pdf.page_extraction_failed", page=page_number)
            skipped_pages.append(page_number)
            continue
        if not text.strip():
            skipped_pages.append(page_number)
            continue

        assessment = await assess(text)
        if assessment.action == "block":
            # Why: log the page and the reason, never the page text itself.
            logger.warning(
                "firewall.blocked",
                path="/ingest/pdf",
                page=page_number,
                pattern_hit=assessment.pattern_hit,
                classifier_score=assessment.classifier_score,
            )
            raise HTTPException(
                status_code=400,
                detail=(
                    f"PDF rejected: page {page_number} was blocked as possible "
                    "prompt injection."
                ),
            )

        redacted_text, found = redact_pii(text)
        pii_types.update(found)
        pages.append(_Page(number=page_number, text=redacted_text, modality=modality))

    if not pages:
        raise HTTPException(
            status_code=422, detail="No page of the PDF produced readable content"
        )
    return _ScreenedPdf(
        pages=pages, skipped_pages=skipped_pages, pii_types=sorted(pii_types)
    )


async def _embed_pages(screened: _ScreenedPdf) -> list[list[float]]:
    # Why: one embedding request for the whole file, not one per page, so a many-page
    # file does not wait on per-request rate limits.
    return await embed_documents([page.text for page in screened.pages])


def _add_chunks(
    session: AsyncSession,
    document_id: uuid.UUID,
    tenant_id: uuid.UUID,
    screened: _ScreenedPdf,
    vectors: list[list[float]],
) -> None:
    for page, vector in zip(screened.pages, vectors, strict=True):
        session.add(
            Chunk(
                tenant_id=tenant_id,
                document_id=document_id,
                chunk_index=page.number - 1,
                heading_path=[f"page {page.number}"],
                text=page.text,
                token_count=count_tokens(page.text),
                embedding=vector,
                modality=page.modality,
            )
        )


async def _existing_response(
    session: AsyncSession, document: Document
) -> PdfIngestResponse:
    page_count = await session.scalar(
        select(func.count()).select_from(Chunk).where(Chunk.document_id == document.id)
    )
    return PdfIngestResponse(
        document_id=document.id, page_count=page_count or 0, deduplicated=True
    )


async def _reprocess_stale_pdf(
    session: AsyncSession,
    document: Document,
    page_images: list[bytes],
    tenant_id: uuid.UUID,
) -> PdfIngestResponse:
    """
    Same content_hash, but stamped with an older pii.PII_ANALYZER_VERSION. Mirrors
    ingest_image.py: re-derive every chunk under the CURRENT rules and re-stamp, so a PDF
    self-heals instead of serving stale redaction forever. Screening and embedding run
    before the old chunks are deleted, so a failure leaves them untouched.
    """
    screened = await _screen_pdf(page_images)
    vectors = await _embed_pages(screened)

    await session.execute(delete(Chunk).where(Chunk.document_id == document.id))
    document.pii_analyzer_version = PII_ANALYZER_VERSION
    document.pii_entity_types = screened.pii_types or None
    _add_chunks(session, document.id, tenant_id, screened, vectors)

    logger.info(
        "pii.reredacted",
        entity_types=screened.pii_types,
        document_id=str(document.id),
        page_count=len(screened.pages),
    )
    return PdfIngestResponse(
        document_id=document.id,
        page_count=len(screened.pages),
        deduplicated=True,
        skipped_pages=screened.skipped_pages,
    )


@router.post("", response_model=PdfIngestResponse, status_code=201)
async def ingest_pdf(
    tenant_id: Annotated[uuid.UUID, Depends(get_tenant_id)],
    session: Annotated[AsyncSession, Depends(get_session)],
    file: Annotated[UploadFile, File()],
) -> PdfIngestResponse:
    pdf_bytes = await file.read()
    if not pdf_bytes:
        raise HTTPException(status_code=400, detail="Empty file")

    content_hash = hashlib.sha256(pdf_bytes).hexdigest()
    existing = await session.scalar(
        select(Document).where(Document.content_hash == content_hash)
    )
    # Why: content_hash never changes when redact_pii's logic changes, so only a
    # differing stamped version means the stored chunks are stale. A normal duplicate
    # stays a cheap no-op that renders nothing.
    if existing is not None and existing.pii_analyzer_version == PII_ANALYZER_VERSION:
        return await _existing_response(session, existing)

    try:
        page_images = pdf_to_page_images(pdf_bytes)
    except Exception as e:
        # Why: the parser's own message can carry internal detail, so it goes to the
        # log and the caller gets fixed text.
        logger.warning("pdf.render_failed", exc_info=True)
        raise HTTPException(
            status_code=422, detail="Could not render the PDF pages"
        ) from e
    if not page_images:
        raise HTTPException(status_code=422, detail="PDF has no pages")

    if existing is not None:
        return await _reprocess_stale_pdf(session, existing, page_images, tenant_id)

    # Why: read, check, redact and embed every page BEFORE the first INSERT. A blocked or
    # unreadable PDF never creates a documents row, so there is nothing to roll back.
    screened = await _screen_pdf(page_images)
    vectors = await _embed_pages(screened)

    document = Document(
        tenant_id=tenant_id,
        content_hash=content_hash,
        source_path=file.filename or "unknown",
        pii_entity_types=screened.pii_types or None,
        # Why: this column has no default on purpose (see models.py), so every insert
        # path states it. This route used to leave it out.
        pii_analyzer_version=PII_ANALYZER_VERSION,
    )
    try:
        async with session.begin_nested():
            session.add(document)
            await session.flush()
    except IntegrityError:
        # Lost a race: another request inserted the same (tenant_id, content_hash)
        # between the SELECT above and this INSERT. The SAVEPOINT rolled back only this
        # insert, so return the winner's document (same limitation as ingest.py: if the
        # winner was itself stale, the next upload of these bytes re-processes it).
        winner = await session.scalar(
            select(Document).where(Document.content_hash == content_hash)
        )
        if winner is None:
            raise
        return await _existing_response(session, winner)

    _add_chunks(session, document.id, tenant_id, screened, vectors)

    if screened.pii_types:
        logger.info(
            "pii.redacted",
            entity_types=screened.pii_types,
            document_id=str(document.id),
            page_count=len(screened.pages),
        )
    if screened.skipped_pages:
        logger.warning(
            "pdf.pages_skipped",
            document_id=str(document.id),
            skipped_pages=screened.skipped_pages,
        )

    return PdfIngestResponse(
        document_id=document.id,
        page_count=len(screened.pages),
        deduplicated=False,
        skipped_pages=screened.skipped_pages,
    )

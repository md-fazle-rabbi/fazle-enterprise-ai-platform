"""
Image ingestion. Extracted content routes through the same dedup, embed,
and store logic as text ingestion, plus the same injection firewall
applied to whatever text extraction produced.
"""

import hashlib
import uuid
from typing import Annotated

import structlog
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from rag_engine.chunking import count_tokens
from rag_engine.db import get_session, get_tenant_id
from rag_engine.embeddings import embed_documents
from rag_engine.models import Chunk, Document
from rag_engine.pii import PII_ANALYZER_VERSION, redact_pii
from rag_engine.security.firewall import assess
from rag_engine.vision import extract_image_content

logger = structlog.get_logger()
router = APIRouter(prefix="/ingest/image", tags=["ingest"])


class ImageIngestResponse(BaseModel):
    document_id: uuid.UUID
    modality: str
    deduplicated: bool


async def _reprocess_stale_image_document(
    session: AsyncSession,
    document: Document,
    image_bytes: bytes,
    tenant_id: uuid.UUID,
) -> ImageIngestResponse:
    """
    Same content_hash as an existing image document, but its
    pii_analyzer_version is behind pii.PII_ANALYZER_VERSION. Mirrors
    ingest.py's _reprocess_stale_document: re-run extraction and redaction
    under the CURRENT rules, replace the single chunk, and stamp the new
    version, so an image ingested under an older, less accurate redaction
    rule self-heals the next time the same file is posted, instead of
    silently serving a stale chunk forever because content_hash never
    changes when redact_pii's logic changes.
    """
    try:
        text, modality = await extract_image_content(image_bytes)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e

    assessment = await assess(text)
    if assessment.action == "block":
        logger.warning(
            "firewall.blocked",
            path="/ingest/image",
            pattern_hit=assessment.pattern_hit,
            classifier_score=assessment.classifier_score,
        )
        raise HTTPException(
            status_code=400,
            detail="Extracted image content blocked: possible prompt injection.",
        )

    redacted_text, pii_types_found = redact_pii(text)

    existing_chunk = await session.scalar(
        select(Chunk).where(Chunk.document_id == document.id)
    )
    if existing_chunk is not None:
        await session.delete(existing_chunk)
        await session.flush()

    document.pii_analyzer_version = PII_ANALYZER_VERSION
    document.pii_entity_types = pii_types_found or None
    logger.info(
        "pii.reredacted",
        entity_types=pii_types_found,
        modality=modality,
        document_id=str(document.id),
    )

    vectors = await embed_documents([redacted_text])
    session.add(
        Chunk(
            tenant_id=tenant_id,
            document_id=document.id,
            chunk_index=0,
            heading_path=[],
            text=redacted_text,
            token_count=count_tokens(redacted_text),
            embedding=vectors[0],
            modality=modality,
        )
    )

    return ImageIngestResponse(
        document_id=document.id, modality=modality, deduplicated=True
    )


@router.post("", response_model=ImageIngestResponse, status_code=201)
async def ingest_image(
    tenant_id: Annotated[uuid.UUID, Depends(get_tenant_id)],
    session: Annotated[AsyncSession, Depends(get_session)],
    file: Annotated[UploadFile, File()],
) -> ImageIngestResponse:
    image_bytes = await file.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="Empty file")

    content_hash = hashlib.sha256(image_bytes).hexdigest()
    existing = await session.scalar(
        select(Document).where(Document.content_hash == content_hash)
    )
    if existing is not None:
        # Why: content_hash intentionally never changes when redact_pii's
        # logic changes (same reasoning as ingest.py), so an unchanged
        # hash does NOT mean the stored chunk reflects current redaction
        # rules. Re-process only when the stamped version actually
        # differs, so a normal duplicate upload stays a cheap no-op.
        if existing.pii_analyzer_version == PII_ANALYZER_VERSION:
            existing_chunk = await session.scalar(
                select(Chunk).where(Chunk.document_id == existing.id)
            )
            return ImageIngestResponse(
                document_id=existing.id,
                modality=existing_chunk.modality if existing_chunk else "unknown",
                deduplicated=True,
            )
        return await _reprocess_stale_image_document(
            session, existing, image_bytes, tenant_id
        )

    try:
        text, modality = await extract_image_content(image_bytes)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e

    assessment = await assess(text)
    if assessment.action == "block":
        logger.warning(
            "firewall.blocked",
            path="/ingest/image",
            pattern_hit=assessment.pattern_hit,
            classifier_score=assessment.classifier_score,
        )
        raise HTTPException(
            status_code=400,
            detail="Extracted image content blocked: possible prompt injection.",
        )

    redacted_text, pii_types_found = redact_pii(text)
    if pii_types_found:
        logger.info(
            "pii.redacted",
            entity_types=pii_types_found,
            modality=modality,
            source_path=file.filename,
        )

    document = Document(
        tenant_id=tenant_id,
        content_hash=content_hash,
        source_path=file.filename or "unknown",
        pii_entity_types=pii_types_found or None,
        pii_analyzer_version=PII_ANALYZER_VERSION,
    )
    session.add(document)
    await session.flush()

    vectors = await embed_documents([redacted_text])
    session.add(
        Chunk(
            tenant_id=tenant_id,
            document_id=document.id,
            chunk_index=0,
            heading_path=[],
            text=redacted_text,
            token_count=count_tokens(redacted_text),
            embedding=vectors[0],
            modality=modality,
        )
    )

    return ImageIngestResponse(
        document_id=document.id, modality=modality, deduplicated=False
    )

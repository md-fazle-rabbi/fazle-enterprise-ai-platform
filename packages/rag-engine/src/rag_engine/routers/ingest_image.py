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
from rag_engine.security.firewall import assess
from rag_engine.vision import extract_image_content

logger = structlog.get_logger()
router = APIRouter(prefix="/ingest/image", tags=["ingest"])


class ImageIngestResponse(BaseModel):
    document_id: uuid.UUID
    modality: str
    deduplicated: bool


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
        existing_chunk = await session.scalar(
            select(Chunk).where(Chunk.document_id == existing.id)
        )
        return ImageIngestResponse(
            document_id=existing.id,
            modality=existing_chunk.modality if existing_chunk else "unknown",
            deduplicated=True,
        )

    try:
        text, modality = await extract_image_content(image_bytes)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e

    assessment = assess(text)
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

    document = Document(
        tenant_id=tenant_id,
        content_hash=content_hash,
        source_path=file.filename or "unknown",
    )
    session.add(document)
    await session.flush()

    vectors = await embed_documents([text])
    session.add(
        Chunk(
            tenant_id=tenant_id,
            document_id=document.id,
            chunk_index=0,
            heading_path=[],
            text=text,
            token_count=count_tokens(text),
            embedding=vectors[0],
            modality=modality,
        )
    )

    return ImageIngestResponse(
        document_id=document.id, modality=modality, deduplicated=False
    )

import hashlib
import uuid
from typing import Annotated

import structlog
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from rag_engine.chunking import count_tokens
from rag_engine.db import get_session, get_tenant_id
from rag_engine.embeddings import embed_documents
from rag_engine.models import Chunk, Document
from rag_engine.pdf import pdf_to_page_images
from rag_engine.pii import redact_pii
from rag_engine.security.firewall import assess
from rag_engine.vision import extract_image_content

logger = structlog.get_logger()
router = APIRouter(prefix="/ingest/pdf", tags=["ingest"])


class PdfIngestResponse(BaseModel):
    document_id: uuid.UUID
    page_count: int
    deduplicated: bool


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
    if existing is not None:
        page_count = await session.scalar(
            select(func.count())
            .select_from(Chunk)
            .where(Chunk.document_id == existing.id)
        )
        return PdfIngestResponse(
            document_id=existing.id, page_count=page_count or 0, deduplicated=True
        )

    try:
        page_images = pdf_to_page_images(pdf_bytes)
    except Exception as e:
        raise HTTPException(
            status_code=422, detail=f"Could not render PDF pages: {e}"
        ) from e
    if not page_images:
        raise HTTPException(status_code=422, detail="PDF has no pages")

    document = Document(
        tenant_id=tenant_id,
        content_hash=content_hash,
        source_path=file.filename or "unknown",
    )
    session.add(document)
    await session.flush()

    stored_pages = 0
    all_pii_types: set[str] = set()
    for page_number, image_bytes in enumerate(page_images, start=1):
        try:
            text, modality = await extract_image_content(image_bytes)
        except ValueError:
            logger.warning(
                "pdf.page_extraction_failed",
                document_id=str(document.id),
                page=page_number,
            )
            continue

        assessment = assess(text)
        if assessment.action == "block":
            logger.warning("firewall.blocked", path="/ingest/pdf", page=page_number)
            continue

        redacted_text, pii_types_found = redact_pii(text)
        all_pii_types.update(pii_types_found)

        vectors = await embed_documents([redacted_text])
        session.add(
            Chunk(
                tenant_id=tenant_id,
                document_id=document.id,
                chunk_index=page_number - 1,
                heading_path=[f"page {page_number}"],
                text=redacted_text,
                token_count=count_tokens(redacted_text),
                embedding=vectors[0],
                modality=modality,
            )
        )
        stored_pages += 1

    if all_pii_types:
        document.pii_entity_types = sorted(all_pii_types)
        logger.info(
            "pii.redacted",
            entity_types=sorted(all_pii_types),
            document_id=str(document.id),
            page_count=stored_pages,
        )

    return PdfIngestResponse(
        document_id=document.id, page_count=stored_pages, deduplicated=False
    )

"""
The real ingestion entry point: raw text in, chunked + embedded + stored.
Idempotent by content hash, re-ingesting the same content for the same
tenant is a no-op that returns the existing document, not a duplicate.
"""

import hashlib
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from rag_engine.chunking import chunk_markdown
from rag_engine.db import get_session, get_tenant_id
from rag_engine.embeddings import embed_documents
from rag_engine.models import Chunk, Document

router = APIRouter(prefix="/ingest", tags=["ingest"])


class IngestRequest(BaseModel):
    source_path: str
    text: str


class IngestResponse(BaseModel):
    document_id: uuid.UUID
    chunk_count: int
    deduplicated: bool


def _hash_content(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


async def _existing_response(
    session: AsyncSession, content_hash: str
) -> IngestResponse:
    existing = await session.scalar(
        select(Document).where(Document.content_hash == content_hash)
    )
    if existing is None:
        # this function is only ever called right after confirming a
        # matching document exists (either the pre-check SELECT or an
        # IntegrityError from a lost insert race), so reaching None here
        # means that invariant broke, worth a loud error, not a silent
        # None-attribute crash
        raise RuntimeError(
            f"expected an existing document for content_hash={content_hash!r}, found none"
        )
    chunk_count = await session.scalar(
        select(func.count()).select_from(Chunk).where(Chunk.document_id == existing.id)
    )
    return IngestResponse(
        document_id=existing.id, chunk_count=chunk_count or 0, deduplicated=True
    )


@router.post("", response_model=IngestResponse, status_code=201)
async def ingest(
    body: IngestRequest,
    tenant_id: Annotated[uuid.UUID, Depends(get_tenant_id)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> IngestResponse:
    content_hash = _hash_content(body.text)

    # tenant_id isn't in this WHERE clause on purpose, RLS already scopes
    # every query on this session to the current tenant, adding it here
    # would just duplicate a guarantee the DB already gives for free
    already_exists = await session.scalar(
        select(Document).where(Document.content_hash == content_hash)
    )
    if already_exists is not None:
        return await _existing_response(session, content_hash)

    document = Document(
        tenant_id=tenant_id, content_hash=content_hash, source_path=body.source_path
    )
    try:
        async with session.begin_nested():
            session.add(document)
            await session.flush()
    except IntegrityError:
        # lost a race: another request inserted the same (tenant_id,
        # content_hash) between the SELECT above and this INSERT, the
        # SAVEPOINT rolled back just this insert, the outer transaction
        # from get_session is still fine to keep querying on
        return await _existing_response(session, content_hash)

    chunks = chunk_markdown(body.text)
    if not chunks:
        return IngestResponse(
            document_id=document.id, chunk_count=0, deduplicated=False
        )

    vectors = await embed_documents([c.text for c in chunks])

    for chunk, vector in zip(chunks, vectors, strict=True):
        session.add(
            Chunk(
                tenant_id=tenant_id,
                document_id=document.id,
                chunk_index=chunk.chunk_index,
                heading_path=chunk.heading_path,
                text=chunk.text,
                token_count=chunk.token_count,
                embedding=vector,
            )
        )

    return IngestResponse(
        document_id=document.id, chunk_count=len(chunks), deduplicated=False
    )

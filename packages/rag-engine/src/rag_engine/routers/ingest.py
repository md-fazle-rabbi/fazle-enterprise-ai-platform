"""
The real ingestion entry point: raw text in, chunked + embedded + stored.
Idempotent by content hash, re-ingesting the same content for the same
tenant is a no-op that returns the existing document, not a duplicate --
UNLESS pii.PII_ANALYZER_VERSION has moved on since that document was
ingested, in which case it's re-redacted and re-chunked under the current
rules (see _reprocess_stale_document).
"""

import hashlib
import uuid
from typing import Annotated

import structlog
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from rag_engine.chunking import chunk_markdown
from rag_engine.db import get_session, get_tenant_id
from rag_engine.embeddings import embed_documents
from rag_engine.models import Chunk, Document
from rag_engine.pii import PII_ANALYZER_VERSION, redact_pii

router = APIRouter(prefix="/ingest", tags=["ingest"])
logger = structlog.get_logger()


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


async def _reprocess_stale_document(
    session: AsyncSession,
    document: Document,
    original_text: str,
    tenant_id: uuid.UUID,
) -> IngestResponse:
    """
    Same content_hash as an existing document, but that document's
    pii_analyzer_version is behind pii.PII_ANALYZER_VERSION -- its chunks
    were redacted under an older, less accurate rule (e.g. before the
    relative-duration exclusion existed) and content_hash intentionally
    never changes to signal that on its own (see the comment on
    content_hash in ingest() below). Re-derive redacted_text from the
    original, unredacted text under the CURRENT rules, replace the
    document's chunks, and stamp the new version, so a recognizer fix
    self-heals previously over- or under-redacted content the next time
    matching content is posted, instead of silently serving stale,
    incorrectly-redacted chunks forever.
    """
    redacted_text, pii_types_found = redact_pii(original_text)

    await session.execute(delete(Chunk).where(Chunk.document_id == document.id))

    document.pii_analyzer_version = PII_ANALYZER_VERSION
    document.pii_entity_types = pii_types_found or None
    logger.info(
        "pii.reredacted",
        entity_types=pii_types_found,
        document_id=str(document.id),
        source_path=document.source_path,
    )

    chunks = chunk_markdown(redacted_text)
    if not chunks:
        return IngestResponse(document_id=document.id, chunk_count=0, deduplicated=True)

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
        document_id=document.id, chunk_count=len(chunks), deduplicated=True
    )


@router.post("", response_model=IngestResponse, status_code=201)
async def ingest(
    body: IngestRequest,
    tenant_id: Annotated[uuid.UUID, Depends(get_tenant_id)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> IngestResponse:
    # content_hash is computed on the ORIGINAL text, not the redacted
    # text, dedup identity should come from the document's real identity
    # and shouldn't shift if redaction behavior changes later (new entity
    # type added, Presidio version bump)
    content_hash = _hash_content(body.text)

    # tenant_id isn't in this WHERE clause on purpose, RLS already scopes
    # every query on this session to the current tenant, adding it here
    # would just duplicate a guarantee the DB already gives for free
    already_exists = await session.scalar(
        select(Document).where(Document.content_hash == content_hash)
    )
    if already_exists is not None:
        # Why: content_hash intentionally never changes when redact_pii's
        # logic changes, so an unchanged hash does NOT mean the stored
        # chunks reflect the current redaction rules. Re-process only when
        # the stamped version actually differs, so a normal duplicate POST
        # (nothing about redaction has changed) stays a cheap no-op.
        if already_exists.pii_analyzer_version == PII_ANALYZER_VERSION:
            return await _existing_response(session, content_hash)
        return await _reprocess_stale_document(
            session, already_exists, body.text, tenant_id
        )

    redacted_text, pii_types_found = redact_pii(body.text)
    if pii_types_found:
        logger.info(
            "pii.redacted", entity_types=pii_types_found, source_path=body.source_path
        )

    document = Document(
        tenant_id=tenant_id,
        content_hash=content_hash,
        source_path=body.source_path,
        pii_entity_types=pii_types_found or None,
        pii_analyzer_version=PII_ANALYZER_VERSION,
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
        #
        # Known limitation: this path returns the winning request's
        # document as-is without checking ITS pii_analyzer_version. In the
        # rare case where the winner was itself stale, this loser won't
        # trigger a re-process; a subsequent /ingest of the same content
        # will. Acceptable given how narrow this race window is, but
        # worth stating rather than silently assuming it's covered.
        return await _existing_response(session, content_hash)

    # chunking runs on the REDACTED text, the original unredacted text
    # never reaches chunking, embedding, or the chunks table
    chunks = chunk_markdown(redacted_text)
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

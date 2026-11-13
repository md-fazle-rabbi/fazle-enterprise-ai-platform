"""
Document endpoints: create and list, just enough to prove tenant-scoped sessions work
end to end through the real API, and delete, which needs a real login.
"""

import uuid
from typing import Annotated

import structlog
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from governance.audit_log import append_entry
from opentelemetry import trace
from pydantic import BaseModel, ConfigDict
from redis.asyncio import Redis
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from rag_engine.cache import invalidate_tenant_cache
from rag_engine.db import (
    UserContext,
    get_session,
    get_tenant_id,
    get_user_context,
    get_user_session,
)
from rag_engine.models import Chunk, Document

router = APIRouter(prefix="/documents", tags=["documents"])
logger = structlog.get_logger()


class DocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    source_path: str


class DocumentCreate(BaseModel):
    source_path: str
    content_hash: str


@router.post("", response_model=DocumentOut, status_code=201)
async def create_document(
    body: DocumentCreate,
    tenant_id: Annotated[uuid.UUID, Depends(get_tenant_id)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> Document:
    # tenant_id comes from the header dependency, never the request body
    document = Document(
        tenant_id=tenant_id,
        content_hash=body.content_hash,
        source_path=body.source_path,
    )
    session.add(document)
    await session.flush()
    await session.refresh(document)
    return document


@router.get("", response_model=list[DocumentOut])
async def list_documents(
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[Document]:
    result = await session.scalars(select(Document))
    return list(result)


async def _drop_cached_answers(redis: Redis, tenant_id: str) -> None:
    # Why: runs after the response, so a failure can no longer change what the caller
    # sees. It is logged, and the cache's own one hour expiry still bounds how long a
    # stale entry can live.
    try:
        await invalidate_tenant_cache(redis, tenant_id)
    except Exception:
        logger.exception("documents.cache_invalidation_failed", tenant_id=tenant_id)


@router.delete("/{document_id}", status_code=204)
async def delete_document(
    document_id: uuid.UUID,
    request: Request,
    background_tasks: BackgroundTasks,
    ctx: Annotated[UserContext, Depends(get_user_context)],
    session: Annotated[AsyncSession, Depends(get_user_session, scope="function")],
) -> None:
    # Why a real login and not the demo key or the raw tenant header: deleting is
    # destructive and cannot be undone, so it needs an identity that can be named in
    # the audit log. The older routes above keep their tenant-only access.
    # Why 404 for another tenant's document too: it is invisible under row level
    # security, so "not yours" and "does not exist" look the same, which leaks nothing.
    document = await session.get(Document, document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="Not found")
    source_path = document.source_path

    # Why: chunks are deleted explicitly first, next to the foreign key's ON DELETE
    # CASCADE, so erasing a document does not depend on how cascades interact with row
    # level security.
    await session.execute(delete(Chunk).where(Chunk.document_id == document_id))
    await session.delete(document)
    await session.flush()

    await append_entry(
        session,
        tenant_id=str(ctx.tenant_id),
        event_type="document.deleted",
        event_data={"document_id": str(document_id), "source_path": source_path},
        trace_id=format(trace.get_current_span().get_span_context().trace_id, "032x"),
    )
    # Why: cached answers carry the text of the documents they came from, so the
    # tenant's cache is dropped once the delete has committed. The session dependency
    # has function scope, so its commit runs before the response is sent and before
    # this task starts.
    background_tasks.add_task(
        _drop_cached_answers, request.app.state.redis, str(ctx.tenant_id)
    )

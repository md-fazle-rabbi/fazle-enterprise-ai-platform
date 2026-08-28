"""
Minimal document endpoints, just enough to prove tenant-scoped sessions work
end to end through the real API, not only through psql.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from rag_engine.db import get_session, get_tenant_id
from rag_engine.models import Document

router = APIRouter(prefix="/documents", tags=["documents"])


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

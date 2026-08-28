import uuid
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from rag_engine.db import get_session
from rag_engine.models import Chunk
from rag_engine.search import hybrid_search

router = APIRouter(prefix="/search", tags=["search"])


class SearchRequest(BaseModel):
    query: str
    top_k: int = 10


class SearchResult(BaseModel):
    chunk_id: uuid.UUID
    text: str
    heading_path: list[str]
    document_id: uuid.UUID


class SearchResponse(BaseModel):
    results: list[SearchResult]


@router.post("", response_model=SearchResponse)
async def search(
    body: SearchRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> SearchResponse:
    chunk_ids = await hybrid_search(session, body.query, top_k=body.top_k)
    if not chunk_ids:
        return SearchResponse(results=[])

    # WHERE id IN (...) does not preserve list order, RRF order matters,
    # rebuild it explicitly after the re-fetch
    rows = (await session.scalars(select(Chunk).where(Chunk.id.in_(chunk_ids)))).all()
    by_id = {row.id: row for row in rows}
    ordered = [by_id[cid] for cid in chunk_ids if cid in by_id]

    return SearchResponse(
        results=[
            SearchResult(
                chunk_id=c.id, text=c.text, heading_path=c.heading_path, document_id=c.document_id
            )
            for c in ordered
        ]
    )
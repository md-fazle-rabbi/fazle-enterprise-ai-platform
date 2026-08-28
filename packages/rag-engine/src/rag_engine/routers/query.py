import uuid
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from rag_engine.db import get_session
from rag_engine.generation import extract_cited_indices, generate_answer
from rag_engine.models import Chunk
from rag_engine.search import hybrid_search

router = APIRouter(prefix="/query", tags=["query"])


class QueryRequest(BaseModel):
    question: str
    top_k: int = 5


class Citation(BaseModel):
    chunk_id: uuid.UUID
    document_id: uuid.UUID
    heading_path: list[str]
    text: str


class QueryResponse(BaseModel):
    answer: str
    citations: list[Citation]
    retrieved_but_uncited_count: int


@router.post("", response_model=QueryResponse)
async def query(
    body: QueryRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> QueryResponse:
    chunk_ids = await hybrid_search(session, body.question, top_k=body.top_k)
    if not chunk_ids:
        return QueryResponse(
            answer="I don't have any relevant information to answer this question.",
            citations=[],
            retrieved_but_uncited_count=0,
        )

    rows = (await session.scalars(select(Chunk).where(Chunk.id.in_(chunk_ids)))).all()
    by_id = {row.id: row for row in rows}
    ordered_chunks = [by_id[cid] for cid in chunk_ids if cid in by_id]

    answer = await generate_answer(body.question, [{"text": c.text} for c in ordered_chunks])

    cited_indices = extract_cited_indices(answer)
    cited_chunks = [ordered_chunks[i - 1] for i in cited_indices if 0 < i <= len(ordered_chunks)]

    return QueryResponse(
        answer=answer,
        citations=[
            Citation(chunk_id=c.id, document_id=c.document_id, heading_path=c.heading_path, text=c.text)
            for c in cited_chunks
        ],
        retrieved_but_uncited_count=len(ordered_chunks) - len(cited_chunks),
    )
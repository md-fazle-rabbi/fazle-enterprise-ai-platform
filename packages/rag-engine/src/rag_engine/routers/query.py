import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from rag_engine.db import get_session
from rag_engine.generation import extract_cited_indices, generate_answer
from rag_engine.parent_retrieval import expand_to_parents
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
    retrieved_context: list[Citation]
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
            retrieved_context=[],
            retrieved_but_uncited_count=0,
        )
    parents = await expand_to_parents(session, chunk_ids)
    if not parents:
        return QueryResponse(
            answer="I don't have any relevant information to answer this question.",
            citations=[],
            retrieved_context=[],
            retrieved_but_uncited_count=0,
        )

    answer = await generate_answer(
        body.question, [{"text": p["text"]} for p in parents]
    )
    cited_indices = extract_cited_indices(answer)
    cited = [parents[i - 1] for i in cited_indices if 0 < i <= len(parents)]

    def _to_citation(p: dict[str, Any]) -> Citation:
        return Citation(
            chunk_id=p["chunk_id"],
            document_id=p["document_id"],
            heading_path=p["heading_path"],
            text=p["text"],
        )

    return QueryResponse(
        answer=answer,
        citations=[_to_citation(p) for p in cited],
        # Everything actually retrieved and passed to the LLM for
        # generation — not filtered down to only what the model happened
        # to cite. RAGAS scoring needs this: faithfulness and
        # context_precision judge claims against the context the model
        # actually saw, not a post-hoc subset that depends on whether the
        # model remembered to add [N] citation tags in generation.
        retrieved_context=[_to_citation(p) for p in parents],
        retrieved_but_uncited_count=len(parents) - len(cited),
    )

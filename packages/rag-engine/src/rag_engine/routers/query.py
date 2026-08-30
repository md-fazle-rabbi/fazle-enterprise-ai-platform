import uuid
from typing import Annotated, Any

import structlog
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from rag_engine.db import get_session, get_tenant_id
from rag_engine.generation import extract_cited_indices, generate_answer
from rag_engine.models import ReviewQueueItem
from rag_engine.parent_retrieval import expand_to_parents
from rag_engine.pii import redact_pii
from rag_engine.search import hybrid_search

router = APIRouter(prefix="/query", tags=["query"])
logger = structlog.get_logger()


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
    flagged: bool
    flag_reasons: list[str]


def _flag_reasons(
    answer: str, cited_count: int, total_count: int
) -> tuple[str, list[str]]:
    """
    Pure function, no DB/session access, so it's testable without a
    running app. Returns (possibly-redacted answer, flag reasons).
    Redaction happens here, not as a side effect elsewhere, so the
    caller always gets back the version that's safe to store and return.
    """
    reasons = []
    redacted_answer, pii_types = redact_pii(answer)
    if pii_types:
        reasons.append("output_pii")
        answer = redacted_answer
    if total_count > 0 and cited_count == 0:
        reasons.append("no_citations")
    elif total_count > 0 and cited_count / total_count < 0.5:
        reasons.append("low_grounding")
    return answer, reasons


def _to_citation(p: dict[str, Any]) -> Citation:
    return Citation(
        chunk_id=p["chunk_id"],
        document_id=p["document_id"],
        heading_path=p["heading_path"],
        text=p["text"],
    )


@router.post("", response_model=QueryResponse)
async def query(
    body: QueryRequest,
    tenant_id: Annotated[uuid.UUID, Depends(get_tenant_id)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> QueryResponse:
    chunk_ids = await hybrid_search(session, body.question, top_k=body.top_k)
    if not chunk_ids:
        return QueryResponse(
            answer="I don't have any relevant information to answer this question.",
            citations=[],
            retrieved_context=[],
            retrieved_but_uncited_count=0,
            flagged=False,
            flag_reasons=[],
        )
    parents = await expand_to_parents(session, chunk_ids)
    if not parents:
        return QueryResponse(
            answer="I don't have any relevant information to answer this question.",
            citations=[],
            retrieved_context=[],
            retrieved_but_uncited_count=0,
            flagged=False,
            flag_reasons=[],
        )

    answer = await generate_answer(
        body.question, [{"text": p["text"]} for p in parents]
    )
    cited_indices = extract_cited_indices(answer)
    cited = [parents[i - 1] for i in cited_indices if 0 < i <= len(parents)]

    # Output-side PII scan runs on the raw generated answer, catches a
    # model reproducing something the input-side redaction missed, or
    # hallucinating PII-shaped content that was never in the retrieved
    # context at all. `answer` below is reassigned to the redacted
    # version so both the stored review-queue row and the response the
    # caller gets are the safe version, never the raw one.
    answer, reasons = _flag_reasons(answer, len(cited), len(parents))

    if reasons:
        session.add(
            ReviewQueueItem(
                tenant_id=tenant_id,
                question=body.question,
                answer=answer,
                flag_reasons=reasons,
            )
        )
        logger.info("review_queue.flagged", reasons=reasons)

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
        flagged=bool(reasons),
        flag_reasons=reasons,
    )

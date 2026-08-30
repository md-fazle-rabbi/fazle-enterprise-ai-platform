import uuid
from typing import Annotated, Any

import structlog
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from rag_engine.crag import grade_relevance
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
    # ---------------------------------------------------------
    # 1. Retrieve candidate chunks
    # ---------------------------------------------------------
    chunk_ids = await hybrid_search(
        session,
        body.question,
        top_k=body.top_k,
    )

    if not chunk_ids:
        return QueryResponse(
            answer="I don't have any relevant information to answer this question.",
            citations=[],
            retrieved_context=[],
            retrieved_but_uncited_count=0,
            flagged=False,
            flag_reasons=[],
        )

    # ---------------------------------------------------------
    # 2. Expand child chunks to their parent chunks
    # ---------------------------------------------------------
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

    # ---------------------------------------------------------
    # 3. CRAG relevance grading
    #
    # Grade the retrieved context BEFORE spending money on
    # answer generation.
    # ---------------------------------------------------------
    is_relevant = await grade_relevance(
        body.question,
        parents,
    )

    if not is_relevant:
        logger.info(
            "crag.context_irrelevant",
            question=body.question,
            retrieved_count=len(parents),
        )

        return QueryResponse(
            answer="I don't have any relevant information to answer this question.",
            citations=[],
            retrieved_context=[_to_citation(p) for p in parents],
            retrieved_but_uncited_count=len(parents),
            flagged=False,
            flag_reasons=[],
        )

    logger.info(
        "crag.context_relevant",
        question=body.question,
        retrieved_count=len(parents),
    )

    # ---------------------------------------------------------
    # 4. Generate answer ONLY after CRAG says the context
    #    is relevant.
    # ---------------------------------------------------------
    answer = await generate_answer(
        body.question,
        [{"text": p["text"]} for p in parents],
    )

    # ---------------------------------------------------------
    # 5. Extract citations from generated answer
    # ---------------------------------------------------------
    cited_indices = extract_cited_indices(answer)

    cited = [parents[i - 1] for i in cited_indices if 0 < i <= len(parents)]

    # ---------------------------------------------------------
    # 6. Output-side PII + grounding checks
    # ---------------------------------------------------------
    answer, reasons = _flag_reasons(
        answer,
        len(cited),
        len(parents),
    )

    # ---------------------------------------------------------
    # 7. Send problematic answers to review queue
    # ---------------------------------------------------------
    if reasons:
        session.add(
            ReviewQueueItem(
                tenant_id=tenant_id,
                question=body.question,
                answer=answer,
                flag_reasons=reasons,
            )
        )

        logger.info(
            "review_queue.flagged",
            reasons=reasons,
        )

    # ---------------------------------------------------------
    # 8. Return answer + citations + complete retrieved context
    # ---------------------------------------------------------
    return QueryResponse(
        answer=answer,
        citations=[_to_citation(p) for p in cited],
        retrieved_context=[_to_citation(p) for p in parents],
        retrieved_but_uncited_count=len(parents) - len(cited),
        flagged=bool(reasons),
        flag_reasons=reasons,
    )

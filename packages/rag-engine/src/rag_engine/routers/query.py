"""
POST /query: the main RAG pipeline. Semantic cache check, hybrid retrieval,
parent chunk expansion, CRAG relevance grading, citation-enforced generation,
then output-side PII/grounding/canary/lethal-trifecta checks before the
answer is returned. Retrieval and output_checks each carry their own
OpenTelemetry span here; CRAG grading and generation carry theirs inside
crag.py and generation.py respectively, next to the Gemini call each one
makes, so Langfuse shows all four pipeline stages with real latency and
captured input/output rather than just the outer HTTP span.

POST /query/stream runs the very same pipeline (run_query) and reports each
stage as a Server-Sent Event, then the final checked answer. It streams
progress, not model tokens: the output checks can rewrite the answer (PII
redaction), so nothing that was generated is shown before they have run.
"""

import asyncio
import contextlib
import json
import uuid
from collections.abc import AsyncIterable, Awaitable, Callable
from typing import Annotated, Any, Literal

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.sse import EventSourceResponse, ServerSentEvent
from governance.audit_log import append_entry
from observability.alerts import send_slack_alert
from opentelemetry import trace
from pydantic import BaseModel
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from rag_engine.cache import get_cached_answer, store_cached_answer
from rag_engine.crag import grade_relevance
from rag_engine.db import get_session, get_tenant_id
from rag_engine.embeddings import embed_query
from rag_engine.generation import extract_cited_indices, generate_answer
from rag_engine.models import QueryLog, ReviewQueueItem
from rag_engine.parent_retrieval import expand_to_parents
from rag_engine.pii import redact_pii
from rag_engine.quota import QuotaExceeded, check_and_consume
from rag_engine.search import hybrid_search
from rag_engine.security.canary import scan_for_canary_leak
from rag_engine.security.firewall import assess
from rag_engine.security.trifecta import assess_trifecta

router = APIRouter(prefix="/query", tags=["query"])
logger = structlog.get_logger()
_tracer = trace.get_tracer(__name__)

# Why: these names are what a streaming client sees, one event per stage start.
Stage = Literal["cache_lookup", "retrieval", "grading", "generation", "output_checks"]
StageCallback = Callable[[Stage], Awaitable[None]]


async def _ignore_stage(stage: Stage) -> None:
    """The plain /query endpoint reports no progress."""


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


async def run_query(
    body: QueryRequest,
    tenant_id: uuid.UUID,
    session: AsyncSession,
    redis: Redis,
    on_stage: StageCallback = _ignore_stage,
) -> QueryResponse:
    """
    The whole pipeline, shared by /query and /query/stream so the two can
    never drift apart. on_stage is told when each stage starts.
    """
    # ---------------------------------------------------------
    # 0. Semantic cache check
    #
    # Same Redis instance Day 3's rate limiter and Day 5's kill
    # switch already use.
    # ---------------------------------------------------------
    await on_stage("cache_lookup")
    query_vector = await embed_query(body.question)

    session.add(
        QueryLog(tenant_id=tenant_id, question=body.question, embedding=query_vector)
    )

    cached = await get_cached_answer(redis, str(tenant_id), query_vector)
    if cached is not None:
        return QueryResponse(
            answer=cached,
            citations=[],
            retrieved_context=[],
            retrieved_but_uncited_count=0,
            flagged=False,
            flag_reasons=["cache_hit"],
        )

    # ---------------------------------------------------------
    # 1-2. Retrieve candidate chunks, expand to parent sections
    #
    # One "retrieval" span covers both steps so Langfuse shows a
    # single retrieval latency, matching how the README describes
    # the four pipeline stages.
    # ---------------------------------------------------------
    await on_stage("retrieval")
    with _tracer.start_as_current_span("retrieval") as span:
        span.set_attribute(
            "langfuse.observation.input",
            json.dumps({"question": body.question, "top_k": body.top_k}),
        )

        chunk_ids = await hybrid_search(
            session,
            body.question,
            top_k=body.top_k,
        )

        if not chunk_ids:
            span.set_attribute(
                "langfuse.observation.output",
                json.dumps({"retrieved_chunk_count": 0}),
            )
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
            span.set_attribute(
                "langfuse.observation.output",
                json.dumps({"retrieved_chunk_count": 0}),
            )
            return QueryResponse(
                answer="I don't have any relevant information to answer this question.",
                citations=[],
                retrieved_context=[],
                retrieved_but_uncited_count=0,
                flagged=False,
                flag_reasons=[],
            )

        span.set_attribute(
            "langfuse.observation.output",
            json.dumps({"retrieved_chunk_count": len(parents)}),
        )

    # ---------------------------------------------------------
    # 3. CRAG relevance grading
    #
    # Grade the retrieved context BEFORE spending money on
    # answer generation. Per-stage span lives inside
    # crag.grade_relevance itself, alongside the Gemini call.
    # ---------------------------------------------------------
    await on_stage("grading")
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
    #    is relevant. Per-stage span lives inside generate_answer
    #    itself, alongside the Gemini call.
    # ---------------------------------------------------------
    await on_stage("generation")
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
    # 6, 6b, 6c. Output-side PII, grounding, canary, and lethal
    # trifecta checks, grouped under one "output_checks" span so
    # Langfuse shows this as its own pipeline stage.
    # ---------------------------------------------------------
    await on_stage("output_checks")
    with _tracer.start_as_current_span("output_checks") as span:
        answer, reasons = _flag_reasons(
            answer,
            len(cited),
            len(parents),
        )

        # -----------------------------------------------------
        # 6b. Canary token leak detection
        #
        # Canary tokens are planted in documents/prompts to detect
        # prompt-injection exfiltration attempts. If one shows up in
        # the generated answer, that's a strong signal of a successful
        # injection/exfil attempt and needs immediate escalation.
        # -----------------------------------------------------
        leaked_canaries = scan_for_canary_leak(answer)
        if leaked_canaries:
            await send_slack_alert(
                "CANARY TOKEN LEAKED",
                {
                    "tenant_id": str(tenant_id),
                    "canary_count": len(leaked_canaries),
                    "question": body.question,
                },
            )
            reasons.append("canary_leak")

        # -----------------------------------------------------
        # 6c. Lethal trifecta assessment
        #
        # Checks whether this request simultaneously exhibits private
        # data access, untrusted content exposure, and an exfiltration
        # channel, the combination that makes prompt injection
        # dangerous rather than merely annoying.
        # -----------------------------------------------------
        injection_scores = [(await assess(p["text"])).classifier_score for p in parents]
        max_injection_score = max(injection_scores, default=0.0)
        trifecta = assess_trifecta(
            answer,
            has_citations=bool(cited),
            max_classifier_score_on_context=max_injection_score,
        )
        if trifecta.triggered:
            await send_slack_alert(
                "Lethal Trifecta conditions met",
                {
                    "tenant_id": str(tenant_id),
                    "conditions_met": trifecta.conditions_met,
                    "private_data_access": trifecta.private_data_access,
                    "untrusted_content_exposure": trifecta.untrusted_content_exposure,
                    "exfiltration_channel": trifecta.exfiltration_channel,
                },
            )
            reasons.append("lethal_trifecta")

        span.set_attribute(
            "langfuse.observation.output",
            json.dumps({"flag_reasons": reasons}),
        )

        # -----------------------------------------------------
        # 6e. Hash-chained audit log entry, only for flagged
        # queries -- an entry per clean query would flood the
        # log with nothing worth reviewing later. trace_id links
        # each entry back to its full Langfuse trace.
        # -----------------------------------------------------
        if reasons:
            current_trace_id = format(
                trace.get_current_span().get_span_context().trace_id, "032x"
            )
            await append_entry(
                session,
                tenant_id=str(tenant_id),
                event_type="query.flagged",
                event_data={"reasons": reasons, "question": body.question},
                trace_id=current_trace_id,
            )

    # ---------------------------------------------------------
    # 6d. Quota check + cache write
    #
    # Consume quota only after a real generation (cache hits never
    # reach here). token estimate is a rough placeholder -- replace
    # with real usage.output_tokens once the generation client
    # surfaces it.
    # ---------------------------------------------------------
    try:
        quota_state = await check_and_consume(
            redis,
            str(tenant_id),
            tokens_used=len(answer) // 4,
        )
    except QuotaExceeded as e:
        raise HTTPException(status_code=429, detail=str(e)) from e

    await store_cached_answer(redis, str(tenant_id), query_vector, answer)
    if quota_state != "ok":
        reasons.append(f"quota_{quota_state}")

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


@router.post("", response_model=QueryResponse)
async def query(
    body: QueryRequest,
    tenant_id: Annotated[uuid.UUID, Depends(get_tenant_id)],
    session: Annotated[AsyncSession, Depends(get_session)],
    request: Request,
) -> QueryResponse:
    return await run_query(body, tenant_id, session, request.app.state.redis)


async def _close_session_safely(
    session_cm: contextlib.AbstractAsyncContextManager[AsyncSession],
    exc: BaseException | None,
) -> None:
    """
    Runs session_cm.__aexit__ (transaction commit/rollback + connection
    close) as its own task, so it completes even if the task calling this
    function is itself being cancelled (the client disconnected mid-
    pipeline). A single `asyncio.shield()` + one retry is not enough:
    verified locally that when cancellation keeps arriving at every
    checkpoint (matching the repeated "Cancelled via cancel scope ..."
    seen in production, most likely Starlette/anyio re-cancelling this
    task until its own scope is dismissed), a single retry can itself be
    cancelled before the cleanup task finishes. So this loops, re-awaiting
    the shield, until the cleanup task itself reports done -- only then is
    the cancellation (if any arrived) let through. Without this, the
    rollback/connection-close runs unshielded inside the already-
    cancelled task and the DB driver's own internal await gets cancelled
    again mid-cleanup -- surfacing as the misleading "Exception
    terminating connection" / CancelledError traceback from SQLAlchemy's
    connection pool (do_terminate) we saw in the red-team run.
    See https://github.com/sqlalchemy/sqlalchemy/issues/8145.
    """
    exc_info = (type(exc), exc, exc.__traceback__) if exc else (None, None, None)
    cleanup = asyncio.create_task(session_cm.__aexit__(*exc_info))
    was_cancelled = False
    while True:
        try:
            await asyncio.shield(cleanup)
            break
        except asyncio.CancelledError:
            was_cancelled = True
            if cleanup.done():
                break
    if was_cancelled:
        raise asyncio.CancelledError()


@router.post("/stream", response_class=EventSourceResponse)
async def query_stream(
    body: QueryRequest,
    tenant_id: Annotated[uuid.UUID, Depends(get_tenant_id)],
    request: Request,
) -> AsyncIterable[ServerSentEvent]:
    """
    Same pipeline as POST /query, as Server-Sent Events: one "stage" event per
    stage start, then exactly one "result" (the QueryResponse) or "error"
    event. There is no reconnect: a retry would run generation again and use
    quota again, so clients must not retry blindly.
    """
    events: asyncio.Queue[ServerSentEvent | None] = asyncio.Queue()

    async def on_stage(stage: Stage) -> None:
        await events.put(ServerSentEvent(data={"stage": stage}, event="stage"))

    async def work() -> None:
        # Why: entered/exited manually instead of `async with`, so cleanup
        # can be run cancel-safely (see _close_session_safely) rather than
        # running inside whatever cancellation is already unwinding an
        # `async with` block.
        session_cm = contextlib.asynccontextmanager(get_session)(request, tenant_id)
        session = await session_cm.__aenter__()

        try:
            response = await run_query(
                body, tenant_id, session, request.app.state.redis, on_stage
            )
        except HTTPException as exc:
            await _close_session_safely(session_cm, exc)
            await events.put(
                ServerSentEvent(
                    data={"status": exc.status_code, "detail": exc.detail},
                    event="error",
                )
            )
        except asyncio.CancelledError as exc:
            # Why: the task is already being cancelled here (client
            # disconnected mid-pipeline). See _close_session_safely's
            # docstring for why the cleanup must run this way rather than
            # inline.
            await _close_session_safely(session_cm, exc)
            raise
        except Exception as exc:
            # Why: once the stream has started the HTTP status can no longer
            # change, so failures become an error event. The reason stays in
            # the log, never in the event.
            logger.exception("query.stream_failed")
            await _close_session_safely(session_cm, exc)
            await events.put(
                ServerSentEvent(
                    data={"status": 500, "detail": "Internal server error"},
                    event="error",
                )
            )
        else:
            # Why: the result is sent only after the transaction has committed.
            await _close_session_safely(session_cm, None)
            await events.put(
                ServerSentEvent(data=response.model_dump(mode="json"), event="result")
            )
        finally:
            await events.put(None)

    worker = asyncio.create_task(work())
    try:
        while (event := await events.get()) is not None:
            yield event
    finally:
        # Why: reached on normal end and when the client disconnects. Cancelling
        # stops pipeline work nobody is waiting for; _close_session_safely inside
        # work() handles the transaction rollback cancel-safely.
        worker.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await worker

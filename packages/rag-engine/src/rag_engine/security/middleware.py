"""
Runs the firewall on request bodies before they reach search or
generation. Only inspects /query, /query/stream and /ingest, the only
endpoints that carry free text into an LLM context. Paths are matched
exactly, so a new endpoint that takes a question MUST be added here.

This is a plain ASGI middleware, not a BaseHTTPMiddleware subclass.
BaseHTTPMiddleware wraps call_next in its own task group and re-wraps
`receive`, which conflicts with FastAPI's native SSE producer (also
task-group based) and with any receive-replay trick: after the body has
been read and replayed once, a later real receive() call (the disconnect
listener) gets the replayed http.request again instead of the actual
http.disconnect, and Starlette raises RuntimeError. A plain ASGI
middleware avoids both problems.
"""

import json

import structlog
from rag_engine.security.firewall import assess
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

logger = structlog.get_logger()
_INSPECTED_PATHS = {
    "/query": "question",
    "/query/stream": "question",
    "/ingest": "text",
}


class InjectionFirewallMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] != "POST":
            await self.app(scope, receive, send)
            return

        field = _INSPECTED_PATHS.get(scope["path"])
        if not field:
            await self.app(scope, receive, send)
            return

        # Buffer the full body ourselves. Any real ASGI message that isn't
        # a body chunk (e.g. an early disconnect) stops buffering and is
        # handled by the replay wrapper below like any other message.
        body_chunks: list[bytes] = []
        more_body = True
        leftover_message: Message | None = None
        while more_body:
            message = await receive()
            if message["type"] != "http.request":
                leftover_message = message
                break
            body_chunks.append(message.get("body", b""))
            more_body = message.get("more_body", False)
        body_bytes = b"".join(body_chunks)

        try:
            text = json.loads(body_bytes).get(field, "") if body_bytes else ""
        except (json.JSONDecodeError, AttributeError):
            text = ""

        if text:
            result = await assess(text)
            if result.action == "block":
                logger.warning(
                    "firewall.blocked",
                    path=scope["path"],
                    pattern_hit=result.pattern_hit,
                    classifier_score=result.classifier_score,
                )
                response = JSONResponse(
                    status_code=400,
                    content={
                        "detail": "Request blocked: possible prompt injection detected."
                    },
                )
                await response(scope, receive, send)
                return
            if result.action == "flag":
                logger.info(
                    "firewall.flagged",
                    path=scope["path"],
                    classifier_score=result.classifier_score,
                )

        # Replay the buffered body exactly once, then fall through to the
        # real receive() for every subsequent call -- disconnect messages
        # included. This is what BaseHTTPMiddleware's one-shot patch got
        # wrong: it never fell through, so later calls kept re-delivering
        # the same http.request message forever.
        replayed = False

        async def receive_with_replay() -> Message:
            nonlocal replayed
            if not replayed:
                replayed = True
                return {
                    "type": "http.request",
                    "body": body_bytes,
                    "more_body": False,
                }
            if leftover_message is not None:
                return leftover_message
            return await receive()

        await self.app(scope, receive_with_replay, send)

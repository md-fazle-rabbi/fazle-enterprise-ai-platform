"""
Caps the size of a request body before anything reads it. Starlette limits only the plain
fields of a multipart form (1 MiB each). A file part is written to a temporary file with no
limit, and `await file.read()` then loads all of it into memory. The firewall middleware
also buffers the whole JSON body. This middleware stops both.

Two checks. A declared Content-Length above the limit is refused at once, before a byte is
read. A body with no Content-Length (chunked), or a wrong one, is counted as it arrives and
stopped when it passes the limit.

It is a plain ASGI middleware, for the same reason as the firewall middleware (see
security/middleware.py). It is added after the firewall, so it is the outer one and an
oversized body never reaches the firewall.
"""

from collections.abc import Mapping

import structlog
from fastapi import HTTPException
from rag_engine.upload_limits import BODY_LIMITS
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

logger = structlog.get_logger()


def _detail(limit: int) -> str:
    return f"Request body is too large for this endpoint. The limit is {limit} bytes."


class PayloadTooLarge(HTTPException):
    """
    Raised from the wrapped receive() once the body passes the limit. It is an
    HTTPException on purpose: FastAPI turns any other exception raised while it parses a
    form into a 400, but lets an HTTPException through, so the caller gets a 413.
    Connection: close tells the client to stop sending the rest of the body.
    """

    def __init__(self, limit: int) -> None:
        super().__init__(
            status_code=413,
            detail=_detail(limit),
            headers={"Connection": "close"},
        )


def _declared_length(scope: Scope) -> int | None:
    for name, value in scope["headers"]:
        if name == b"content-length":
            try:
                return int(value)
            except ValueError:
                return None
    return None


async def _reject(
    scope: Scope, receive: Receive, send: Send, limit: int, seen: int
) -> None:
    logger.warning("request.too_large", path=scope["path"], limit=limit, bytes=seen)
    response = JSONResponse(
        status_code=413,
        content={"detail": _detail(limit)},
        headers={"Connection": "close"},
    )
    await response(scope, receive, send)


class RequestSizeLimitMiddleware:
    def __init__(self, app: ASGIApp, limits: Mapping[str, int] | None = None) -> None:
        self.app = app
        self.limits = BODY_LIMITS if limits is None else limits

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        limit = None
        if scope["type"] == "http" and scope["method"] == "POST":
            limit = self.limits.get(scope["path"])
        if limit is None:
            await self.app(scope, receive, send)
            return
        await self._limited(scope, receive, send, limit)

    async def _limited(
        self, scope: Scope, receive: Receive, send: Send, limit: int
    ) -> None:
        declared = _declared_length(scope)
        if declared is not None and declared > limit:
            await _reject(scope, receive, send, limit, declared)
            return

        received = 0
        response_started = False

        async def counting_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    raise PayloadTooLarge(limit)
            return message

        async def tracking_send(message: Message) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, counting_receive, tracking_send)
        except PayloadTooLarge:
            # Why: raised inside a route, FastAPI and Starlette already turned it into a
            # 413 and the response has started. Raised outside a route (the firewall
            # middleware reading the body), nothing has been sent yet, so answer here.
            if response_started:
                raise
            await _reject(scope, receive, send, limit, received)

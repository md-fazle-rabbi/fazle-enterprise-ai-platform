"""
Runs the firewall on request bodies before they reach search or
generation. Only inspects /query and /ingest, the only two endpoints that
carry free text into an LLM context.
"""

import json

import structlog
from fastapi import Request
from rag_engine.security.firewall import assess
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

logger = structlog.get_logger()
_INSPECTED_PATHS = {"/query": "question", "/ingest": "text"}


class InjectionFirewallMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        field = _INSPECTED_PATHS.get(request.url.path)
        if field and request.method == "POST":
            body_bytes = await request.body()
            try:
                text = json.loads(body_bytes).get(field, "")
            except (json.JSONDecodeError, AttributeError):
                text = ""

            if text:
                result = assess(text)
                if result.action == "block":
                    logger.warning(
                        "firewall.blocked",
                        path=request.url.path,
                        pattern_hit=result.pattern_hit,
                        classifier_score=result.classifier_score,
                    )
                    return JSONResponse(
                        status_code=400,
                        content={
                            "detail": "Request blocked: possible prompt injection detected."
                        },
                    )
                if result.action == "flag":
                    logger.info(
                        "firewall.flagged",
                        path=request.url.path,
                        classifier_score=result.classifier_score,
                    )

            # request.body() consumes the stream once, rebuild it so the
            # route handler downstream can still read it. This touches a
            # private Starlette attribute, a known workaround, not a
            # documented public API, flagged so it isn't mistaken for one.
            async def receive():
                return {"type": "http.request", "body": body_bytes}

            request._receive = receive

        return await call_next(request)

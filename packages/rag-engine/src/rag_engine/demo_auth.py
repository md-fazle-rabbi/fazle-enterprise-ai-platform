"""
Demo-mode auth: a visitor using the documented Bearer token gets mapped to
a fixed, isolated demo tenant automatically, no need to understand the
tenant model to try the API. Real per-user API keys are stated future
scope, this is demo convenience only, rate-limited specifically because
it's public.
"""

import time
import uuid

from core.settings import settings
from fastapi import HTTPException, Request
from redis.asyncio import Redis

DEMO_TENANT_ID = uuid.UUID("00000000-0000-0000-0000-000000000001")
DEMO_HOURLY_LIMIT = 20


async def resolve_demo_tenant(request: Request) -> uuid.UUID | None:
    auth_header = request.headers.get("authorization", "")
    if not auth_header.startswith("Bearer "):
        return None
    if auth_header.removeprefix("Bearer ") != settings.demo_api_key:
        raise HTTPException(status_code=401, detail="Invalid demo API key")

    redis: Redis = request.app.state.redis
    hour_bucket = int(time.time() // 3600)
    key = f"demo_rate:{hour_bucket}"
    count = await redis.incr(key)
    if count == 1:
        await redis.expire(key, 3600)
    if count > DEMO_HOURLY_LIMIT:
        raise HTTPException(
            status_code=429, detail="Demo rate limit reached, try again next hour"
        )

    return DEMO_TENANT_ID

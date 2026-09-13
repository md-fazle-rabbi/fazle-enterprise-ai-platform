"""
Operator-facing kill-switch control. Separate small app from rag-engine's
tenant-facing API on purpose, this needs its own network restriction and
auth before it's anything but a local demo, same stated gap as the
review-queue endpoint.
"""

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from core.settings import settings
from fastapi import FastAPI
from pydantic import BaseModel
from redis.asyncio import Redis as AsyncRedis

from agent_mesh.kill_switch import activate, deactivate, is_active


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None]:
    app.state.redis = AsyncRedis.from_url(settings.redis_url)
    yield
    await app.state.redis.aclose()


app = FastAPI(title="agent-mesh admin", lifespan=lifespan)


class KillSwitchRequest(BaseModel):
    reason: str


@app.post("/kill-switch/activate")
async def activate_kill_switch(body: KillSwitchRequest) -> dict[str, str]:
    await activate(app.state.redis, body.reason)
    return {"status": "activated", "reason": body.reason}


@app.post("/kill-switch/deactivate")
async def deactivate_kill_switch() -> dict[str, str]:
    await deactivate(app.state.redis)
    return {"status": "deactivated"}


@app.get("/kill-switch/status")
async def kill_switch_status() -> dict[str, bool]:
    return {"active": await is_active(app.state.redis)}

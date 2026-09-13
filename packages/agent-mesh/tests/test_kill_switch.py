"""Needs docker compose up -d redis first."""

import asyncio
import os
import time

import pytest
from agent_mesh.kill_switch import KillSwitchListener, activate, deactivate
from redis.asyncio import Redis

pytestmark = pytest.mark.asyncio


def _redis_url() -> str:
    return os.getenv("REDIS_URL", "redis://localhost:6379/0")


async def test_kill_switch_halts_runaway_loop_within_5_seconds() -> None:
    redis = Redis.from_url(_redis_url())
    await deactivate(redis)  # clean slate

    listener = KillSwitchListener(redis)
    await listener.start()
    iterations = 0

    async def runaway_loop() -> None:
        nonlocal iterations
        while not listener.triggered.is_set():
            iterations += 1
            await asyncio.sleep(0.05)  # simulates a fast agent work loop

    loop_task = asyncio.create_task(runaway_loop())
    await asyncio.sleep(0.5)  # let it actually start "running away"
    assert iterations > 0

    start = time.monotonic()
    await activate(redis, reason="test: simulated runaway loop")
    await asyncio.wait_for(loop_task, timeout=5.0)
    elapsed = time.monotonic() - start

    print(f"Kill switch propagation: {elapsed:.3f}s")
    assert elapsed < 5.0

    await listener.stop()
    await deactivate(redis)


async def test_kill_switch_clears_via_pubsub() -> None:
    """Exercises the clear path specifically: activate() sets triggered,
    then deactivate() must clear it via the SAME pub/sub message path,
    not just via a direct call on the same listener instance. This is
    the path that silently breaks if the Redis client isn't built with
    decode_responses=True — message["data"] arrives as bytes and the
    "__cleared__" comparison never matches, so triggered stays set
    forever even though deactivate() "succeeded"."""
    redis = Redis.from_url(_redis_url())
    await deactivate(redis)  # clean slate

    listener = KillSwitchListener(redis)
    await listener.start()

    await activate(redis, reason="test: clear path")
    await asyncio.wait_for(listener.triggered.wait(), timeout=2.0)
    assert listener.triggered.is_set()

    await deactivate(redis)

    cleared = False
    start = time.monotonic()
    while time.monotonic() - start < 2.0:
        if not listener.triggered.is_set():
            cleared = True
            break
        await asyncio.sleep(0.05)

    assert cleared, "kill switch did not clear via pub/sub within timeout"

    await listener.stop()

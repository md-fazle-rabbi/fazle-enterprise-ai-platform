"""Needs docker compose up -d redis first."""

import os
import uuid

import pytest
from redis.asyncio import Redis

from agent_mesh.messaging.bus import (
    ack,
    consume_one,
    ensure_consumer_group,
    fail,
    publish,
)
from agent_mesh.messaging.envelope import MessageEnvelope, sign_envelope
from agent_mesh.messaging.keys import generate_keypair

pytestmark = pytest.mark.asyncio


async def _redis() -> Redis:
    # decode_responses=True is required: bus.py looks up stream fields by
    # str keys ("envelope"), and redis-py returns bytes keys/values
    # without this flag, which fails with KeyError despite the data
    # being present.
    return Redis.from_url(
        os.getenv("REDIS_URL", "redis://localhost:6379/0"), decode_responses=True
    )


async def test_publish_and_consume_round_trip():
    redis = await _redis()
    priv, pub = generate_keypair()
    recipient = f"test-{uuid.uuid4()}"
    await ensure_consumer_group(redis, recipient)

    env = sign_envelope(
        MessageEnvelope(sender="a", recipient=recipient, type="ping", payload={}), priv
    )
    await publish(redis, env)

    received = await consume_one(redis, recipient, "c1", pub)
    assert received is not None
    assert received.envelope.msg_id == env.msg_id
    await ack(redis, recipient, received)


async def test_three_failures_dead_letters():
    redis = await _redis()
    priv, pub = generate_keypair()
    recipient = f"test-{uuid.uuid4()}"
    await ensure_consumer_group(redis, recipient)

    env = sign_envelope(
        MessageEnvelope(sender="a", recipient=recipient, type="ping", payload={}), priv
    )
    await publish(redis, env)

    for _ in range(3):
        # claim_idle_ms=0 makes retry immediate for a deterministic test,
        # production default (5000ms) avoids reclaiming a message from a
        # consumer still actively working on it
        received = await consume_one(redis, recipient, "c1", pub, claim_idle_ms=0)
        assert received is not None
        await fail(redis, recipient, received)

    dlq = await redis.xrange(f"agent_mesh:{recipient}:dlq")
    assert len(dlq) == 1

"""
Redis Streams transport. Consumer groups give per-message delivery-count
tracking natively, that count is what drives the dead-letter threshold,
not a separately maintained counter.

IMPORTANT: every Redis client passed into these functions must be
constructed with decode_responses=True. XREADGROUP/XAUTOCLAIM field
dicts are looked up by str keys ("envelope") throughout this module —
without decode_responses=True, redis-py returns bytes keys/values
(b"envelope"), and fields["envelope"] fails with KeyError despite the
data being present. Use make_redis_client() below rather than
constructing Redis directly.
"""

from dataclasses import dataclass

import structlog
from agent_mesh.messaging.envelope import MessageEnvelope, verify_envelope
from cryptography.hazmat.primitives.asymmetric import rsa
from redis.asyncio import Redis

logger = structlog.get_logger()
STREAM_PREFIX = "agent_mesh:"
DLQ_SUFFIX = ":dlq"
MAX_DELIVERY_ATTEMPTS = 3


def make_redis_client(url: str) -> Redis:
    """decode_responses=True is load-bearing here: stream field dicts are
    looked up by str keys throughout this module, not bytes."""
    return Redis.from_url(url, decode_responses=True)


def _stream_key(recipient: str) -> str:
    return f"{STREAM_PREFIX}{recipient}"


@dataclass
class ReceivedMessage:
    envelope: MessageEnvelope
    redis_msg_id: str


async def publish(redis: Redis, envelope: MessageEnvelope) -> str:
    return await redis.xadd(
        _stream_key(envelope.recipient), {"envelope": envelope.model_dump_json()}
    )


async def ensure_consumer_group(
    redis: Redis, recipient: str, group: str = "workers"
) -> None:
    try:
        await redis.xgroup_create(_stream_key(recipient), group, id="0", mkstream=True)
    except Exception as e:
        if "BUSYGROUP" not in str(e):
            raise


async def consume_one(
    redis: Redis,
    recipient: str,
    consumer_name: str,
    public_key: rsa.RSAPublicKey,
    group: str = "workers",
    claim_idle_ms: int = 5000,
) -> ReceivedMessage | None:
    """
    Checks reclaimable pending messages (stuck >claim_idle_ms, this IS the
    retry path) before genuinely new ones, so one method handles both
    first delivery and retry.
    """
    stream = _stream_key(recipient)

    _, claimed, _ = await redis.xautoclaim(
        stream, group, consumer_name, min_idle_time=claim_idle_ms, start_id="0"
    )
    if claimed:
        msg_id, fields = claimed[0]
    else:
        result = await redis.xreadgroup(
            group, consumer_name, {stream: ">"}, count=1, block=1000
        )
        if not result or not result[0][1]:
            return None
        msg_id, fields = result[0][1][0]

    envelope = MessageEnvelope.model_validate_json(fields["envelope"])

    if envelope.is_expired():
        logger.warning("messaging.expired", msg_id=envelope.msg_id)
        await redis.xack(stream, group, msg_id)
        return None

    if not verify_envelope(envelope, public_key):
        logger.warning(
            "messaging.signature_invalid",
            msg_id=envelope.msg_id,
            sender=envelope.sender,
        )
        await _dead_letter(redis, recipient, envelope, reason="invalid_signature")
        await redis.xack(stream, group, msg_id)
        return None

    return ReceivedMessage(envelope=envelope, redis_msg_id=msg_id)


async def ack(
    redis: Redis, recipient: str, received: ReceivedMessage, group: str = "workers"
) -> None:
    await redis.xack(_stream_key(recipient), group, received.redis_msg_id)


async def fail(
    redis: Redis, recipient: str, received: ReceivedMessage, group: str = "workers"
) -> None:
    stream = _stream_key(recipient)
    pending = await redis.xpending_range(
        stream, group, min=received.redis_msg_id, max=received.redis_msg_id, count=1
    )
    delivery_count = pending[0]["times_delivered"] if pending else 1

    if delivery_count >= MAX_DELIVERY_ATTEMPTS:
        await _dead_letter(
            redis, recipient, received.envelope, reason="max_delivery_attempts"
        )
        await redis.xack(stream, group, received.redis_msg_id)
        logger.warning(
            "messaging.dead_lettered",
            msg_id=received.envelope.msg_id,
            attempts=delivery_count,
        )
    # else: leave it pending, unacked, next XAUTOCLAIM retries it


async def _dead_letter(
    redis: Redis, recipient: str, envelope: MessageEnvelope, reason: str
) -> None:
    await redis.xadd(
        _stream_key(recipient) + DLQ_SUFFIX,
        {"envelope": envelope.model_dump_json(), "reason": reason},
    )

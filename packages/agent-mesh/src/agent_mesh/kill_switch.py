"""
Kill switch: halts every agent via fast pub/sub broadcast, not a key
agents have to remember to poll. Every agent subscribes to the kill
channel at startup in a background task, so activation pushes instantly
to already-running agents. The Redis key is secondary, for anything
starting up after activation, the pub/sub message is what gives real
sub-5-second propagation.
"""

import asyncio

import structlog
from redis.asyncio import Redis
from redis.asyncio.client import PubSub

logger = structlog.get_logger()
KILL_SWITCH_KEY = "agent_mesh:kill_switch:active"
KILL_SWITCH_CHANNEL = "agent_mesh:kill_switch"
_CLEARED_SENTINEL = "__cleared__"


async def activate(redis: Redis, reason: str) -> None:
    await redis.set(KILL_SWITCH_KEY, reason)
    await redis.publish(KILL_SWITCH_CHANNEL, reason)
    logger.warning("kill_switch.activated", reason=reason)


async def deactivate(redis: Redis) -> None:
    await redis.delete(KILL_SWITCH_KEY)
    await redis.publish(KILL_SWITCH_CHANNEL, _CLEARED_SENTINEL)
    logger.info("kill_switch.deactivated")


async def is_active(redis: Redis) -> bool:
    return await redis.exists(KILL_SWITCH_KEY) == 1


class KillSwitchListener:
    """Background subscriber, one per agent process. Sets an in-process
    Event the instant a kill message arrives, agents check the Event,
    not Redis, before each unit of work."""

    def __init__(self, redis: Redis) -> None:
        self._redis = redis
        self.triggered = asyncio.Event()
        self._pubsub: PubSub | None = None
        self._task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        if await is_active(self._redis):
            self.triggered.set()
        # SUBSCRIBE is awaited here, before this method returns, not
        # inside the background task. Redis does not queue a published
        # message for a subscriber whose SUBSCRIBE hasn't completed on
        # the server yet — if the background task did the subscribing
        # itself, a caller that calls activate() right after start()
        # returns could race the subscription and lose the message
        # entirely, with nothing in the API to indicate that happened.
        self._pubsub = self._redis.pubsub()
        await self._pubsub.subscribe(KILL_SWITCH_CHANNEL)
        self._task = asyncio.create_task(self._listen())

    async def _listen(self) -> None:
        assert self._pubsub is not None
        async for message in self._pubsub.listen():
            if message["type"] != "message":
                continue
            data = message["data"]
            # pub/sub payload type tracks the Redis client's
            # decode_responses setting, not this module's choice — decode
            # defensively here so the sentinel still compares correctly
            # even if some caller constructs the client without
            # decode_responses=True. Without this, the comparison below
            # silently always fails against bytes and the switch never
            # actually clears via pub/sub.
            if isinstance(data, bytes):
                data = data.decode("utf-8")
            if data == _CLEARED_SENTINEL:
                self.triggered.clear()
            else:
                self.triggered.set()
            logger.warning("kill_switch.received", reason=data)

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        if self._pubsub is not None:
            # redis-py's PubSub.aclose() has no type annotations in the
            # installed stub, so mypy --strict flags calling it as an
            # untyped call from typed code. There's no typed alternative
            # to close a PubSub connection, so this is suppressed rather
            # than worked around.
            await self._pubsub.aclose()  # type: ignore[no-untyped-call]

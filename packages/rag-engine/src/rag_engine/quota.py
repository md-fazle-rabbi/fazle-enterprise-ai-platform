"""
Atomic per-tenant daily token quota. warn (80%) logs only, throttle (95%)
actually reduces the next generation call's max_tokens rather than just
logging a warning that changes nothing, block (100%) rejects outright.
"""

from datetime import UTC, datetime
from pathlib import Path

import structlog
from redis.asyncio import Redis

logger = structlog.get_logger()
_LUA_SCRIPT = (Path(__file__).parent / "quota.lua").read_text()
WARN_THRESHOLD = 0.80
THROTTLE_THRESHOLD = 0.95


class QuotaExceeded(Exception):
    pass


def _today() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%d")


async def check_and_consume(
    redis: Redis, tenant_id: str, tokens_used: int, daily_limit: int = 100_000
) -> str:
    key = f"quota:{tenant_id}:{_today()}"
    new_total, limit, blocked = await redis.eval(
        _LUA_SCRIPT, 1, key, daily_limit, 86400, tokens_used
    )

    if blocked:
        logger.warning(
            "quota.blocked", tenant_id=tenant_id, total=new_total, limit=limit
        )
        raise QuotaExceeded(f"Daily token quota exceeded: {new_total}/{limit}")

    ratio = new_total / limit
    if ratio >= THROTTLE_THRESHOLD:
        logger.warning("quota.throttle", tenant_id=tenant_id, ratio=round(ratio, 3))
        return "throttle"
    if ratio >= WARN_THRESHOLD:
        logger.info("quota.warn", tenant_id=tenant_id, ratio=round(ratio, 3))
        return "warn"
    return "ok"

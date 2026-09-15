"""
Slack webhook alerting, shared across whatever needs it, this and Day 7's
governance module both fire alerts through here rather than each having
its own HTTP client code.
"""

import httpx
import structlog

from core.settings import settings

logger = structlog.get_logger()


async def send_slack_alert(title: str, details: dict) -> None:
    if not settings.slack_webhook_url:
        logger.warning("alerts.slack_not_configured", title=title, details=details)
        return
    async with httpx.AsyncClient() as client:
        await client.post(
            settings.slack_webhook_url,
            json={
                "text": f"*{title}*\n"
                + "\n".join(f"• {k}: {v}" for k, v in details.items()),
            },
            timeout=5.0,
        )

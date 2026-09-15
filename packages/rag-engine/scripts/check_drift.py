"""
Embedding drift check. Run on a schedule (cron, or manually before a
demo/audit), not on every request, this is a periodic health check, not
part of the live request path.
"""

import asyncio
import sys
import warnings
from datetime import UTC, datetime, timedelta

import pandas as pd

# evidently 0.7.21 (latest on PyPI as of this writing) still ships an
# un-raw-stringed regex example in evidently/descriptors/text_match.py,
# which Python 3.12+ flags as SyntaxWarning at import time. This is a
# known upstream issue (same class of bug as many libraries hit after
# the 3.12 escape-sequence deprecation), not something wrong in our
# code, and site-packages isn't ours to patch -- any edit there is
# wiped on the next `uv sync`. Scoped to SyntaxWarning + this module
# only, so it can't accidentally hide a real warning from elsewhere in
# this script. Safe to delete once evidently ships a fix upstream.
with warnings.catch_warnings():
    warnings.filterwarnings("ignore", category=SyntaxWarning, module=r"evidently\..*")
    from evidently import Report
    from evidently.presets import DataDriftPreset

from core.alerts import send_slack_alert
from core.db import make_engine
from core.settings import settings
from rag_engine.models import QueryLog
from sqlalchemy import select

PSI_THRESHOLD = 0.2


async def _fetch_embeddings(engine, start: datetime, end: datetime) -> pd.DataFrame:
    from sqlalchemy.ext.asyncio import async_sessionmaker

    async with async_sessionmaker(engine)() as session:
        rows = (
            await session.scalars(
                select(QueryLog).where(
                    QueryLog.created_at >= start, QueryLog.created_at < end
                )
            )
        ).all()
    if not rows:
        return pd.DataFrame()
    return pd.DataFrame(
        [{f"dim_{i}": v for i, v in enumerate(r.embedding)} for r in rows]
    )


async def main() -> None:
    engine = make_engine(settings.database_url)
    now = datetime.now(UTC)

    # rolling reference window (30-60 days back), not a frozen launch-date
    # baseline, a frozen reference flags every seasonal pattern as drift
    reference = await _fetch_embeddings(
        engine, now - timedelta(days=60), now - timedelta(days=30)
    )
    current = await _fetch_embeddings(engine, now - timedelta(days=7), now)

    if reference.empty or current.empty:
        print("Not enough query history yet for a meaningful drift check, skipping.")
        return

    report = Report([DataDriftPreset(method="psi")])
    result = report.run(current, reference)
    result_dict = result.dict()

    # exact key path depends on your installed version's result schema,
    # verify with result.json() printed once before trusting this in a cron job
    drift_share = result_dict.get("metrics", [{}])[0].get("value", {}).get("share", 0.0)

    print(f"Drift share: {drift_share:.3f} (threshold {PSI_THRESHOLD})")
    if drift_share > PSI_THRESHOLD:
        await send_slack_alert(
            "Query distribution drift detected",
            {
                "drift_share": round(drift_share, 3),
                "threshold": PSI_THRESHOLD,
                "action": "Review corpus coverage and chunking against recent query patterns",
            },
        )
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())

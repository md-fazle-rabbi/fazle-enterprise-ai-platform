"""
SOC2-aligned, hash-chained, insert-only audit log. Ties together tenant
identity (RLS), distributed trace (OTel trace_id, links to the full trace
in Langfuse), and event data, into one record that detects its own
tampering.

Each entry's hash covers the previous entry's hash plus this entry's
canonical JSON, so any edit or deletion anywhere in history breaks the
chain from that point forward. INSERT-only is additionally enforced at
the DB level (see the migration's RULEs), not just app-code discipline,
so this holds even against a compromised app process reusing the same
DB role.
"""

import hashlib
import json
import uuid
from datetime import UTC, datetime

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

GENESIS_HASH = "0" * 64


def _canonical(entry: dict) -> str:
    return json.dumps(entry, sort_keys=True, separators=(",", ":"), default=str)


def _compute_hash(prev_hash: str, entry: dict) -> str:
    return hashlib.sha256((prev_hash + _canonical(entry)).encode("utf-8")).hexdigest()


async def append_entry(
    session: AsyncSession,
    tenant_id: str,
    event_type: str,
    event_data: dict,
    trace_id: str | None = None,
) -> str:
    prev_hash = await session.scalar(
        text("SELECT entry_hash FROM audit_log ORDER BY created_at DESC LIMIT 1")
    )
    prev_hash = prev_hash or GENESIS_HASH

    entry_id = str(uuid.uuid4())
    # created_at exists in two forms from here on: created_at_dt is the
    # real datetime object, which is what the timestamptz column needs
    # as its bind parameter. created_at_iso is the string form, which is
    # what goes into the hashed payload -- verify_chain() recomputes the
    # same hash later from a datetime it reads back out of the DB by
    # calling the same .isoformat() on it, so the two representations
    # have to line up exactly, but only the datetime object is valid to
    # send to asyncpg for this column when going through raw text() SQL
    # (no ORM column-type coercion happens on that path).
    created_at_dt = datetime.now(UTC)
    created_at_iso = created_at_dt.isoformat()
    payload = {
        "id": entry_id,
        "tenant_id": tenant_id,
        "event_type": event_type,
        "event_data": event_data,
        "trace_id": trace_id,
        "created_at": created_at_iso,
    }
    entry_hash = _compute_hash(prev_hash, payload)

    await session.execute(
        text(
            """
            INSERT INTO audit_log
                (id, tenant_id, event_type, event_data, trace_id, created_at, prev_hash, entry_hash)
            VALUES
                (:id, :tenant_id, :event_type, :event_data, :trace_id, :created_at, :prev_hash, :entry_hash)
            """
        ),
        {
            "id": entry_id,
            "tenant_id": tenant_id,
            "event_type": event_type,
            "event_data": json.dumps(event_data),
            "trace_id": trace_id,
            "created_at": created_at_dt,
            "prev_hash": prev_hash,
            "entry_hash": entry_hash,
        },
    )
    return entry_hash


async def verify_chain(session: AsyncSession) -> tuple[bool, int | None]:
    """O(n) over the whole log, run periodically or on demand, not on
    every request. Returns (is_valid, first_broken_index)."""
    rows = (
        (await session.execute(text("SELECT * FROM audit_log ORDER BY created_at ASC")))
        .mappings()
        .all()
    )
    expected_prev = GENESIS_HASH
    for i, row in enumerate(rows):
        payload = {
            "id": str(row["id"]),
            "tenant_id": str(row["tenant_id"]),
            "event_type": row["event_type"],
            "event_data": row["event_data"]
            if isinstance(row["event_data"], dict)
            else json.loads(row["event_data"]),
            "trace_id": row["trace_id"],
            "created_at": row["created_at"].isoformat(),
        }
        if (
            _compute_hash(expected_prev, payload) != row["entry_hash"]
            or row["prev_hash"] != expected_prev
        ):
            return False, i
        expected_prev = row["entry_hash"]
    return True, None

"""
Read/verify surface for the hash-chained audit log defined in
governance.audit_log. Lives here rather than in governance itself so it
can use rag_engine's tenant-scoped get_session dependency (which sets
app.tenant_id inside the request's own transaction) -- governance has no
dependency on rag_engine, and this keeps it that way.

/audit/query is scoped to the caller's tenant via the same RLS policy
every other tenant-owned table uses. /audit/verify walks the whole
table it can see (i.e. still tenant-scoped) and recomputes every hash.
"""

from typing import Annotated

from fastapi import APIRouter, Depends
from governance.audit_log import verify_chain
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from rag_engine.db import get_session

router = APIRouter(prefix="/audit", tags=["governance"])


@router.get("/query")
async def query_audit_log(
    session: Annotated[AsyncSession, Depends(get_session)],
    event_type: str | None = None,
    limit: int = 100,
):
    query = "SELECT id, event_type, event_data, trace_id, created_at FROM audit_log"
    params: dict = {"limit": limit}
    if event_type:
        query += " WHERE event_type = :event_type"
        params["event_type"] = event_type
    query += " ORDER BY created_at DESC LIMIT :limit"
    rows = (await session.execute(text(query), params)).mappings().all()
    return {"entries": [dict(r) for r in rows]}


@router.get("/verify")
async def verify_audit_chain(session: Annotated[AsyncSession, Depends(get_session)]):
    is_valid, broken_at = await verify_chain(session)
    return {"valid": is_valid, "broken_at_index": broken_at}

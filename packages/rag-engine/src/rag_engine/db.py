"""
Per-request DB session with tenant context set inside the same transaction
as the request's queries, so it can never leak into a different request
sharing a pooled connection.
"""

from collections.abc import AsyncGenerator
from typing import Annotated
from uuid import UUID

from fastapi import Depends, Header, HTTPException, Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def get_tenant_id(
    x_tenant_id: Annotated[str | None, Header()] = None,
) -> UUID:
    """
    Placeholder tenant resolution: reads X-Tenant-ID straight off the
    request header, no signature or auth check yet. Any caller can claim
    any tenant right now. Stated gap, closes once real authentication
    replaces this.
    """
    if x_tenant_id is None:
        raise HTTPException(status_code=400, detail="X-Tenant-ID header required")
    try:
        return UUID(x_tenant_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="X-Tenant-ID must be a UUID")


async def get_session(
    request: Request,
    tenant_id: Annotated[UUID, Depends(get_tenant_id)],
) -> AsyncGenerator[AsyncSession]:
    session_factory = request.app.state.session_factory
    async with session_factory() as session, session.begin():
        await session.execute(
            text("SELECT set_config('app.tenant_id', :tenant_id, true)"),
            {"tenant_id": str(tenant_id)},
        )
        yield session

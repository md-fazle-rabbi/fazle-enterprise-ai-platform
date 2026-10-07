"""
Per-request DB session with tenant context set inside the same transaction
as the request's queries, so it can never leak into a different request
sharing a pooled connection.
"""

import hmac
from collections.abc import AsyncGenerator
from dataclasses import dataclass
from typing import Annotated
from uuid import UUID

import structlog
from core.settings import settings
from fastapi import Depends, Header, HTTPException, Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from rag_engine.demo_auth import resolve_demo_tenant
from rag_engine.user_auth import (
    AuthenticatedUser,
    authenticate_token,
    bearer_token,
    select_tenant,
)


def _is_demo_key(token: str) -> bool:
    # Why: compare_digest takes the same time however many characters match,
    # so response timing cannot be used to guess the key one character at a time.
    return hmac.compare_digest(token.encode(), settings.demo_api_key.encode())


async def _demo_or_header_tenant(request: Request, x_tenant_id: str | None) -> UUID:
    demo_tenant = await resolve_demo_tenant(request)
    if demo_tenant is not None:
        return demo_tenant
    # Why: with a real login path available, this switch lets a deployment
    # refuse the unauthenticated header instead of trusting any caller.
    if not settings.allow_unauthenticated_tenant_header:
        raise HTTPException(
            status_code=401,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if x_tenant_id is None:
        raise HTTPException(status_code=400, detail="X-Tenant-ID header required")
    try:
        return UUID(x_tenant_id)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail="X-Tenant-ID must be a UUID",
        ) from None


async def get_tenant_id(
    request: Request,
    x_tenant_id: Annotated[str | None, Header()] = None,
) -> UUID:
    token = bearer_token(request)
    # Why: an empty Bearer value ("Authorization: Bearer ") is not an
    # authentication attempt, it's the absence of one. `is not None` would
    # treat "" as a token and send it into authenticate_token, which
    # correctly rejects it with 401 instead of falling back to the
    # demo-key/header path the way a genuinely missing header does.
    if token and not _is_demo_key(token):
        user = await authenticate_token(token)
        tenant_id = select_tenant(user, x_tenant_id)
        structlog.contextvars.bind_contextvars(user_id=user.subject)
    else:
        tenant_id = await _demo_or_header_tenant(request, x_tenant_id)

    structlog.contextvars.bind_contextvars(tenant_id=str(tenant_id))
    return tenant_id


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


ADMIN_ROLE = "platform-admin"


async def _authenticated_user(request: Request) -> AuthenticatedUser:
    # Why: a real Keycloak token or nothing. The demo key fails authenticate_token (it is not
    # a JWT) and the raw header path has no Bearer token at all, so neither can ever have a
    # "user" to attach a private conversation to.
    token = bearer_token(request)
    if not token:
        raise HTTPException(
            status_code=401,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user = await authenticate_token(token)
    if not user.subject:
        # Why: an empty subject would match the empty user_id setting RLS falls back to.
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    structlog.contextvars.bind_contextvars(user_id=user.subject)
    return user


async def _authenticated_admin(request: Request) -> AuthenticatedUser:
    user = await _authenticated_user(request)
    if ADMIN_ROLE not in user.roles:
        raise HTTPException(status_code=403, detail=f"{ADMIN_ROLE} role required")
    structlog.contextvars.bind_contextvars(admin=True)
    return user


@dataclass(frozen=True, slots=True)
class UserContext:
    user_id: str
    tenant_id: UUID


async def get_user_context(
    request: Request,
    x_tenant_id: Annotated[str | None, Header()] = None,
) -> UserContext:
    """
    For data that belongs to one user inside one tenant, such as chat history. Same
    tenant selection as every other route (select_tenant), plus the caller's identity.
    """
    user = await _authenticated_user(request)
    tenant_id = select_tenant(user, x_tenant_id)
    structlog.contextvars.bind_contextvars(tenant_id=str(tenant_id))
    return UserContext(user_id=user.subject, tenant_id=tenant_id)


async def get_user_session(
    request: Request,
    ctx: Annotated[UserContext, Depends(get_user_context)],
) -> AsyncGenerator[AsyncSession]:
    # Why: a third copy of this body instead of a shared helper, for the same reason as
    # get_admin_session: delegating between async generator dependencies does not reliably
    # carry an exception's cleanup into the inner `async with`.
    session_factory = request.app.state.session_factory
    async with session_factory() as session, session.begin():
        await session.execute(
            text(
                "SELECT set_config('app.tenant_id', :tenant_id, true), "
                "set_config('app.user_id', :user_id, true)"
            ),
            {"tenant_id": str(ctx.tenant_id), "user_id": ctx.user_id},
        )
        yield session


async def require_platform_admin(request: Request) -> AuthenticatedUser:
    """For platform-wide admin actions that have no tenant of their own, such as the kill
    switch."""
    return await _authenticated_admin(request)


async def get_admin_tenant_id(
    request: Request,
    x_tenant_id: Annotated[str | None, Header()] = None,
) -> UUID:
    """
    For admin actions scoped to one tenant at a time, such as its review queue. The caller
    must both hold platform-admin and belong to the tenant they select (select_tenant), so
    the role only widens WHICH tenants an operator may act as, never bypasses tenant
    membership itself.
    """
    user = await _authenticated_admin(request)
    tenant_id = select_tenant(user, x_tenant_id)
    structlog.contextvars.bind_contextvars(tenant_id=str(tenant_id))
    return tenant_id


async def get_admin_session(
    request: Request,
    tenant_id: Annotated[UUID, Depends(get_admin_tenant_id)],
) -> AsyncGenerator[AsyncSession]:
    # Why: kept separate from get_session rather than refactored to share a body through a
    # nested generator. Delegating via `async for ... yield` between two async generator
    # dependencies does not reliably propagate an exception's cleanup into the inner
    # generator's `async with` block -- there is no async equivalent of sync `yield from`
    # for full delegation. A few duplicated lines here are safer than a transaction that
    # might not roll back promptly on error.
    session_factory = request.app.state.session_factory
    async with session_factory() as session, session.begin():
        await session.execute(
            text("SELECT set_config('app.tenant_id', :tenant_id, true)"),
            {"tenant_id": str(tenant_id)},
        )
        yield session

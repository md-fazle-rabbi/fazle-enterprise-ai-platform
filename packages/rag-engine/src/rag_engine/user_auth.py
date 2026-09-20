"""
Verifies end user JWTs issued by Keycloak (the browser login path) and turns
them into an AuthenticatedUser holding the set of tenants that user may act as.

Kept apart from agent_mesh.identity.jwt_auth on purpose. That module checks
service account tokens for the agent-mesh audience. This one checks human
tokens for the rag-engine-api audience, so a token minted for one purpose
cannot be replayed against the other.
"""

import asyncio
import functools
import uuid
from dataclasses import dataclass
from typing import Any

import jwt
import structlog
from core.settings import settings
from fastapi import HTTPException, Request
from jwt import PyJWKClient

logger = structlog.get_logger()

_ALGORITHM = "RS256"
_JWKS_LIFESPAN_SECONDS = 300
_JWKS_TIMEOUT_SECONDS = 5
_CLOCK_SKEW_SECONDS = 30
_REQUIRED_CLAIMS = ["exp", "iat", "iss", "aud", "sub"]


@dataclass(frozen=True, slots=True)
class AuthenticatedUser:
    subject: str
    tenants: frozenset[uuid.UUID]


def bearer_token(request: Request) -> str | None:
    header = request.headers.get("authorization", "")
    if not header.startswith("Bearer "):
        return None
    return header.removeprefix("Bearer ").strip() or None


def _unauthorized() -> HTTPException:
    # Why: one generic message for every failure, so a caller cannot tell an
    # expired token from a forged one. The real reason goes to the log.
    return HTTPException(
        status_code=401,
        detail="Invalid or expired token",
        headers={"WWW-Authenticate": "Bearer"},
    )


@functools.lru_cache(maxsize=1)
def _jwks_client() -> PyJWKClient:
    # Why: one shared client so its 5 minute JWK Set cache is shared by every
    # request. cache_keys stays at its False default because PyJWT's per key
    # cache never expires, so a rotated or revoked key could keep verifying.
    return PyJWKClient(
        settings.keycloak_jwks_url,
        cache_jwk_set=True,
        lifespan=_JWKS_LIFESPAN_SECONDS,
        timeout=_JWKS_TIMEOUT_SECONDS,
    )


def _resolve_signing_key(token: str) -> Any:
    return _jwks_client().get_signing_key_from_jwt(token).key


def _verify(token: str) -> dict[str, Any]:
    # Why: algorithms=[RS256] in decode() is the real enforcement. This header
    # pre-check only gives a clearer error for alg none and HS256 tricks.
    header = jwt.get_unverified_header(token)
    if header.get("alg") != _ALGORITHM:
        raise jwt.InvalidAlgorithmError(f"Only {_ALGORITHM} is accepted")
    key = _resolve_signing_key(token)
    return jwt.decode(
        token,
        key,
        algorithms=[_ALGORITHM],
        audience=settings.web_api_audience,
        issuer=settings.keycloak_issuer,
        leeway=_CLOCK_SKEW_SECONDS,
        options={"require": _REQUIRED_CLAIMS},
    )


def _tenants_from_groups(raw: object) -> frozenset[uuid.UUID]:
    if raw is None:
        return frozenset()
    if not isinstance(raw, list) or not all(isinstance(g, str) for g in raw):
        raise ValueError("groups claim must be a list of strings")
    prefix = settings.tenant_group_prefix
    # Why: a malformed tenant id raises ValueError, which becomes a 401.
    # Failing closed is safer than guessing what the group was meant to be.
    return frozenset(
        uuid.UUID(group.removeprefix(prefix))
        for group in raw
        if group.startswith(prefix)
    )


async def authenticate_token(token: str) -> AuthenticatedUser:
    try:
        # Why: PyJWKClient does blocking network I/O on a cache miss. A worker
        # thread keeps that off the event loop.
        claims = await asyncio.to_thread(_verify, token)
        tenants = _tenants_from_groups(claims.get("groups"))
    except jwt.exceptions.PyJWKClientConnectionError as exc:
        # Why: 503, not 401. The token may be fine, the identity provider is down.
        logger.error("user_auth.jwks_unreachable", error=str(exc))
        raise HTTPException(
            status_code=503,
            detail="Identity provider unavailable",
        ) from exc
    except (jwt.PyJWTError, ValueError) as exc:
        logger.info("user_auth.token_rejected", reason=type(exc).__name__)
        raise _unauthorized() from exc
    return AuthenticatedUser(subject=str(claims["sub"]), tenants=tenants)


def select_tenant(user: AuthenticatedUser, requested: str | None) -> uuid.UUID:
    if not user.tenants:
        raise HTTPException(
            status_code=403,
            detail="No tenant assigned to this user",
        )
    if requested is None:
        if len(user.tenants) == 1:
            return next(iter(user.tenants))
        raise HTTPException(
            status_code=400,
            detail="X-Tenant-ID required: token grants multiple tenants",
        )
    try:
        tenant_id = uuid.UUID(requested)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail="X-Tenant-ID must be a UUID",
        ) from None
    # Why: the header is only a selector. The token decides what is allowed.
    if tenant_id not in user.tenants:
        raise HTTPException(
            status_code=403,
            detail="Tenant not permitted for this user",
        )
    return tenant_id

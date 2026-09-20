"""
User JWT verification, tested with a throwaway RSA key pair so no Keycloak is
needed. The signing key lookup is patched at point of use (user_auth's own
_resolve_signing_key), the same way conftest.py patches Voyage and Gemini.

Three layers are covered: authenticate_token (signature and claims),
select_tenant (which tenant the caller may act as), and get_tenant_id wired
into a tiny FastAPI app (which login path a request takes).
"""

import base64
import json
import time
import uuid
from typing import Annotated, Any

import jwt
import pytest
from core.settings import settings
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import Depends, FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient, Response
from rag_engine import user_auth
from rag_engine.db import get_tenant_id
from rag_engine.user_auth import AuthenticatedUser, authenticate_token, select_tenant

TENANT_A = uuid.UUID("00000000-0000-0000-0000-00000000000a")
TENANT_B = uuid.UUID("00000000-0000-0000-0000-00000000000b")


@pytest.fixture(scope="module")
def private_key() -> rsa.RSAPrivateKey:
    # Why: generating a key is slow, so once per file. It never leaves memory.
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture(autouse=True)
def patch_key_lookup(
    monkeypatch: pytest.MonkeyPatch, private_key: rsa.RSAPrivateKey
) -> None:
    monkeypatch.setattr(
        user_auth, "_resolve_signing_key", lambda token: private_key.public_key()
    )


def valid_claims() -> dict[str, Any]:
    now = int(time.time())
    return {
        "iss": settings.keycloak_issuer,
        "aud": settings.web_api_audience,
        "sub": "user-1",
        "iat": now,
        "exp": now + 300,
        "groups": [f"/tenants/{TENANT_A}"],
    }


def make_token(
    key: rsa.RSAPrivateKey, drop: tuple[str, ...] = (), **overrides: Any
) -> str:
    claims = valid_claims() | overrides
    for name in drop:
        del claims[name]
    return jwt.encode(claims, key, algorithm="RS256", headers={"kid": "test-key"})


async def _status_of(token: str) -> int:
    with pytest.raises(HTTPException) as exc_info:
        await authenticate_token(token)
    return exc_info.value.status_code


def _b64url(data: dict[str, Any]) -> str:
    raw = json.dumps(data, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


# Layer 1: authenticate_token


async def test_valid_token_yields_user_and_only_tenant_groups(private_key):
    groups = ["/admins", f"/tenants/{TENANT_A}", f"/tenants/{TENANT_B}"]
    user = await authenticate_token(make_token(private_key, groups=groups))
    assert user.subject == "user-1"
    assert user.tenants == {TENANT_A, TENANT_B}


@pytest.mark.parametrize(
    ("overrides", "drop"),
    [
        pytest.param({"exp": int(time.time()) - 3600}, (), id="expired"),
        pytest.param({"aud": "some-other-api"}, (), id="wrong-audience"),
        pytest.param({"iss": "http://evil.example"}, (), id="wrong-issuer"),
        pytest.param({}, ("exp",), id="missing-exp"),
        pytest.param({}, ("sub",), id="missing-sub"),
        pytest.param({"groups": "not-a-list"}, (), id="groups-not-a-list"),
        pytest.param({"groups": ["/tenants/not-a-uuid"]}, (), id="bad-tenant-uuid"),
    ],
)
async def test_bad_claims_are_rejected_with_401(private_key, overrides, drop):
    assert await _status_of(make_token(private_key, drop, **overrides)) == 401


async def test_unsigned_alg_none_token_is_rejected():
    header = _b64url({"alg": "none", "typ": "JWT"})
    payload = _b64url(valid_claims())
    assert await _status_of(f"{header}.{payload}.") == 401


async def test_hs256_token_is_rejected():
    token = jwt.encode(valid_claims(), "s" * 64, algorithm="HS256")
    assert await _status_of(token) == 401


async def test_token_signed_by_another_key_is_rejected():
    stranger = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    assert await _status_of(make_token(stranger)) == 401


async def test_garbage_token_is_rejected():
    assert await _status_of("not-a-jwt") == 401


async def test_user_without_tenant_group_is_refused_at_selection(private_key):
    user = await authenticate_token(make_token(private_key, groups=["/admins"]))
    assert user.tenants == frozenset()
    with pytest.raises(HTTPException) as exc_info:
        select_tenant(user, None)
    assert exc_info.value.status_code == 403


async def test_unreachable_jwks_returns_503(monkeypatch, private_key):
    def _keycloak_down(token: str) -> None:
        raise jwt.exceptions.PyJWKClientConnectionError("keycloak is down")

    monkeypatch.setattr(user_auth, "_resolve_signing_key", _keycloak_down)
    with pytest.raises(HTTPException) as exc_info:
        await authenticate_token(make_token(private_key))
    assert exc_info.value.status_code == 503


def test_jwks_client_points_at_the_internal_keycloak_url():
    user_auth._jwks_client.cache_clear()
    assert user_auth._jwks_client().uri == settings.keycloak_jwks_url


# Layer 2: select_tenant


def _user(*tenants: uuid.UUID) -> AuthenticatedUser:
    return AuthenticatedUser(subject="user-1", tenants=frozenset(tenants))


def test_single_tenant_needs_no_header():
    assert select_tenant(_user(TENANT_A), None) == TENANT_A


def test_header_picks_one_of_the_granted_tenants():
    assert select_tenant(_user(TENANT_A, TENANT_B), str(TENANT_B)) == TENANT_B


@pytest.mark.parametrize(
    ("tenants", "requested", "status"),
    [
        pytest.param((), None, 403, id="no-tenants"),
        pytest.param((TENANT_A, TENANT_B), None, 400, id="ambiguous-no-header"),
        pytest.param((TENANT_A,), "not-a-uuid", 400, id="header-not-a-uuid"),
        pytest.param((TENANT_A,), str(TENANT_B), 403, id="foreign-tenant"),
    ],
)
def test_select_tenant_refusals(tenants, requested, status):
    with pytest.raises(HTTPException) as exc_info:
        select_tenant(_user(*tenants), requested)
    assert exc_info.value.status_code == status


# Layer 3: get_tenant_id wired into a real FastAPI app


def _build_app() -> FastAPI:
    app = FastAPI()

    @app.get("/whoami")
    async def whoami(
        tenant_id: Annotated[uuid.UUID, Depends(get_tenant_id)],
    ) -> dict[str, str]:
        return {"tenant_id": str(tenant_id)}

    return app


async def _whoami(headers: dict[str, str]) -> Response:
    transport = ASGITransport(app=_build_app())
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.get("/whoami", headers=headers)


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def test_jwt_login_resolves_tenant_from_the_token(private_key):
    response = await _whoami(_bearer(make_token(private_key)))
    assert response.status_code == 200
    assert response.json() == {"tenant_id": str(TENANT_A)}


async def test_valid_token_cannot_claim_a_foreign_tenant(private_key):
    headers = _bearer(make_token(private_key)) | {"X-Tenant-ID": str(TENANT_B)}
    response = await _whoami(headers)
    assert response.status_code == 403


async def test_user_with_two_tenants_can_pick_one(private_key):
    groups = [f"/tenants/{TENANT_A}", f"/tenants/{TENANT_B}"]
    token = make_token(private_key, groups=groups)
    response = await _whoami(_bearer(token) | {"X-Tenant-ID": str(TENANT_B)})
    assert response.json() == {"tenant_id": str(TENANT_B)}


async def test_bad_token_does_not_fall_back_to_the_header():
    headers = _bearer("not-a-jwt") | {"X-Tenant-ID": str(TENANT_A)}
    response = await _whoami(headers)
    assert response.status_code == 401


async def test_raw_header_still_works_when_switch_is_on(monkeypatch):
    monkeypatch.setattr(settings, "allow_unauthenticated_tenant_header", True)
    response = await _whoami({"X-Tenant-ID": str(TENANT_A)})
    assert response.status_code == 200


async def test_empty_bearer_falls_back_to_header_when_switch_is_on(monkeypatch):
    # Why: "Authorization: Bearer " with nothing after it is not a login
    # attempt, it's the absence of one. It must fall through to the raw
    # header path like a missing Authorization header would, not get stuck
    # in authenticate_token and come back 401.
    monkeypatch.setattr(settings, "allow_unauthenticated_tenant_header", True)
    headers = {"Authorization": "Bearer ", "X-Tenant-ID": str(TENANT_A)}
    response = await _whoami(headers)
    assert response.status_code == 200


async def test_raw_header_is_refused_when_switch_is_off(monkeypatch):
    monkeypatch.setattr(settings, "allow_unauthenticated_tenant_header", False)
    response = await _whoami({"X-Tenant-ID": str(TENANT_A)})
    assert response.status_code == 401


async def test_demo_key_goes_to_the_demo_resolver_not_jwt_verification(monkeypatch):
    async def _fake_demo_tenant(request: Any) -> uuid.UUID:
        return TENANT_A

    monkeypatch.setattr("rag_engine.db.resolve_demo_tenant", _fake_demo_tenant)
    response = await _whoami(_bearer(settings.demo_api_key))
    assert response.status_code == 200

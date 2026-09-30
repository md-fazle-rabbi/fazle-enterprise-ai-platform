"""
/admin/kill-switch/* (agent_mesh.kill_switch, no tenant of its own) and /review-queue
(tenant-scoped, mounted for the first time this step) both require a real Keycloak JWT
carrying the platform-admin realm role. The demo key and the raw X-Tenant-ID header are
refused outright, because feeding the demo key into authenticate_token fails it (it is not
a valid JWT), and no Bearer header at all is refused before either path is considered.
"""

import time
import uuid

import jwt
import pytest
import pytest_asyncio
from core.settings import settings
from cryptography.hazmat.primitives.asymmetric import rsa
from httpx import ASGITransport, AsyncClient
from rag_engine import user_auth
from rag_engine.main import app
from sqlalchemy import text

pytestmark = pytest.mark.asyncio

TENANT_A = uuid.uuid4()
TENANT_B = uuid.uuid4()


@pytest.fixture(scope="module")
def private_key() -> rsa.RSAPrivateKey:
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture(autouse=True)
def patch_key_lookup(
    monkeypatch: pytest.MonkeyPatch, private_key: rsa.RSAPrivateKey
) -> None:
    monkeypatch.setattr(
        user_auth, "_resolve_signing_key", lambda token: private_key.public_key()
    )


def make_token(
    key: rsa.RSAPrivateKey, *, tenants: list[uuid.UUID], roles: list[str]
) -> str:
    now = int(time.time())
    claims = {
        "iss": settings.keycloak_issuer,
        "aud": settings.web_api_audience,
        "sub": "admin-user-1",
        "iat": now,
        "exp": now + 300,
        "groups": [f"/tenants/{t}" for t in tenants],
        "realm_access": {"roles": roles},
    }
    return jwt.encode(claims, key, algorithm="RS256", headers={"kid": "test-key"})


@pytest_asyncio.fixture
async def client():
    async with (
        app.router.lifespan_context(app),
        AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as http,
    ):
        yield http


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _seed_review_item(tenant_id: uuid.UUID) -> uuid.UUID:
    from rag_engine.models import ReviewQueueItem

    item_id = uuid.uuid4()
    async with app.state.session_factory() as session, session.begin():
        await session.execute(
            text("SELECT set_config('app.tenant_id', :tenant_id, true)"),
            {"tenant_id": str(tenant_id)},
        )
        session.add(
            ReviewQueueItem(
                id=item_id,
                tenant_id=tenant_id,
                question="Seeded question",
                answer="Seeded answer",
                flag_reasons=["output_pii"],
            )
        )
    return item_id


# Kill switch: platform-wide, no tenant involved.


async def test_kill_switch_refuses_no_token(client):
    response = await client.get("/admin/kill-switch/status")
    assert response.status_code == 401


async def test_kill_switch_refuses_the_demo_key(client):
    response = await client.get(
        "/admin/kill-switch/status", headers=bearer("fazle-demo-key")
    )
    assert response.status_code == 401


async def test_kill_switch_refuses_a_token_without_the_admin_role(client, private_key):
    token = make_token(private_key, tenants=[TENANT_A], roles=[])
    response = await client.get("/admin/kill-switch/status", headers=bearer(token))
    assert response.status_code == 403


async def test_kill_switch_activate_and_deactivate_with_the_admin_role(
    client, private_key
):
    token = make_token(private_key, tenants=[], roles=["platform-admin"])
    headers = bearer(token)

    activated = await client.post(
        "/admin/kill-switch/activate", json={"reason": "test drill"}, headers=headers
    )
    assert activated.status_code == 200
    assert (await client.get("/admin/kill-switch/status", headers=headers)).json() == {
        "active": True
    }

    deactivated = await client.post("/admin/kill-switch/deactivate", headers=headers)
    assert deactivated.status_code == 200
    assert (await client.get("/admin/kill-switch/status", headers=headers)).json() == {
        "active": False
    }


# Review queue: tenant-scoped, the admin role widens which tenants, never bypasses membership.


async def test_review_queue_refuses_no_token(client):
    response = await client.get("/review-queue", headers={"X-Tenant-ID": str(TENANT_A)})
    assert response.status_code == 401


async def test_review_queue_refuses_a_token_without_the_admin_role(client, private_key):
    token = make_token(private_key, tenants=[TENANT_A], roles=[])
    response = await client.get(
        "/review-queue", headers=bearer(token) | {"X-Tenant-ID": str(TENANT_A)}
    )
    assert response.status_code == 403


async def test_review_queue_admin_role_does_not_bypass_tenant_membership(
    client, private_key
):
    # Admin of tenant A only, asking to view tenant B's queue.
    token = make_token(private_key, tenants=[TENANT_A], roles=["platform-admin"])
    response = await client.get(
        "/review-queue", headers=bearer(token) | {"X-Tenant-ID": str(TENANT_B)}
    )
    assert response.status_code == 403


async def test_review_queue_lists_only_the_selected_tenant(client, private_key):
    token = make_token(
        private_key, tenants=[TENANT_A, TENANT_B], roles=["platform-admin"]
    )
    response = await client.get(
        "/review-queue", headers=bearer(token) | {"X-Tenant-ID": str(TENANT_A)}
    )
    assert response.status_code == 200
    assert response.json() == []


async def test_review_queue_resolve_is_hidden_by_rls_for_the_wrong_tenant(
    client, private_key
):
    item_id = await _seed_review_item(TENANT_A)
    token = make_token(
        private_key, tenants=[TENANT_A, TENANT_B], roles=["platform-admin"]
    )

    # Why 404, not 403: the row is invisible under tenant B's RLS context, not explicitly
    # rejected by the route. Postgres itself is the second gate here, not just user_auth.
    wrong_tenant = await client.post(
        f"/review-queue/{item_id}/resolve",
        json={"note": "looks fine"},
        headers=bearer(token) | {"X-Tenant-ID": str(TENANT_B)},
    )
    assert wrong_tenant.status_code == 404

    resolved = await client.post(
        f"/review-queue/{item_id}/resolve",
        json={"note": "looks fine"},
        headers=bearer(token) | {"X-Tenant-ID": str(TENANT_A)},
    )
    assert resolved.status_code == 200
    assert resolved.json()["status"] == "reviewed"

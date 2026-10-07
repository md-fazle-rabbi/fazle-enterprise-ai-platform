"""
Conversation history: private per user inside a tenant, enforced by Postgres row level
security as well as by the queries. Needs Postgres and Redis like the other API tests.
Every test uses fresh tenant and user ids, so runs never see each other's rows.
"""

import time
import uuid
from typing import Any

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


@pytest_asyncio.fixture
async def client():
    async with (
        app.router.lifespan_context(app),
        AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as http,
    ):
        yield http


def make_token(key: rsa.RSAPrivateKey, *, sub: str, tenants: list[uuid.UUID]) -> str:
    now = int(time.time())
    claims = {
        "iss": settings.keycloak_issuer,
        "aud": settings.web_api_audience,
        "sub": sub,
        "iat": now,
        "exp": now + 300,
        "groups": [f"/tenants/{t}" for t in tenants],
    }
    return jwt.encode(claims, key, algorithm="RS256", headers={"kid": "test-key"})


def auth(token: str, tenant: uuid.UUID) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", "X-Tenant-ID": str(tenant)}


def result(answer: str = "Within 30 days [1]") -> dict[str, Any]:
    return {
        "answer": answer,
        "citations": [],
        "retrieved_context": [],
        "retrieved_but_uncited_count": 0,
        "flagged": False,
        "flag_reasons": [],
    }


async def new_conversation(client: AsyncClient, headers: dict[str, str]) -> str:
    response = await client.post("/conversations", headers=headers)
    assert response.status_code == 201
    return str(response.json()["id"])


async def test_requires_a_real_token(client):
    tenant = uuid.uuid4()
    assert (await client.get("/conversations")).status_code == 401
    demo = {
        "Authorization": f"Bearer {settings.demo_api_key}",
        "X-Tenant-ID": str(tenant),
    }
    assert (await client.get("/conversations", headers=demo)).status_code == 401
    assert (
        await client.get("/conversations", headers={"X-Tenant-ID": str(tenant)})
    ).status_code == 401


async def test_refuses_a_tenant_the_token_does_not_grant(client, private_key):
    token = make_token(private_key, sub=f"u-{uuid.uuid4()}", tenants=[uuid.uuid4()])
    response = await client.get("/conversations", headers=auth(token, uuid.uuid4()))
    assert response.status_code == 403


async def test_creates_a_conversation_and_lists_it(client, private_key):
    tenant = uuid.uuid4()
    headers = auth(
        make_token(private_key, sub=f"u-{uuid.uuid4()}", tenants=[tenant]), tenant
    )
    created = await client.post("/conversations", headers=headers)
    assert created.status_code == 201
    assert created.json()["title"] == "New chat"

    listed = (await client.get("/conversations", headers=headers)).json()
    assert [item["id"] for item in listed] == [created.json()["id"]]


async def test_an_exchange_is_stored_in_order_and_titles_the_conversation(
    client, private_key
):
    tenant = uuid.uuid4()
    headers = auth(
        make_token(private_key, sub=f"u-{uuid.uuid4()}", tenants=[tenant]), tenant
    )
    conversation_id = await new_conversation(client, headers)

    saved = await client.post(
        f"/conversations/{conversation_id}/exchanges",
        json={"question": "  How long   is the refund window?  ", "result": result()},
        headers=headers,
    )
    assert saved.status_code == 201

    detail = (
        await client.get(f"/conversations/{conversation_id}", headers=headers)
    ).json()
    # The title collapses runs of whitespace; the stored question is only trimmed, so
    # the user's own wording comes back exactly as sent.
    assert detail["title"] == "How long is the refund window?"
    assert [message["role"] for message in detail["messages"]] == ["user", "assistant"]
    assert detail["messages"][0]["content"] == "How long   is the refund window?"
    assert detail["messages"][0]["result"] is None
    assert detail["messages"][1]["result"]["answer"] == "Within 30 days [1]"


async def test_another_user_in_the_same_tenant_cannot_reach_it(client, private_key):
    tenant = uuid.uuid4()
    owner = auth(
        make_token(private_key, sub=f"owner-{uuid.uuid4()}", tenants=[tenant]), tenant
    )
    other = auth(
        make_token(private_key, sub=f"other-{uuid.uuid4()}", tenants=[tenant]), tenant
    )
    conversation_id = await new_conversation(client, owner)

    assert (
        await client.get(f"/conversations/{conversation_id}", headers=other)
    ).status_code == 404
    assert (await client.get("/conversations", headers=other)).json() == []
    assert (
        await client.delete(f"/conversations/{conversation_id}", headers=other)
    ).status_code == 404
    exchange = await client.post(
        f"/conversations/{conversation_id}/exchanges",
        json={"question": "hi", "result": result()},
        headers=other,
    )
    assert exchange.status_code == 404
    assert (
        await client.get(f"/conversations/{conversation_id}", headers=owner)
    ).status_code == 200


async def test_the_same_user_cannot_see_it_from_another_tenant(client, private_key):
    tenant_a, tenant_b = uuid.uuid4(), uuid.uuid4()
    token = make_token(
        private_key, sub=f"u-{uuid.uuid4()}", tenants=[tenant_a, tenant_b]
    )
    conversation_id = await new_conversation(client, auth(token, tenant_a))

    response = await client.get(
        f"/conversations/{conversation_id}", headers=auth(token, tenant_b)
    )
    assert response.status_code == 404


async def test_delete_removes_the_conversation_and_its_messages(client, private_key):
    tenant = uuid.uuid4()
    headers = auth(
        make_token(private_key, sub=f"u-{uuid.uuid4()}", tenants=[tenant]), tenant
    )
    kept = await new_conversation(client, headers)
    doomed = await new_conversation(client, headers)
    for conversation_id in (kept, doomed):
        await client.post(
            f"/conversations/{conversation_id}/exchanges",
            json={"question": "q", "result": result()},
            headers=headers,
        )

    assert (
        await client.delete(f"/conversations/{doomed}", headers=headers)
    ).status_code == 204
    assert (
        await client.get(f"/conversations/{doomed}", headers=headers)
    ).status_code == 404
    remaining = (await client.get(f"/conversations/{kept}", headers=headers)).json()
    assert len(remaining["messages"]) == 2


async def test_rejects_an_empty_question_and_an_oversized_answer(client, private_key):
    tenant = uuid.uuid4()
    headers = auth(
        make_token(private_key, sub=f"u-{uuid.uuid4()}", tenants=[tenant]), tenant
    )
    conversation_id = await new_conversation(client, headers)
    url = f"/conversations/{conversation_id}/exchanges"

    blank = await client.post(
        url, json={"question": "   ", "result": result()}, headers=headers
    )
    huge = await client.post(
        url, json={"question": "q", "result": result("x" * 50_001)}, headers=headers
    )
    assert blank.status_code == 422
    assert huge.status_code == 422


async def test_caps_the_number_of_conversations(client, private_key, monkeypatch):
    monkeypatch.setattr(
        "rag_engine.routers.conversations.MAX_CONVERSATIONS_PER_USER", 2
    )
    tenant = uuid.uuid4()
    headers = auth(
        make_token(private_key, sub=f"u-{uuid.uuid4()}", tenants=[tenant]), tenant
    )
    await new_conversation(client, headers)
    await new_conversation(client, headers)

    assert (await client.post("/conversations", headers=headers)).status_code == 409


async def test_caps_the_messages_in_one_conversation(client, private_key, monkeypatch):
    monkeypatch.setattr(
        "rag_engine.routers.conversations.MAX_MESSAGES_PER_CONVERSATION", 2
    )
    tenant = uuid.uuid4()
    headers = auth(
        make_token(private_key, sub=f"u-{uuid.uuid4()}", tenants=[tenant]), tenant
    )
    conversation_id = await new_conversation(client, headers)
    url = f"/conversations/{conversation_id}/exchanges"
    body = {"question": "q", "result": result()}

    assert (await client.post(url, json=body, headers=headers)).status_code == 201
    assert (await client.post(url, json=body, headers=headers)).status_code == 409


async def test_newest_activity_sorts_first_and_pages(client, private_key):
    tenant = uuid.uuid4()
    headers = auth(
        make_token(private_key, sub=f"u-{uuid.uuid4()}", tenants=[tenant]), tenant
    )
    first = await new_conversation(client, headers)
    second = await new_conversation(client, headers)
    third = await new_conversation(client, headers)

    order = [
        item["id"]
        for item in (await client.get("/conversations", headers=headers)).json()
    ]
    assert order == [third, second, first]

    await client.post(
        f"/conversations/{first}/exchanges",
        json={"question": "bump", "result": result()},
        headers=headers,
    )
    bumped = [
        item["id"]
        for item in (await client.get("/conversations", headers=headers)).json()
    ]
    assert bumped[0] == first

    page_one = (await client.get("/conversations?limit=2", headers=headers)).json()
    page_two = (
        await client.get("/conversations?limit=2&offset=2", headers=headers)
    ).json()
    assert len(page_one) == 2
    assert len(page_two) == 1


async def test_row_level_security_hides_rows_when_no_user_is_set(client, private_key):
    tenant = uuid.uuid4()
    headers = auth(
        make_token(private_key, sub=f"u-{uuid.uuid4()}", tenants=[tenant]), tenant
    )
    await new_conversation(client, headers)

    # Only the tenant is set, as every older route does. The policy also needs the user,
    # so nothing is visible: it fails closed rather than falling back to tenant-wide.
    async with app.state.session_factory() as session, session.begin():
        await session.execute(
            text("SELECT set_config('app.tenant_id', :tenant_id, true)"),
            {"tenant_id": str(tenant)},
        )
        visible = await session.scalar(text("SELECT count(*) FROM conversations"))
    assert visible == 0

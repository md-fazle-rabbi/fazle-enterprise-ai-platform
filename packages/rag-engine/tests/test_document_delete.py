"""
Deleting a document: needs a real login, removes the document and its chunks, stays
inside the caller's tenant, and drops that tenant's cached answers. Needs Postgres and
Redis like the other API tests. Every test uses fresh tenant and user ids.
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
from rag_engine.cache import get_cached_response, store_cached_response
from rag_engine.main import app
from rag_engine.models import Chunk, Document
from rag_engine.pii import PII_ANALYZER_VERSION
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

pytestmark = pytest.mark.asyncio

VECTOR = [1.0, 0.0, 0.0]


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


def headers_for(key: rsa.RSAPrivateKey, tenant: uuid.UUID) -> dict[str, str]:
    now = int(time.time())
    claims = {
        "iss": settings.keycloak_issuer,
        "aud": settings.web_api_audience,
        "sub": f"u-{uuid.uuid4()}",
        "iat": now,
        "exp": now + 300,
        "groups": [f"/tenants/{tenant}"],
    }
    token = jwt.encode(claims, key, algorithm="RS256", headers={"kid": "test-key"})
    return {"Authorization": f"Bearer {token}", "X-Tenant-ID": str(tenant)}


async def use_tenant(session: AsyncSession, tenant: uuid.UUID) -> None:
    await session.execute(
        text("SELECT set_config('app.tenant_id', :tenant_id, true)"),
        {"tenant_id": str(tenant)},
    )


async def new_document(tenant: uuid.UUID) -> str:
    # Why: inserted directly. The POST /documents route predates the PII version column
    # and cannot create a row any more, and what is under test here is the delete.
    async with app.state.session_factory() as session, session.begin():
        await use_tenant(session, tenant)
        document = Document(
            tenant_id=tenant,
            content_hash=uuid.uuid4().hex,
            source_path="handbook/refund-policy.md",
            pii_analyzer_version=PII_ANALYZER_VERSION,
        )
        session.add(document)
        await session.flush()
        return str(document.id)


async def add_chunk(tenant: uuid.UUID, document_id: str) -> None:
    async with app.state.session_factory() as session, session.begin():
        await use_tenant(session, tenant)
        session.add(
            Chunk(
                tenant_id=tenant,
                document_id=uuid.UUID(document_id),
                chunk_index=0,
                text="Refunds are available within 30 days.",
                token_count=7,
            )
        )


async def chunk_count(tenant: uuid.UUID, document_id: str) -> int:
    async with app.state.session_factory() as session, session.begin():
        await use_tenant(session, tenant)
        count = await session.scalar(
            select(func.count())
            .select_from(Chunk)
            .where(Chunk.document_id == uuid.UUID(document_id))
        )
    return int(count or 0)


async def listed_ids(client: AsyncClient, headers: dict[str, str]) -> list[str]:
    response = await client.get("/documents", headers=headers)
    return [item["id"] for item in response.json()]


async def test_requires_a_real_token(client):
    tenant = uuid.uuid4()
    url = f"/documents/{uuid.uuid4()}"
    assert (await client.delete(url)).status_code == 401
    demo = {
        "Authorization": f"Bearer {settings.demo_api_key}",
        "X-Tenant-ID": str(tenant),
    }
    assert (await client.delete(url, headers=demo)).status_code == 401
    header_only = {"X-Tenant-ID": str(tenant)}
    assert (await client.delete(url, headers=header_only)).status_code == 401


async def test_removes_the_document_and_its_chunks(client, private_key):
    tenant = uuid.uuid4()
    headers = headers_for(private_key, tenant)
    kept = await new_document(tenant)
    doomed = await new_document(tenant)
    await add_chunk(tenant, doomed)
    assert await chunk_count(tenant, doomed) == 1

    response = await client.delete(f"/documents/{doomed}", headers=headers)

    assert response.status_code == 204
    assert await listed_ids(client, headers) == [kept]
    assert await chunk_count(tenant, doomed) == 0


async def test_unknown_document_is_a_404(client, private_key):
    headers = headers_for(private_key, uuid.uuid4())
    response = await client.delete(f"/documents/{uuid.uuid4()}", headers=headers)
    assert response.status_code == 404


async def test_another_tenant_cannot_delete_it(client, private_key):
    owner_tenant, other_tenant = uuid.uuid4(), uuid.uuid4()
    owner = headers_for(private_key, owner_tenant)
    other = headers_for(private_key, other_tenant)
    document_id = await new_document(owner_tenant)

    response = await client.delete(f"/documents/{document_id}", headers=other)

    assert response.status_code == 404
    assert await listed_ids(client, owner) == [document_id]


async def test_drops_only_that_tenants_cached_answers(client, private_key):
    tenant, other_tenant = uuid.uuid4(), uuid.uuid4()
    headers = headers_for(private_key, tenant)
    document_id = await new_document(tenant)
    redis = app.state.redis
    cached = {"answer": "Within 30 days [1]"}
    await store_cached_response(redis, str(tenant), VECTOR, cached)
    await store_cached_response(redis, str(other_tenant), VECTOR, cached)

    response = await client.delete(f"/documents/{document_id}", headers=headers)

    assert response.status_code == 204
    assert await get_cached_response(redis, str(tenant), VECTOR) is None
    assert await get_cached_response(redis, str(other_tenant), VECTOR) == cached
    await redis.delete(f"semantic_cache:{other_tenant}")

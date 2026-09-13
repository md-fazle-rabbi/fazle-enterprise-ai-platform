from unittest.mock import AsyncMock, patch

import pytest
from agent_mesh.agents.research_agent import _build_query_tool, query_knowledge_base


@pytest.mark.asyncio
async def test_legacy_tool_still_used_by_mcp_server_calls_rag_engine() -> None:
    """Covers the module-level query_knowledge_base tool that mcp_server.py
    still imports and uses. This tool's tenant_id-as-LLM-argument gap is a
    known, tracked limitation (see this module's docstring) — not fixed
    here, but its basic behavior (calling rag-engine, returning the answer)
    still needs to keep working while that fix is pending."""
    fake_response = AsyncMock()
    fake_response.json = lambda: {
        "answer": "RLS enforces isolation at the database layer."
    }
    fake_response.raise_for_status = lambda: None

    with patch("httpx.AsyncClient.post", new=AsyncMock(return_value=fake_response)):
        result = await query_knowledge_base.ainvoke(
            {"question": "How is isolation enforced?", "tenant_id": "test-tenant"}
        )
    assert "database layer" in result


@pytest.mark.asyncio
async def test_bound_tool_uses_the_bound_tenant_id_not_a_model_supplied_one() -> None:
    """The bound tool takes only `question` as an LLM-visible argument —
    tenant_id is bound via closure at build time and is not something the
    model (or a successful prompt injection) can supply or override. This
    calls the tool directly via .ainvoke(), the same way LangChain tools
    support outside a full agent loop, so this never constructs or calls
    the LLM and needs no API key."""
    tool = _build_query_tool(tenant_id="tenant-a")

    fake_response = AsyncMock()
    fake_response.json = lambda: {"answer": "answer for tenant a"}
    fake_response.raise_for_status = lambda: None

    with patch(
        "httpx.AsyncClient.post", new=AsyncMock(return_value=fake_response)
    ) as mock_post:
        result = await tool.ainvoke({"question": "irrelevant question text"})

    assert result == "answer for tenant a"
    _, kwargs = mock_post.call_args
    assert kwargs["headers"]["X-Tenant-ID"] == "tenant-a"


def test_bound_tool_schema_does_not_expose_tenant_id() -> None:
    """Explicit regression guard for the actual vulnerability: tenant_id
    must not appear anywhere the model could read or fill in for the
    bound (fixed) tool."""
    tool = _build_query_tool(tenant_id="tenant-a")
    assert "tenant_id" not in tool.args

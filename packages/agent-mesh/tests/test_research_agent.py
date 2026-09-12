from unittest.mock import AsyncMock, patch

import pytest

from agent_mesh.agents.research_agent import query_knowledge_base


@pytest.mark.asyncio
async def test_query_knowledge_base_calls_rag_engine():
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

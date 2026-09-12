from unittest.mock import AsyncMock, patch

import pytest

import agent_mesh.mcp_server as mcp_server_module
from agent_mesh.mcp_server import QueryKnowledgeBaseInput


@pytest.mark.asyncio
async def test_query_kb_delegates_to_research_agent_tool():
    fake_tool = AsyncMock()
    fake_tool.ainvoke = AsyncMock(return_value="answer text")

    with patch.object(mcp_server_module, "query_knowledge_base", fake_tool):
        result = await mcp_server_module.query_kb(
            QueryKnowledgeBaseInput(question="q", tenant_id="t")
        )

    assert result == "answer text"

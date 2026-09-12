"""
MCP tool interface for the agent mesh, exposed to any MCP-compatible
client. Uses the standalone fastmcp package, not mcp.server.fastmcp,
which is mid-rename as of the 2026-07-28 spec's stateless rewrite, see
ADR-004 for why. Full JSON Schema via Pydantic input models, no bare
dict/Any types on the tool boundary.

stateless_http moved off the FastMCP() constructor in the installed
fastmcp version — passed to run() instead now, not at construction time.
"""

from fastmcp import FastMCP
from pydantic import BaseModel, Field

from agent_mesh.agents.research_agent import query_knowledge_base

mcp = FastMCP(name="fazle-agent-mesh")


class QueryKnowledgeBaseInput(BaseModel):
    question: str = Field(
        description="The question to answer from the tenant's knowledge base"
    )
    tenant_id: str = Field(description="The tenant UUID to scope retrieval to")


@mcp.tool(
    description="Query the tenant's RAG knowledge base for information relevant to a question."
)
async def query_kb(input: QueryKnowledgeBaseInput) -> str:
    return await query_knowledge_base.ainvoke(
        {"question": input.question, "tenant_id": input.tenant_id}
    )


if __name__ == "__main__":
    mcp.run(transport="http", port=8100, stateless_http=True)

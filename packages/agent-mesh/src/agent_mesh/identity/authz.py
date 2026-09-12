"""
Policy-as-code authorization: asks OPA whether an agent may call a tool,
rather than hand-coding that rule into the mesh. infra/opa/policies/
agent_mesh.rego defines the actual rule, this just asks the question.
"""

import httpx
from core.settings import settings


async def is_authorized(agent_id: str, tool: str) -> bool:
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{settings.opa_url}/v1/data/agent_mesh/allow",
            json={"input": {"agent_id": agent_id, "tool": tool}},
            timeout=5.0,
        )
        response.raise_for_status()
        return response.json().get("result", False)

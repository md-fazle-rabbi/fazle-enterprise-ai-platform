"""
Merges agent-mesh into the platform's single API surface, rather than it
living as a separately-discovered service. Kill-switch admin lives here
too, under its own prefix, not exposed the same way tenant-facing routes
are, same stated no-auth-yet gap as the Day 3 review-queue endpoints.
"""

import uuid
from typing import Annotated

from agent_mesh.agents.research_agent import build_research_agent
from agent_mesh.kill_switch import activate, deactivate, is_active
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from rag_engine.db import get_tenant_id

router = APIRouter(prefix="/agents", tags=["agents"])
admin_router = APIRouter(prefix="/admin", tags=["admin"])


class AgentInvokeRequest(BaseModel):
    question: str


class AgentInvokeResponse(BaseModel):
    answer: str


@router.post("/research", response_model=AgentInvokeResponse)
async def invoke_research_agent(
    body: AgentInvokeRequest, tenant_id: Annotated[uuid.UUID, Depends(get_tenant_id)]
) -> AgentInvokeResponse:
    agent = build_research_agent(tenant_id=str(tenant_id))
    result = await agent.ainvoke(
        {"messages": [{"role": "user", "content": body.question}]}
    )
    return AgentInvokeResponse(answer=result["messages"][-1].content)


class KillSwitchRequest(BaseModel):
    reason: str


@admin_router.post("/kill-switch/activate")
async def activate_kill_switch(
    body: KillSwitchRequest, request: Request
) -> dict[str, str]:
    await activate(request.app.state.redis, body.reason)
    return {"status": "activated"}


@admin_router.post("/kill-switch/deactivate")
async def deactivate_kill_switch(request: Request) -> dict[str, str]:
    await deactivate(request.app.state.redis)
    return {"status": "deactivated"}


@admin_router.get("/kill-switch/status")
async def kill_switch_status(request: Request) -> dict[str, bool]:
    return {"active": await is_active(request.app.state.redis)}

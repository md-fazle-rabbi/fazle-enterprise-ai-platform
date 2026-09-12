"""Needs docker compose up -d opa first."""

import pytest

from agent_mesh.identity.authz import is_authorized

pytestmark = pytest.mark.asyncio


async def test_research_agent_can_query_kb():
    assert await is_authorized("research-agent", "query_kb") is True


async def test_research_agent_cannot_dispatch_agent():
    assert await is_authorized("research-agent", "dispatch_agent") is False


async def test_unknown_agent_denied_by_default():
    assert await is_authorized("unregistered-agent", "query_kb") is False

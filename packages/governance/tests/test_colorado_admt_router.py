"""
Confirms the ADMT endpoint is actually wired and returns the right shape.
Mocks the Gemini call, this is a wiring test, not a model-quality test.
"""

import pytest
from httpx import ASGITransport, AsyncClient
from rag_engine.main import app


@pytest.mark.asyncio
async def test_colorado_admt_endpoint_is_reachable(monkeypatch):
    from governance import colorado_admt_router as mod

    async def fake_assess(system_description, deployment_context):
        from governance.state_law_plugins.colorado_admt import ColoradoADMTAssessment

        return ColoradoADMTAssessment(
            likely_covered=True,
            reasoning="test reasoning",
            obligations_if_covered=["Point of interaction notice"],
        )

    monkeypatch.setattr(mod, "assess", fake_assess)

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/classify/colorado-admt",
            json={
                "system_description": "an automated resume screening tool",
                "deployment_context": "used to auto reject candidates with no human review",
            },
        )

    assert response.status_code == 200
    body = response.json()
    assert body["likely_covered"] is True
    assert "Point of interaction notice" in body["obligations_if_covered"]

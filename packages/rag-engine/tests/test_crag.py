from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from rag_engine.crag import grade_relevance


@pytest.mark.asyncio
async def test_empty_parents_short_circuits_to_irrelevant():
    assert await grade_relevance("What is this?", []) is False


@pytest.mark.asyncio
async def test_grader_relevant_response_returns_true():
    fake_response = SimpleNamespace(
        text="RELEVANT",
    )

    fake_generate_content = AsyncMock(return_value=fake_response)
    fake_client = SimpleNamespace(
        aio=SimpleNamespace(
            models=SimpleNamespace(
                generate_content=fake_generate_content,
            )
        )
    )

    with patch("rag_engine.crag.get_client", return_value=fake_client):
        result = await grade_relevance(
            "What is the refund policy?",
            [{"text": "Customers can request a refund within 30 days."}],
        )

    assert result is True
    fake_generate_content.assert_awaited_once()


@pytest.mark.asyncio
async def test_grader_irrelevant_response_returns_false():
    fake_response = SimpleNamespace(
        text="IRRELEVANT",
    )

    fake_generate_content = AsyncMock(return_value=fake_response)
    fake_client = SimpleNamespace(
        aio=SimpleNamespace(
            models=SimpleNamespace(
                generate_content=fake_generate_content,
            )
        )
    )

    with patch("rag_engine.crag.get_client", return_value=fake_client):
        result = await grade_relevance(
            "What is the refund policy?",
            [{"text": "The office cafeteria serves lunch from 12 PM."}],
        )

    assert result is False
    fake_generate_content.assert_awaited_once()

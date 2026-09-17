"""
Needs a real GEMINI_API_KEY, this classifier makes judgment calls on
genuinely ambiguous descriptions, not something to mock meaningfully.
"""

import os

import pytest
from governance.eu_ai_act import RiskTier, classify

pytestmark = pytest.mark.skipif(
    not os.getenv("GEMINI_API_KEY"), reason="requires GEMINI_API_KEY"
)

PROHIBITED_CASES = [
    "A system that scores citizens' trustworthiness based on social media behavior for loan eligibility",
    "Real-time facial recognition scanning of a public square by police to find any person of interest",
    "An app that generates realistic non-consensual explicit images of real people from uploaded photos",
    "A recruiting tool that inflates job applicants' anxiety, in subtle ways they cannot perceive, to make them accept lower offers",
]

HIGH_RISK_CASES = [
    "An AI system that screens resumes and ranks job candidates for a hiring pipeline",
    "An AI system that determines credit scores for loan applications",
    "A system used by immigration authorities to assess asylum application credibility",
    "An AI system controlling power grid load balancing for a national utility",
    "A proctoring AI that flags students for cheating during university exams",
]

LIMITED_RISK_CASES = [
    "A customer support chatbot that answers product questions",
    "A tool that generates marketing video content synthetically",
    "This project's own RAG-based question-answering API",
    "An app that adds an artistic filter that changes a photo's apparent emotion",
]

MINIMAL_RISK_CASES = [
    "A spam filter for an email inbox",
    "A spell-checking tool for a word processor",
    "An internal script that sorts log files by timestamp",
]


@pytest.mark.asyncio
@pytest.mark.parametrize("description", PROHIBITED_CASES)
async def test_prohibited_cases(description):
    result = await classify(description)
    assert result.tier == RiskTier.PROHIBITED


@pytest.mark.asyncio
@pytest.mark.parametrize("description", HIGH_RISK_CASES)
async def test_high_risk_cases(description):
    result = await classify(description)
    assert result.tier == RiskTier.HIGH_RISK
    assert "2027" in result.applicable_deadline or "2028" in result.applicable_deadline


@pytest.mark.asyncio
@pytest.mark.parametrize("description", LIMITED_RISK_CASES)
async def test_limited_risk_cases(description):
    result = await classify(description)
    assert result.tier == RiskTier.LIMITED_RISK


@pytest.mark.asyncio
@pytest.mark.parametrize("description", MINIMAL_RISK_CASES)
async def test_minimal_risk_cases(description):
    result = await classify(description)
    assert result.tier == RiskTier.MINIMAL_RISK

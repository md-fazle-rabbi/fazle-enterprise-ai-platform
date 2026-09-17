"""
HTTP surface for the vendor AI risk questionnaire. Named vendor_router.py
rather than routers/vendor.py: governance has no routers/ subpackage —
router.py (classify) and documents/router.py both sit flat — so a third,
differently-shaped convention wasn't introduced just for this endpoint.
"""

from fastapi import APIRouter

from governance.vendor_questionnaire import (
    QUESTIONS,
    QuestionnaireResponse,
    QuestionnaireResult,
    score_questionnaire,
)

router = APIRouter(prefix="/vendor-risk", tags=["governance"])


@router.get("/questions")
async def get_questions() -> list[str]:
    return [q for q, _ in QUESTIONS]


@router.post("/score", response_model=QuestionnaireResult)
async def score(body: QuestionnaireResponse) -> QuestionnaireResult:
    return score_questionnaire(body)

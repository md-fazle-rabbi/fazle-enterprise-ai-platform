"""
EU AI Act classification endpoint. Wraps eu_ai_act.classify() as a
single POST route. Previously defined here but never mounted in
rag-engine's main.py — dead code until this router got wired in
alongside documents/router.py.
"""

from fastapi import APIRouter
from pydantic import BaseModel

from governance.eu_ai_act import ClassificationResult, classify

router = APIRouter(prefix="/classify", tags=["governance"])


class ClassifyRequest(BaseModel):
    system_description: str


@router.post("", response_model=ClassificationResult)
async def classify_system(body: ClassifyRequest) -> ClassificationResult:
    return await classify(body.system_description)

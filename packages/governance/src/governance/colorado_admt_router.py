"""
HTTP surface for the Colorado SB26-189 ADMT assessment. Previously this
logic (state_law_plugins/colorado_admt.py) was importable but had no
route at all, unlike EU AI Act classification, which already had one.
Named colorado_admt_router.py, flat, matching vendor_router.py, not a
new routers/ folder.
"""

from fastapi import APIRouter
from pydantic import BaseModel

from governance.state_law_plugins.colorado_admt import ColoradoADMTAssessment, assess

router = APIRouter(prefix="/classify/colorado-admt", tags=["governance"])


class ColoradoADMTRequest(BaseModel):
    system_description: str
    deployment_context: str


@router.post("", response_model=ColoradoADMTAssessment)
async def assess_colorado_admt(body: ColoradoADMTRequest) -> ColoradoADMTAssessment:
    return await assess(body.system_description, body.deployment_context)

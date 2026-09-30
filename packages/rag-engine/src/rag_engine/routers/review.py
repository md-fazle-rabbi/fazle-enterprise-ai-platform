import uuid
from datetime import UTC, datetime
from typing import Annotated

import structlog
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from rag_engine.db import get_admin_session, require_platform_admin
from rag_engine.models import ReviewQueueItem
from rag_engine.user_auth import AuthenticatedUser

router = APIRouter(prefix="/review-queue", tags=["review"])
logger = structlog.get_logger()


class ReviewItemOut(BaseModel):
    id: uuid.UUID
    question: str
    answer: str
    flag_reasons: list[str]
    status: str


class ReviewDecision(BaseModel):
    note: str | None = None


@router.get("", response_model=list[ReviewItemOut])
async def list_pending(
    session: Annotated[AsyncSession, Depends(get_admin_session)],
) -> list[ReviewQueueItem]:
    result = await session.scalars(
        select(ReviewQueueItem)
        .where(ReviewQueueItem.status == "pending")
        .order_by(ReviewQueueItem.created_at)
    )
    return list(result)


@router.post("/{item_id}/resolve", response_model=ReviewItemOut)
async def resolve(
    item_id: uuid.UUID,
    body: ReviewDecision,
    session: Annotated[AsyncSession, Depends(get_admin_session)],
    # Why: a second, independent admin check. get_admin_session already required
    # platform-admin to resolve a tenant to scope the query to, but it does not hand the
    # caller's identity up to the route. This asks again, at the small cost of one extra
    # token verification, so who resolved a flagged answer is recorded, not just that
    # someone with the role did.
    admin: Annotated[AuthenticatedUser, Depends(require_platform_admin)],
) -> ReviewQueueItem:
    item = await session.get(ReviewQueueItem, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Not found")
    item.status = "reviewed"
    item.reviewed_at = datetime.now(UTC)
    item.reviewer_note = body.note
    logger.info("admin.review_resolved", actor=admin.subject, item_id=str(item_id))
    return item

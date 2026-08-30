import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from rag_engine.db import get_session
from rag_engine.models import ReviewQueueItem

router = APIRouter(prefix="/review-queue", tags=["review"])


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
    session: Annotated[AsyncSession, Depends(get_session)],
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
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ReviewQueueItem:
    item = await session.get(ReviewQueueItem, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Not found")
    item.status = "reviewed"
    item.reviewed_at = datetime.now(UTC)
    item.reviewer_note = body.note
    return item

"""
Chat history: one conversation per thread, a user and an assistant message per exchange.

Everything here is private to one user inside one tenant, and Postgres enforces that (the
owner_isolation policy needs both app.tenant_id and app.user_id), so a query that forgot a
WHERE clause would still see nothing. A real Keycloak token is required.

History is the user's own record, not an audit trail: the web tier saves an exchange after
a successful answer, and the backend cannot tell that the stored answer came from its own
pipeline. The hash-chained audit log stays the integrity record.
"""

import uuid
from datetime import datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, StringConstraints, field_validator
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from rag_engine.db import UserContext, get_user_context, get_user_session
from rag_engine.models import Conversation, Message
from rag_engine.routers.query import QueryResponse

router = APIRouter(prefix="/conversations", tags=["conversations"])

# Why: a runaway client or a bug must not be able to fill the disk. Counted per user inside
# one tenant, since row level security only lets a user see their own rows.
MAX_CONVERSATIONS_PER_USER = 500
MAX_MESSAGES_PER_CONVERSATION = 1_000
MAX_ANSWER_CHARS = 50_000
MAX_SOURCES = 50
DEFAULT_TITLE = "New chat"
TITLE_CHARS = 60

Question = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2_000)
]


class ConversationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    created_at: datetime
    updated_at: datetime


class MessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    role: str
    content: str
    result: dict[str, Any] | None
    created_at: datetime


class ConversationDetail(ConversationOut):
    messages: list[MessageOut]


class ExchangeIn(BaseModel):
    question: Question
    result: QueryResponse

    @field_validator("result")
    @classmethod
    def _bounded(cls, value: QueryResponse) -> QueryResponse:
        if (
            len(value.answer) > MAX_ANSWER_CHARS
            or len(value.citations) > MAX_SOURCES
            or len(value.retrieved_context) > MAX_SOURCES
        ):
            raise ValueError("result is too large")
        return value


@router.post("", response_model=ConversationOut, status_code=201)
async def create_conversation(
    ctx: Annotated[UserContext, Depends(get_user_context)],
    session: Annotated[AsyncSession, Depends(get_user_session)],
) -> Conversation:
    existing = await session.scalar(select(func.count()).select_from(Conversation))
    if (existing or 0) >= MAX_CONVERSATIONS_PER_USER:
        raise HTTPException(
            status_code=409,
            detail="Conversation limit reached; delete one to start another",
        )
    conversation = Conversation(
        tenant_id=ctx.tenant_id, user_id=ctx.user_id, title=DEFAULT_TITLE
    )
    session.add(conversation)
    await session.flush()
    # Why: created_at and updated_at are filled in by the database, so they must be read
    # back before the response is built; touching them lazily on an async session fails.
    await session.refresh(conversation)
    return conversation


@router.get("", response_model=list[ConversationOut])
async def list_conversations(
    session: Annotated[AsyncSession, Depends(get_user_session)],
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[Conversation]:
    result = await session.scalars(
        select(Conversation)
        .order_by(Conversation.updated_at.desc(), Conversation.id)
        .limit(limit)
        .offset(offset)
    )
    return list(result)


@router.get("/{conversation_id}", response_model=ConversationDetail)
async def get_conversation(
    conversation_id: uuid.UUID,
    session: Annotated[AsyncSession, Depends(get_user_session)],
) -> ConversationDetail:
    # Why 404 for someone else's conversation too: it is simply invisible under row level
    # security, so "not yours" and "does not exist" look the same, which leaks nothing.
    conversation = await session.get(Conversation, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Not found")
    messages = await session.scalars(
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at)
        .limit(MAX_MESSAGES_PER_CONVERSATION)
    )
    return ConversationDetail(
        id=conversation.id,
        title=conversation.title,
        created_at=conversation.created_at,
        updated_at=conversation.updated_at,
        messages=[MessageOut.model_validate(message) for message in messages],
    )


@router.post(
    "/{conversation_id}/exchanges", response_model=list[MessageOut], status_code=201
)
async def add_exchange(
    conversation_id: uuid.UUID,
    body: ExchangeIn,
    ctx: Annotated[UserContext, Depends(get_user_context)],
    session: Annotated[AsyncSession, Depends(get_user_session)],
) -> list[MessageOut]:
    conversation = await session.get(Conversation, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Not found")
    stored = await session.scalar(
        select(func.count())
        .select_from(Message)
        .where(Message.conversation_id == conversation_id)
    )
    if (stored or 0) + 2 > MAX_MESSAGES_PER_CONVERSATION:
        raise HTTPException(status_code=409, detail="This conversation is full")

    # Why: explicit, distinct timestamps from the database clock. now() is the same for every
    # row in a transaction, so the question and its answer would tie and could sort either
    # way, and the Python clock is not guaranteed to agree with Postgres's.
    now = await session.scalar(select(func.clock_timestamp()))
    if now is None:
        raise RuntimeError("The database returned no time")
    user_message = Message(
        conversation_id=conversation_id,
        tenant_id=ctx.tenant_id,
        user_id=ctx.user_id,
        role="user",
        content=body.question,
        result=None,
        created_at=now,
    )
    assistant_message = Message(
        conversation_id=conversation_id,
        tenant_id=ctx.tenant_id,
        user_id=ctx.user_id,
        role="assistant",
        content=body.result.answer,
        result=body.result.model_dump(mode="json"),
        created_at=now + timedelta(milliseconds=1),
    )
    session.add_all([user_message, assistant_message])
    if conversation.title == DEFAULT_TITLE:
        conversation.title = " ".join(body.question.split())[:TITLE_CHARS]
    conversation.updated_at = assistant_message.created_at
    await session.flush()
    return [
        MessageOut.model_validate(user_message),
        MessageOut.model_validate(assistant_message),
    ]


@router.delete("/{conversation_id}", status_code=204)
async def delete_conversation(
    conversation_id: uuid.UUID,
    session: Annotated[AsyncSession, Depends(get_user_session)],
) -> None:
    conversation = await session.get(Conversation, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Not found")
    # Why: messages are deleted explicitly first, next to the foreign key's ON DELETE
    # CASCADE, so erasing a conversation does not depend on how cascades interact with row
    # level security.
    await session.execute(
        delete(Message).where(Message.conversation_id == conversation_id)
    )
    await session.delete(conversation)

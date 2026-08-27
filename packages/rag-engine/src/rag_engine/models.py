"""
First real table: documents. tenant_id has no default and is not nullable,
every insert must state it explicitly. A missing tenant_id should be a loud
error at write time, not a silent leak later.

id now carries both a client-side default (uuid.uuid4, used when SQLAlchemy
builds the INSERT) and a database-side default (gen_random_uuid(), used for
any raw SQL insert that bypasses the ORM — psql, other services, admin
scripts). Without the server_default, a raw INSERT that omits id hits a
not-null violation, since the Python-side default never reaches the DB.
"""
import uuid
from datetime import datetime

from core.db import Base
from sqlalchemy import DateTime, Text, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=text("gen_random_uuid()"),
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    content_hash: Mapped[str] = mapped_column(Text, nullable=False)
    source_path: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
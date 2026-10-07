"""conversation history

Revision ID: c3a91f5d7e20
Revises: 59901124d481
Create Date: 2026-10-07 09:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

# revision identifiers, used by Alembic.
revision: str = "c3a91f5d7e20"
down_revision: str | Sequence[str] | None = "59901124d481"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "conversations",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("tenant_id", UUID(as_uuid=True), nullable=False),
        # Why text, not uuid: this is the Keycloak "sub" claim. Its format is Keycloak's
        # business, not ours to bake into the schema.
        sa.Column("user_id", sa.Text, nullable=False),
        sa.Column("title", sa.Text, nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        # Why: lets messages point at (id, tenant, user) together, see the foreign key below.
        sa.UniqueConstraint(
            "id", "tenant_id", "user_id", name="uq_conversations_owner"
        ),
    )
    op.execute(
        "CREATE INDEX ix_conversations_owner_updated "
        "ON conversations (tenant_id, user_id, updated_at DESC)"
    )

    op.create_table(
        "messages",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("conversation_id", UUID(as_uuid=True), nullable=False),
        sa.Column("tenant_id", UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", sa.Text, nullable=False),
        sa.Column("role", sa.Text, nullable=False),
        sa.Column("content", sa.Text, nullable=False),
        sa.Column("result", JSONB, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint("role IN ('user', 'assistant')", name="ck_messages_role"),
        # Why: a message cannot name a different tenant or user than the conversation it
        # belongs to, so a bug in application code cannot create a mismatched row.
        sa.ForeignKeyConstraint(
            ["conversation_id", "tenant_id", "user_id"],
            ["conversations.id", "conversations.tenant_id", "conversations.user_id"],
            name="fk_messages_conversation_owner",
            ondelete="CASCADE",
        ),
    )
    op.create_index(
        "ix_messages_conversation_created",
        "messages",
        ["conversation_id", "created_at"],
    )

    for table in ("conversations", "messages"):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        # Why both settings: tenant isolation alone would let one user read another user's
        # chats in the same tenant. With either setting missing, current_setting(..., true)
        # is NULL, the comparison is NULL, and the row is invisible: it fails closed.
        op.execute(f"""
            CREATE POLICY owner_isolation ON {table}
            USING (
                tenant_id = current_setting('app.tenant_id', true)::uuid
                AND user_id = current_setting('app.user_id', true)
            )
            WITH CHECK (
                tenant_id = current_setting('app.tenant_id', true)::uuid
                AND user_id = current_setting('app.user_id', true)
            )
        """)
        op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON {table} TO app_user")


def downgrade() -> None:
    op.drop_table("messages")
    op.drop_table("conversations")

"""add modality to chunks

Revision ID: a2662c66b944
Revises: 1cfc95c7bfd0
Create Date: 2026-08-30 04:43:15.258069

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a2662c66b944"
down_revision: str | Sequence[str] | None = "1cfc95c7bfd0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "chunks", sa.Column("modality", sa.Text, nullable=False, server_default="text")
    )


def downgrade() -> None:
    op.drop_column("chunks", "modality")

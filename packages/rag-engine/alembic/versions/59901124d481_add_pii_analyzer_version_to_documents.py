"""add pii_analyzer_version to documents

Revision ID: 59901124d481
Revises: 10a39aecb942
Create Date: 2026-09-26 03:23:38.244371

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "59901124d481"
down_revision: str | Sequence[str] | None = "10a39aecb942"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "documents",
        sa.Column(
            "pii_analyzer_version",
            sa.Text(),
            nullable=False,
            server_default="pre-versioning",
        ),
    )
    op.alter_column("documents", "pii_analyzer_version", server_default=None)


def downgrade() -> None:
    op.drop_column("documents", "pii_analyzer_version")

"""pii entity types on documents

Revision ID: a1b2920fe884
Revises: a2662c66b944
Create Date: 2026-08-30 18:07:53.085505

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ARRAY

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a1b2920fe884"
down_revision: str | Sequence[str] | None = "a2662c66b944"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "documents", sa.Column("pii_entity_types", ARRAY(sa.Text), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("documents", "pii_entity_types")

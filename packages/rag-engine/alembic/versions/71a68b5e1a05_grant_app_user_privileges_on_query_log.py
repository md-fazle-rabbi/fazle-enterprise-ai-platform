"""grant app_user privileges on query_log

Revision ID: 71a68b5e1a05
Revises: dad2ab714c8b
Create Date: 2026-09-16 16:42:56.854879

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "71a68b5e1a05"
down_revision: str | Sequence[str] | None = "dad2ab714c8b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON query_log TO app_user")


def downgrade() -> None:
    op.execute("REVOKE SELECT, INSERT, UPDATE, DELETE ON query_log FROM app_user")

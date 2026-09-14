"""grant app_user privileges on review_queue

Revision ID: 9d9bfb4a320e
Revises: 7c2661df94b3
Create Date: 2026-09-15 02:00:17.912245

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "9d9bfb4a320e"
down_revision: str | Sequence[str] | None = "7c2661df94b3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON review_queue TO app_user")


def downgrade() -> None:
    op.execute("REVOKE SELECT, INSERT, UPDATE, DELETE ON review_queue FROM app_user")

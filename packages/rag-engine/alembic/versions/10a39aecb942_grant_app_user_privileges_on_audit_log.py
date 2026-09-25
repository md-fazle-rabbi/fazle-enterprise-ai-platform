"""grant app_user privileges on audit_log

Revision ID: 10a39aecb942
Revises: 21025c81fb09
Create Date: 2026-09-26 02:20:34.041028

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "10a39aecb942"
down_revision: str | Sequence[str] | None = "21025c81fb09"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("GRANT SELECT, INSERT ON audit_log TO app_user")


def downgrade() -> None:
    op.execute("REVOKE SELECT, INSERT ON audit_log FROM app_user")

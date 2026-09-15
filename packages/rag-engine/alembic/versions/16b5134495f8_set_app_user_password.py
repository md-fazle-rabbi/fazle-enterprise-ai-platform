"""set app_user password

Revision ID: 16b5134495f8
Revises: 1a678fc46382
Create Date: 2026-08-27 02:09:58.745513

"""

from collections.abc import Sequence

from alembic import op
from core.settings import settings

# revision identifiers, used by Alembic.
revision: str = "16b5134495f8"
down_revision: str | Sequence[str] | None = "1a678fc46382"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ALTER ROLE ... PASSWORD is a utility statement, not DML — Postgres's
    # parser doesn't accept a bind parameter ($1) in this position at all,
    # regardless of driver. The value must be a literal in the SQL text.
    # Standard single-quote escaping (doubling) is sufficient and safe here
    # since this value comes from server-side settings, not request input.
    escaped_password = settings.app_db_password.replace("'", "''")
    op.execute(f"ALTER ROLE app_user WITH PASSWORD '{escaped_password}'")


def downgrade() -> None:
    op.execute("ALTER ROLE app_user WITH PASSWORD NULL")

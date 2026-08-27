"""grant app_user privileges on chunks

Revision ID: 1d5a9871e994
Revises: 7326c5b494dd
Create Date: 2026-08-28 03:23:47.006996

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '1d5a9871e994'
down_revision: Union[str, Sequence[str], None] = '7326c5b494dd'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON chunks TO app_user")


def downgrade() -> None:
    op.execute("REVOKE SELECT, INSERT, UPDATE, DELETE ON chunks FROM app_user")

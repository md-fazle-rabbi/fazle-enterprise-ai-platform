"""add server default to documents id

Revision ID: 1a678fc46382
Revises: 2765840adb7a
Create Date: 2026-08-27 02:00:56.766717

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '1a678fc46382'
down_revision: Union[str, Sequence[str], None] = '2765840adb7a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE documents ALTER COLUMN id SET DEFAULT gen_random_uuid()")


def downgrade() -> None:
    op.execute("ALTER TABLE documents ALTER COLUMN id DROP DEFAULT")
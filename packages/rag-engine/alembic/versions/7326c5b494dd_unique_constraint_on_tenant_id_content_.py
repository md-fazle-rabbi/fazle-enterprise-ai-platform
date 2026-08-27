"""unique constraint on tenant_id, content_hash

Revision ID: 7326c5b494dd
Revises: ffb33ff0ae4a
Create Date: 2026-08-28 02:32:22.650074

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '7326c5b494dd'
down_revision: Union[str, Sequence[str], None] = 'ffb33ff0ae4a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_unique_constraint(
        "uq_documents_tenant_content_hash", "documents", ["tenant_id", "content_hash"]
    )


def downgrade() -> None:
    op.drop_constraint("uq_documents_tenant_content_hash", "documents", type_="unique")

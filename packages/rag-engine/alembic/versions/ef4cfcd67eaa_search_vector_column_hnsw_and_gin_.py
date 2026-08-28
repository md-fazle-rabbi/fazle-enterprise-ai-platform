"""search_vector column, hnsw and gin indexes

Revision ID: ef4cfcd67eaa
Revises: 1d5a9871e994
Create Date: 2026-08-28 23:07:59.581343

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'ef4cfcd67eaa'
down_revision: Union[str, Sequence[str], None] = '1d5a9871e994'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE chunks ADD COLUMN search_vector tsvector
        GENERATED ALWAYS AS (to_tsvector('english', text)) STORED
    """)
    op.execute("CREATE INDEX ix_chunks_search_vector ON chunks USING GIN (search_vector)")
    op.execute("CREATE INDEX ix_chunks_embedding_hnsw ON chunks USING hnsw (embedding vector_cosine_ops)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_chunks_embedding_hnsw")
    op.execute("DROP INDEX IF EXISTS ix_chunks_search_vector")
    op.execute("ALTER TABLE chunks DROP COLUMN search_vector")
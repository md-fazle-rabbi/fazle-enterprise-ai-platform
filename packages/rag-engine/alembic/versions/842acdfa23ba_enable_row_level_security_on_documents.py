"""enable row level security on documents

Revision ID: 842acdfa23ba
Revises: 355ad3bb11ed
Create Date: 2026-08-26 17:08:22.223539

"""
from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '842acdfa23ba'
down_revision: str | Sequence[str] | None = '355ad3bb11ed'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.execute("ALTER TABLE documents ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE documents FORCE ROW LEVEL SECURITY")
    op.execute("""
        CREATE POLICY tenant_isolation ON documents
        USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)
    """)


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON documents")
    op.execute("ALTER TABLE documents DISABLE ROW LEVEL SECURITY")

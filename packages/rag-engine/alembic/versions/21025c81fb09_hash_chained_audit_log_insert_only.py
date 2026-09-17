"""hash-chained audit log, insert-only

Revision ID: 21025c81fb09
Revises: 71a68b5e1a05
Create Date: 2026-09-17 15:47:05.268257

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSON, UUID

# revision identifiers, used by Alembic.
revision: str = "21025c81fb09"
down_revision: str | Sequence[str] | None = "71a68b5e1a05"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "audit_log",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", UUID(as_uuid=True), nullable=False),
        sa.Column("event_type", sa.Text, nullable=False),
        sa.Column("event_data", JSON, nullable=False),
        sa.Column("trace_id", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("prev_hash", sa.Text, nullable=False),
        sa.Column("entry_hash", sa.Text, nullable=False, unique=True),
    )
    op.create_index(
        "ix_audit_log_created_at", "audit_log", ["created_at"], unique=False
    )

    # INSERT-only enforced at the DB level, not app-code discipline alone --
    # this still holds even against a compromised app process using the
    # same DB role, as long as that role isn't superuser. REVOKE UPDATE,
    # DELETE on a dedicated less-privileged role (the app_user role created
    # in 2765840adb7a) would be stronger still, worth doing once that role
    # is used for this table too; not wired up yet, so the RULEs below are
    # the enforcement point for now.
    op.execute(
        "CREATE RULE audit_log_no_update AS ON UPDATE TO audit_log DO INSTEAD NOTHING"
    )
    op.execute(
        "CREATE RULE audit_log_no_delete AS ON DELETE TO audit_log DO INSTEAD NOTHING"
    )

    op.execute("ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE audit_log FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY tenant_isolation ON audit_log
        USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)
        """
    )


def downgrade() -> None:
    op.execute("DROP RULE IF EXISTS audit_log_no_delete ON audit_log")
    op.execute("DROP RULE IF EXISTS audit_log_no_update ON audit_log")
    op.drop_index("ix_audit_log_created_at", table_name="audit_log")
    op.drop_table("audit_log")

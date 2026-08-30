"""create least privilege app role

Revision ID: 2765840adb7a
Revises: 842acdfa23ba
Create Date: 2026-08-26 17:19:00.832071

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "2765840adb7a"
down_revision: str | Sequence[str] | None = "842acdfa23ba"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
                CREATE ROLE app_user LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
            END IF;
        END
        $$;
    """)
    # current_database() instead of a hardcoded name: this migration runs
    # unmodified against local Postgres (database "fazle") and against
    # Supabase (database "postgres"), it always grants on whichever
    # database the connection is actually using.
    op.execute("""
        DO $$
        BEGIN
            EXECUTE format('GRANT CONNECT ON DATABASE %I TO app_user', current_database());
        END
        $$;
    """)
    op.execute("GRANT USAGE ON SCHEMA public TO app_user")
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON documents TO app_user")


def downgrade() -> None:
    op.execute("REVOKE SELECT, INSERT, UPDATE, DELETE ON documents FROM app_user")
    op.execute("REVOKE USAGE ON SCHEMA public FROM app_user")
    op.execute("""
        DO $$
        BEGIN
            EXECUTE format('REVOKE CONNECT ON DATABASE %I FROM app_user', current_database());
        END
        $$;
    """)
    op.execute("DROP ROLE IF EXISTS app_user")

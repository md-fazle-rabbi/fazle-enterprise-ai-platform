"""create least privilege app role

Revision ID: 2765840adb7a
Revises: 842acdfa23ba
Create Date: 2026-08-26 17:19:00.832071

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '2765840adb7a'
down_revision: Union[str, Sequence[str], None] = '842acdfa23ba'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None



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
    op.execute("GRANT CONNECT ON DATABASE fazle TO app_user")
    op.execute("GRANT USAGE ON SCHEMA public TO app_user")
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON documents TO app_user")


def downgrade() -> None:
    op.execute("REVOKE SELECT, INSERT, UPDATE, DELETE ON documents FROM app_user")
    op.execute("REVOKE USAGE ON SCHEMA public FROM app_user")
    op.execute("REVOKE CONNECT ON DATABASE fazle FROM app_user")
    op.execute("DROP ROLE IF EXISTS app_user")

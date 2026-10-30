"""add conversations

Revision ID: b91b5652a2d6
Revises: 6d700da21dfc
Create Date: 2026-10-30 01:31:58.652395

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b91b5652a2d6"
down_revision: str | Sequence[str] | None = "6d700da21dfc"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


FK_NAME = "exchanges_conversation_id_fkey"


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "conversations",
        sa.Column("id", sa.Integer(), sa.Identity(always=False), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_conversations_updated_at"), "conversations", ["updated_at"], unique=False
    )
    op.add_column("exchanges", sa.Column("conversation_id", sa.Integer(), nullable=True))
    op.add_column("exchanges", sa.Column("provider", sa.String(length=20), nullable=True))

    # Existing exchanges were single questions: each becomes its own conversation, titled with
    # its (shortened) prompt. Their provider is inferred from the model name.
    op.execute(
        """
        WITH created AS (
            INSERT INTO conversations (title, created_at, updated_at)
            SELECT left(prompt, 60), created_at, created_at FROM exchanges ORDER BY id
            RETURNING id, created_at, title
        ), numbered_conversations AS (
            SELECT id, row_number() OVER (ORDER BY id) AS n FROM created
        ), numbered_exchanges AS (
            SELECT id, row_number() OVER (ORDER BY id) AS n FROM exchanges
        )
        UPDATE exchanges SET conversation_id = c.id
        FROM numbered_exchanges e JOIN numbered_conversations c USING (n)
        WHERE exchanges.id = e.id
        """
    )
    op.execute(
        "UPDATE exchanges SET provider = "
        "CASE WHEN model LIKE 'gemini%' THEN 'gemini' ELSE 'claude' END"
    )

    op.alter_column("exchanges", "conversation_id", nullable=False)
    op.alter_column("exchanges", "provider", nullable=False)
    op.create_index(
        op.f("ix_exchanges_conversation_id"), "exchanges", ["conversation_id"], unique=False
    )
    op.create_foreign_key(
        FK_NAME, "exchanges", "conversations", ["conversation_id"], ["id"], ondelete="CASCADE"
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint(FK_NAME, "exchanges", type_="foreignkey")
    op.drop_index(op.f("ix_exchanges_conversation_id"), table_name="exchanges")
    op.drop_column("exchanges", "provider")
    op.drop_column("exchanges", "conversation_id")
    op.drop_index(op.f("ix_conversations_updated_at"), table_name="conversations")
    op.drop_table("conversations")

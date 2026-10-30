"""chat studio: chat settings, pins, versions, reasoning, caching, images, prompts

Revision ID: 3c1f7a9d2e44
Revises: 5488f851126b
Create Date: 2026-10-30 07:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "3c1f7a9d2e44"
down_revision: str | Sequence[str] | None = "5488f851126b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "conversations", sa.Column("pinned_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column("conversations", sa.Column("system_prompt", sa.Text(), nullable=True))
    op.add_column("conversations", sa.Column("temperature", sa.Float(), nullable=True))
    op.add_column("conversations", sa.Column("max_tokens", sa.Integer(), nullable=True))
    op.add_column(
        "conversations",
        sa.Column("show_thinking", sa.Boolean(), server_default="false", nullable=False),
    )

    op.add_column("exchanges", sa.Column("thinking", sa.Text(), nullable=True))
    op.add_column(
        "exchanges",
        sa.Column("cache_read_tokens", sa.Integer(), server_default="0", nullable=False),
    )
    op.add_column(
        "exchanges",
        sa.Column("cache_write_tokens", sa.Integer(), server_default="0", nullable=False),
    )
    op.add_column("exchanges", sa.Column("rating", sa.SmallInteger(), nullable=True))
    op.add_column("exchanges", sa.Column("version_of", sa.Integer(), nullable=True))
    op.create_index(op.f("ix_exchanges_version_of"), "exchanges", ["version_of"])
    op.create_foreign_key(
        op.f("fk_exchanges_version_of_exchanges"),
        "exchanges",
        "exchanges",
        ["version_of"],
        ["id"],
        ondelete="CASCADE",
    )
    op.add_column(
        "exchanges", sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False)
    )
    op.add_column(
        "exchanges",
        sa.Column("api_call", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )

    op.create_table(
        "attachments",
        sa.Column("id", sa.Integer(), sa.Identity(always=False), nullable=False),
        sa.Column("exchange_id", sa.Integer(), nullable=False),
        sa.Column("media_type", sa.String(length=50), nullable=False),
        sa.Column("data", sa.LargeBinary(), nullable=False),
        sa.ForeignKeyConstraint(["exchange_id"], ["exchanges.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_attachments_exchange_id"), "attachments", ["exchange_id"])

    op.create_table(
        "prompts",
        sa.Column("id", sa.Integer(), sa.Identity(always=False), nullable=False),
        sa.Column("title", sa.String(length=100), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("prompts")
    op.drop_index(op.f("ix_attachments_exchange_id"), table_name="attachments")
    op.drop_table("attachments")
    # Versions that aren't active go away with the column that links them.
    op.execute("DELETE FROM exchanges WHERE NOT is_active")
    op.drop_column("exchanges", "api_call")
    op.drop_column("exchanges", "is_active")
    op.drop_constraint(op.f("fk_exchanges_version_of_exchanges"), "exchanges", type_="foreignkey")
    op.drop_index(op.f("ix_exchanges_version_of"), table_name="exchanges")
    op.drop_column("exchanges", "version_of")
    op.drop_column("exchanges", "rating")
    op.drop_column("exchanges", "cache_write_tokens")
    op.drop_column("exchanges", "cache_read_tokens")
    op.drop_column("exchanges", "thinking")
    op.drop_column("conversations", "show_thinking")
    op.drop_column("conversations", "max_tokens")
    op.drop_column("conversations", "temperature")
    op.drop_column("conversations", "system_prompt")
    op.drop_column("conversations", "pinned_at")

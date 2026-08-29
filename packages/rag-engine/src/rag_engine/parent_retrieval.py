"""
Parent-document retrieval: search matches on small chunks, generation gets
the full parent section. Parent means "all chunks sharing the matched
chunk's document_id and heading_path", the section it came from, not the
whole document, returning a whole document for one match would blow the
context budget and reintroduce the imprecision this technique avoids.
"""

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from rag_engine.models import Chunk


async def expand_to_parents(
    session: AsyncSession, chunk_ids: list[uuid.UUID]
) -> list[dict[str, Any]]:
    """
    Matched chunks that share a parent section collapse into one context
    entry, not duplicated. chunk_id in the result stays the originally
    matched chunk, kept as a stable citation anchor even though text is
    the expanded section.
    """
    matched = (
        await session.scalars(select(Chunk).where(Chunk.id.in_(chunk_ids)))
    ).all()
    if not matched:
        return []

    seen: set[tuple[uuid.UUID, tuple[str, ...]]] = set()
    parents: list[dict[str, Any]] = []

    for chunk in matched:
        key = (chunk.document_id, tuple(chunk.heading_path))
        if key in seen:
            continue
        seen.add(key)

        siblings = (
            await session.scalars(
                select(Chunk)
                .where(
                    Chunk.document_id == chunk.document_id,
                    Chunk.heading_path == chunk.heading_path,
                )
                .order_by(Chunk.chunk_index)
            )
        ).all()

        parents.append(
            {
                "chunk_id": chunk.id,
                "text": "\n\n".join(s.text for s in siblings),
                "heading_path": chunk.heading_path,
                "document_id": chunk.document_id,
            }
        )

    return parents

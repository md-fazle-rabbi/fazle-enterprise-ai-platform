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

    The result follows the order of chunk_ids, which is the search ranking,
    best match first.
    """
    rows = (await session.scalars(select(Chunk).where(Chunk.id.in_(chunk_ids)))).all()
    if not rows:
        return []

    # Why: WHERE id IN (...) has no ORDER BY, so the database returns rows in
    # whatever order it finds them (here the order they were inserted), not in
    # ranking order. That threw the fusion ranking away: the generator saw the
    # context, and cited [1] and [2], in storage order, and which chunk anchored
    # a shared section was arbitrary. Sorting by position in chunk_ids restores
    # the ranking the search computed.
    position = {chunk_id: index for index, chunk_id in enumerate(chunk_ids)}
    matched = sorted(rows, key=lambda chunk: position[chunk.id])

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

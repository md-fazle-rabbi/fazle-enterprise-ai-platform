"""
Hybrid search: dense vector (pgvector, cosine) + Postgres native full-text
ranking (ts_rank_cd over a generated tsvector), fused with Reciprocal Rank
Fusion.

Honesty note: ts_rank_cd is in the BM25 family but is not an exact Okapi
BM25 implementation, unlike a dedicated extension such as pg_textsearch
(Tiger Data) or ParadeDB's pg_search, both production-ready as of 2026.
Chose native tsvector for zero extra infrastructure. Swapping in a real
BM25 extension is a documented upgrade path, tracked in Known Limitations,
not a claimed feature this doesn't actually have.
"""

import math
import uuid

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from rag_engine.embeddings import embed_query
from rag_engine.models import Chunk

RRF_K = 60

# Why: plainto_tsquery joins every word of the question with AND. One word the
# chunk does not contain ("value", "catch") then kills the whole sparse leg, and
# "hybrid" search silently becomes dense-only for most natural questions. Measured
# on the evaluation corpus: 3 of 5 questions returned no sparse hit at all.
# plainto_tsquery still does the parsing, stemming and stop word removal (so the
# lexemes match the stored english tsvector); its AND is swapped for OR, and
# ts_rank_cd ranks chunks that match more of the question words higher. The
# 'simple' config in to_tsquery stops the already stemmed lexemes being stemmed twice.
# A question made only of stop words gives an empty query, which matches nothing.
_SPARSE_SQL = text("""
    WITH parsed AS (
        SELECT to_tsquery(
                   'simple',
                   replace(CAST(plainto_tsquery('english', :q) AS text), ' & ', ' | ')
               ) AS tsq
    )
    SELECT chunks.id
    FROM chunks, parsed
    WHERE chunks.search_vector @@ parsed.tsq
    ORDER BY ts_rank_cd(chunks.search_vector, parsed.tsq) DESC, chunks.id
    LIMIT :limit
""")


async def _dense_search(
    session: AsyncSession, query_vector: list[float], limit: int
) -> list[tuple[uuid.UUID, int]]:
    result = await session.execute(
        select(Chunk.id)
        .order_by(Chunk.embedding.cosine_distance(query_vector))
        .limit(limit)
    )
    ids = result.scalars().all()
    return [(chunk_id, rank) for rank, chunk_id in enumerate(ids, start=1)]


async def _sparse_search(
    session: AsyncSession, query_text: str, limit: int
) -> list[tuple[uuid.UUID, int]]:
    result = await session.execute(_SPARSE_SQL, {"q": query_text, "limit": limit})
    ids = result.scalars().all()
    return [(chunk_id, rank) for rank, chunk_id in enumerate(ids, start=1)]


def _reciprocal_rank_fusion(
    *rank_lists: list[tuple[uuid.UUID, int]], k: int = RRF_K
) -> list[tuple[uuid.UUID, float]]:
    """
    Fuse ranked lists. On an equal fused score the chunk with the better rank
    in the LAST list wins, then the one with the better rank in the earlier
    lists, then the smaller chunk id.

    Why: two chunks that swap places between the lists (dense 1 and sparse 2,
    against dense 2 and sparse 1) get exactly the same score. Without a rule
    the winner was whichever chunk the loop happened to see first, so the order
    depended on insertion order, not on evidence. hybrid_search passes (dense,
    sparse), so on a tie the chunk with the stronger keyword match wins. That
    is a design choice: a tie means the legs disagree, and a keyword hit is the
    more explainable signal than a small cosine difference between near
    identical chunks.
    """
    scores: dict[uuid.UUID, float] = {}
    ranks_by_list: dict[uuid.UUID, list[float]] = {}
    for position, ranks in enumerate(rank_lists):
        for chunk_id, rank in ranks:
            scores[chunk_id] = scores.get(chunk_id, 0.0) + 1.0 / (k + rank)
            per_list = ranks_by_list.setdefault(chunk_id, [math.inf] * len(rank_lists))
            per_list[position] = rank

    def sort_key(item: tuple[uuid.UUID, float]) -> tuple[float, list[float], str]:
        chunk_id, score = item
        # Why: rounding keeps two scores that differ only in the last float bit
        # (the same terms added in a different order) counted as a tie.
        return (-round(score, 12), ranks_by_list[chunk_id][::-1], str(chunk_id))

    return sorted(scores.items(), key=sort_key)


async def hybrid_search(
    session: AsyncSession,
    query_text: str,
    top_k: int = 10,
    candidate_pool: int = 50,
    *,
    query_vector: list[float] | None = None,
) -> list[uuid.UUID]:
    """
    Dense and sparse searches run sequentially on purpose, not concurrently:
    SQLAlchemy's AsyncSession wraps one connection and isn't safe for
    concurrent queries on the same session. Two sessions would let these
    run in parallel, not worth the added complexity at this scale yet.

    query_vector is the embedding of query_text, when the caller already has
    it. /query embeds the question once for the semantic cache check and
    passes that same vector here, so one question costs one embedding call,
    not two. Left out, this embeds query_text itself (as /search does).
    """
    if query_vector is None:
        query_vector = await embed_query(query_text)
    dense_ranks = await _dense_search(session, query_vector, candidate_pool)
    sparse_ranks = await _sparse_search(session, query_text, candidate_pool)
    fused = _reciprocal_rank_fusion(dense_ranks, sparse_ranks)
    return [chunk_id for chunk_id, _score in fused[:top_k]]

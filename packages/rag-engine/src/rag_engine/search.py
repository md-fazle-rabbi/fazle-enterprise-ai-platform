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
import uuid

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from rag_engine.embeddings import embed_query
from rag_engine.models import Chunk

RRF_K = 60


async def _dense_search(
    session: AsyncSession, query_vector: list[float], limit: int
) -> list[tuple[uuid.UUID, int]]:
    result = await session.execute(
        select(Chunk.id).order_by(Chunk.embedding.cosine_distance(query_vector)).limit(limit)
    )
    ids = result.scalars().all()
    return [(chunk_id, rank) for rank, chunk_id in enumerate(ids, start=1)]


async def _sparse_search(
    session: AsyncSession, query_text: str, limit: int
) -> list[tuple[uuid.UUID, int]]:
    result = await session.execute(
        text("""
            SELECT id
            FROM chunks
            WHERE search_vector @@ plainto_tsquery('english', :q)
            ORDER BY ts_rank_cd(search_vector, plainto_tsquery('english', :q)) DESC
            LIMIT :limit
        """),
        {"q": query_text, "limit": limit},
    )
    ids = result.scalars().all()
    return [(chunk_id, rank) for rank, chunk_id in enumerate(ids, start=1)]


def _reciprocal_rank_fusion(
    *rank_lists: list[tuple[uuid.UUID, int]], k: int = RRF_K
) -> list[tuple[uuid.UUID, float]]:
    scores: dict[uuid.UUID, float] = {}
    for ranks in rank_lists:
        for chunk_id, rank in ranks:
            scores[chunk_id] = scores.get(chunk_id, 0.0) + 1.0 / (k + rank)
    return sorted(scores.items(), key=lambda item: item[1], reverse=True)


async def hybrid_search(
    session: AsyncSession, query_text: str, top_k: int = 10, candidate_pool: int = 50
) -> list[uuid.UUID]:
    """
    Dense and sparse searches run sequentially on purpose, not concurrently:
    SQLAlchemy's AsyncSession wraps one connection and isn't safe for
    concurrent queries on the same session. Two sessions would let these
    run in parallel, not worth the added complexity at this scale yet.
    """
    query_vector = await embed_query(query_text)
    dense_ranks = await _dense_search(session, query_vector, candidate_pool)
    sparse_ranks = await _sparse_search(session, query_text, candidate_pool)
    fused = _reciprocal_rank_fusion(dense_ranks, sparse_ranks)
    return [chunk_id for chunk_id, _score in fused[:top_k]]
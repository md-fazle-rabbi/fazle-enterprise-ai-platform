"""
Thin wrapper around Voyage AI's embedding API. Anthropic doesn't offer its
own embedding model and names Voyage AI as its recommended partner for
Claude-based apps, that's the reason for this choice, not unfamiliarity
with alternatives.
"""
import voyageai

from core.settings import settings

EMBEDDING_MODEL = "voyage-4-large"
EMBEDDING_DIMENSION = 1024

_client = voyageai.AsyncClient(api_key=settings.voyage_api_key)


async def embed_documents(texts: list[str]) -> list[list[float]]:
    """Document-side embeddings, called once per chunk at ingestion time."""
    result = await _client.embed(
        texts,
        model=EMBEDDING_MODEL,
        input_type="document",
        output_dimension=EMBEDDING_DIMENSION,
    )
    return result.embeddings


async def embed_query(text: str) -> list[float]:
    """Query-side embedding, used at retrieval time, next phase."""
    result = await _client.embed(
        [text],
        model=EMBEDDING_MODEL,
        input_type="query",
        output_dimension=EMBEDDING_DIMENSION,
    )
    return result.embeddings[0]
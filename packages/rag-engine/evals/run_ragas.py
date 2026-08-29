"""
Runs the golden set through the real /ingest and /query endpoints, scores
the results with RAGAS, exits non-zero if any metric falls below its
roadmap-fixed floor.

The RAGAS judge uses Gemini.
Meant for CI and for local runs before trusting any change to chunking,
retrieval, or the generation prompt.
"""

import asyncio
import sys
import uuid

import httpx
import voyageai.error
from asgi_lifespan import LifespanManager
from core.settings import settings
from datasets import Dataset
from evals.golden_set import GOLDEN_CORPUS, GOLDEN_QUESTIONS
from httpx import ASGITransport, AsyncClient
from langchain_google_genai import ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings
from rag_engine.main import app
from ragas import evaluate
from ragas.embeddings import LangchainEmbeddingsWrapper
from ragas.llms import LangchainLLMWrapper
from ragas.metrics import AnswerRelevancy, context_precision, faithfulness
from ragas.run_config import RunConfig

THRESHOLDS = {
    "faithfulness": 0.90,
    "answer_relevancy": 0.85,
    "context_precision": 0.80,
}

_VOYAGE_RATE_LIMIT_BACKOFF_SECONDS = 25
_TRANSIENT_ERROR_BACKOFF_SECONDS = 5
_MAX_RETRIES = 3

# The golden corpus only has 3 documents. Using the production default
# top_k=5 against a 3-document corpus means every query retrieves all 3
# documents regardless of relevance. top_k=2 here is an eval-only
# parameter, scoped to this small golden set; production top_k stays at
# its own default untouched.
_EVAL_TOP_K = 2


async def _post_with_backoff(client: AsyncClient, url: str, **kwargs):
    for attempt in range(_MAX_RETRIES + 1):
        try:
            response = await client.post(url, **kwargs)
            response.raise_for_status()
            return response
        except Exception as exc:
            is_voyage_rate_limit = isinstance(
                getattr(exc, "__cause__", None), voyageai.error.RateLimitError
            ) or "RateLimitError" in repr(exc)
            is_transient_network_error = isinstance(exc, httpx.TransportError)

            if not (is_voyage_rate_limit or is_transient_network_error):
                raise
            if attempt == _MAX_RETRIES:
                raise

            if is_voyage_rate_limit:
                wait = _VOYAGE_RATE_LIMIT_BACKOFF_SECONDS
                print(
                    f"  Voyage rate limit hit, waiting {wait}s before retry "
                    f"({attempt + 1}/{_MAX_RETRIES})..."
                )
            else:
                wait = _TRANSIENT_ERROR_BACKOFF_SECONDS
                print(
                    f"  Transient network error ({exc!r}), waiting {wait}s "
                    f"before retry ({attempt + 1}/{_MAX_RETRIES})..."
                )
            await asyncio.sleep(wait)
    raise RuntimeError("unreachable")


async def _collect_results() -> dict[str, list]:
    tenant_id = str(uuid.uuid4())
    headers = {"X-Tenant-ID": tenant_id}

    rows: dict[str, list] = {
        "question": [],
        "answer": [],
        "contexts": [],
        "ground_truth": [],
    }

    async with LifespanManager(app) as manager:
        transport = ASGITransport(app=manager.app)
        async with AsyncClient(
            transport=transport,
            base_url="http://test",
        ) as client:
            for doc in GOLDEN_CORPUS:
                await _post_with_backoff(client, "/ingest", json=doc, headers=headers)

            for item in GOLDEN_QUESTIONS:
                response = await _post_with_backoff(
                    client,
                    "/query",
                    json={"question": item["question"], "top_k": _EVAL_TOP_K},
                    headers=headers,
                )
                body = response.json()

                print(f"\nQ: {item['question']}")
                for c in body["retrieved_context"]:
                    print(f"  retrieved: {c['text'][:100]!r}")

                rows["question"].append(item["question"])
                rows["answer"].append(body["answer"])
                rows["contexts"].append(
                    [c["text"] for c in body["retrieved_context"]] or [""]
                )
                rows["ground_truth"].append(item["ground_truth"])

    return rows


def main() -> None:
    if not settings.voyage_api_key or not settings.gemini_api_key:
        print("RAGAS gate skipped: VOYAGE_API_KEY and GEMINI_API_KEY not both set.")
        return

    rows = asyncio.run(_collect_results())
    dataset = Dataset.from_dict(rows)

    judge = LangchainLLMWrapper(
        ChatGoogleGenerativeAI(
            model="gemini-3.5-flash-lite",
            google_api_key=settings.gemini_api_key,
        )
    )
    ragas_embeddings = LangchainEmbeddingsWrapper(
        GoogleGenerativeAIEmbeddings(
            model="models/gemini-embedding-001",
            google_api_key=settings.gemini_api_key,
        )
    )

    metrics = [
        faithfulness,
        AnswerRelevancy(strictness=1),
        context_precision,
    ]

    run_config = RunConfig(
        max_workers=1,
        timeout=180,
        max_retries=5,
        max_wait=60,
    )

    result = evaluate(
        dataset,
        metrics=metrics,
        llm=judge,
        embeddings=ragas_embeddings,
        run_config=run_config,
    )

    df = result.to_pandas()

    print("Per-question breakdown:")
    question_col = "user_input" if "user_input" in df.columns else "question"
    print(
        df[
            [question_col, "faithfulness", "answer_relevancy", "context_precision"]
        ].to_string(index=False, float_format=lambda x: f"{x:.4f}")
    )
    print()

    scores = df.mean(numeric_only=True)

    print("RAGAS results:")

    failed = []

    for metric, floor in THRESHOLDS.items():
        # Binary floating-point can't represent 0.80 exactly, so a true
        # average of e.g. 4/5 comes back as 0.7999999999999999 — prints
        # as "0.8000" but fails a strict >= comparison against the
        # floor. Rounding before comparing (not before printing) fixes
        # the false negative without hiding genuine below-floor scores.
        raw_score = scores.get(metric)
        score = None if raw_score is None else round(raw_score, 4)
        ok = score is not None and score >= floor
        score_text = "N/A" if score is None else f"{score:.4f}"
        print(
            f"  {metric}: {score_text} (floor {floor:.2f}) [{'PASS' if ok else 'FAIL'}]"
        )
        if not ok:
            failed.append(metric)

    if failed:
        print(f"\nRAGAS gate failed: {', '.join(failed)} below floor")
        sys.exit(1)

    print("\nRAGAS gate passed.")


if __name__ == "__main__":
    main()

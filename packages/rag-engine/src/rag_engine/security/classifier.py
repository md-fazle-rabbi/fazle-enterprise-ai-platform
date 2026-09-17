"""
Classifier-based injection detection, Meta's Prompt Guard 2 (86M,
mDeBERTa), catches paraphrased attacks pattern matching misses.

Gated model: accept the license at huggingface.co/meta-llama first, or
the download 403s. HF_TOKEN is passed explicitly to pipeline() below
rather than relying on transformers picking it up implicitly from the
environment — makes the auth path visible here instead of assumed.
A missing/unaccepted token still surfaces as the same 401/403 from HF,
just now unambiguously from an explicit argument, not an implicit env
lookup.

Verify this exact repo id before relying on it, Meta's naming has
shifted across Prompt Guard generations. Also verify the label names
the pipeline actually returns on first run, "INJECTION"/"BENIGN" below
is the expected convention, not independently confirmed here.
"""

import asyncio
import os
from functools import lru_cache
from typing import Any

MODEL_ID = "meta-llama/Llama-Prompt-Guard-2-86M"


@lru_cache(maxsize=1)
def _get_pipeline() -> Any:
    from transformers import pipeline

    return pipeline(
        "text-classification",
        model=MODEL_ID,
        token=os.environ.get("HF_TOKEN"),
    )


async def classifier_score(text: str) -> float:
    """
    Probability, 0 to 1, that text is a jailbreak or injection attempt.

    Runs the (synchronous, CPU-bound) HF pipeline in a thread pool
    executor instead of calling it directly on the event loop. Direct
    calls block every other coroutine in the process for the duration
    of inference — including unrelated requests like /health — since
    this app runs a single uvicorn worker with no GPU. Under concurrent
    load that showed up as /health stalling to 3.6s and /query queuing
    up to 50-78s per request behind the backlog.
    """
    loop = asyncio.get_running_loop()
    result = await loop.run_in_executor(
        None, lambda: _get_pipeline()(text, truncation=True)[0]
    )
    score = float(result["score"])
    return score if result["label"] == "INJECTION" else 1 - score

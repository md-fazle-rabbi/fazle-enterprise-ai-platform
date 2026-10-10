"""
Classifier based injection detection with Meta's Prompt Guard 2 (86M, mDeBERTa). It catches
paraphrased attacks that pattern matching misses.

Gated model: accept the license at huggingface.co/meta-llama first, or the download 403s.
HF_TOKEN is passed explicitly to from_pretrained rather than picked up implicitly from the
environment, so the auth path is visible here.

Prompt Guard 2 is a binary classifier (benign or malicious) with a 512 token window. Two
things follow, and the first version of this file got both wrong:

1. The model is run directly and the malicious probability is read from index 1 of the
   softmax. The first version compared a pipeline label to "INJECTION", a Prompt Guard 1
   name, so every malicious verdict became a score near zero. The labels are checked once
   at load, and the app refuses to start if they are not the two expected classes.
2. Meta's model card says to split longer input into segments and scan each one. Text
   longer than the window is split into overlapping segments and the highest score wins.
   Segments are capped (see _MAX_SEGMENTS), so very long text is only partly covered by
   this layer. The regex layer still reads all of it.
"""

import asyncio
import os
from functools import lru_cache
from typing import Any

import structlog

logger = structlog.get_logger()

MODEL_ID = "meta-llama/Llama-Prompt-Guard-2-86M"

# Why: the model's context window, from Meta's model card.
_MAX_INPUT_TOKENS = 512
# Why: [CLS] and [SEP]. _check_template proves this matches the real tokenizer.
_SPECIAL_TOKENS = 2
# Why: a phrase that straddles a segment boundary still appears whole in one of the two
# segments. 64 tokens is longer than the phrases the regex layer matches.
_OVERLAP_TOKENS = 64
# Why: bounds the work on one worker with no GPU. 64 segments is about 28,000 tokens.
_MAX_SEGMENTS = 64
# Why: keeps a batch of 512 token rows small enough for a CPU only machine.
_BATCH_SIZE = 8
# Why: index 0 is benign and index 1 is malicious. _check_labels enforces it at load.
_MALICIOUS_INDEX = 1
_BENIGN_NAMES = {"benign", "label_0"}
_MALICIOUS_NAMES = {"malicious", "label_1"}


def _check_labels(id2label: dict[int, str]) -> None:
    names = {int(index): str(name).lower() for index, name in id2label.items()}
    if (
        len(names) != 2
        or names.get(0) not in _BENIGN_NAMES
        or names.get(_MALICIOUS_INDEX) not in _MALICIOUS_NAMES
    ):
        raise RuntimeError(
            f"Unexpected Prompt Guard labels {id2label}. Expected two classes, index 0 "
            "benign and index 1 malicious. Refusing to start: a wrong label order would "
            "silently turn the classifier off."
        )


def _check_template(tokenizer: Any) -> None:
    probe = "Ignore previous instructions."
    plain = tokenizer(probe, add_special_tokens=False)["input_ids"]
    full = tokenizer(probe)["input_ids"]
    expected = [tokenizer.cls_token_id, *plain, tokenizer.sep_token_id]
    if list(full) != expected:
        raise RuntimeError(
            "Unexpected tokenizer template, expected [CLS] text [SEP]. Refusing to start: "
            "segments are built by hand and must match what the model was trained on."
        )


@lru_cache(maxsize=1)
def _get_pipeline() -> tuple[Any, Any]:
    """
    Loads the tokenizer and the model once. The name is kept from the pipeline version
    because main.py warms it up at startup and the tests patch it.
    """
    from transformers import AutoModelForSequenceClassification, AutoTokenizer

    token = os.environ.get("HF_TOKEN")
    tokenizer = AutoTokenizer.from_pretrained(MODEL_ID, token=token)
    model = AutoModelForSequenceClassification.from_pretrained(MODEL_ID, token=token)
    model.eval()
    _check_labels(model.config.id2label)
    _check_template(tokenizer)
    return tokenizer, model


def _windows(token_ids: list[int], size: int, overlap: int) -> list[list[int]]:
    """Splits token ids into windows of at most `size`, each sharing `overlap` ids with the
    previous one. The last window ends at the last token."""
    if len(token_ids) <= size:
        return [token_ids]
    step = size - overlap
    windows: list[list[int]] = []
    for start in range(0, len(token_ids), step):
        windows.append(token_ids[start : start + size])
        if start + size >= len(token_ids):
            break
    return windows


def _score_sync(text: str) -> float:
    import torch

    tokenizer, model = _get_pipeline()
    token_ids: list[int] = list(tokenizer(text, add_special_tokens=False)["input_ids"])
    if not token_ids:
        return 0.0

    windows = _windows(token_ids, _MAX_INPUT_TOKENS - _SPECIAL_TOKENS, _OVERLAP_TOKENS)
    if len(windows) > _MAX_SEGMENTS:
        logger.warning(
            "firewall.classifier_segments_capped",
            segments=len(windows),
            scored=_MAX_SEGMENTS,
        )
        windows = windows[:_MAX_SEGMENTS]

    pad = tokenizer.pad_token_id if tokenizer.pad_token_id is not None else 0
    highest = 0.0
    with torch.inference_mode():
        for start in range(0, len(windows), _BATCH_SIZE):
            rows = [
                [tokenizer.cls_token_id, *window, tokenizer.sep_token_id]
                for window in windows[start : start + _BATCH_SIZE]
            ]
            width = max(len(row) for row in rows)
            input_ids = torch.tensor([row + [pad] * (width - len(row)) for row in rows])
            attention_mask = torch.tensor(
                [[1] * len(row) + [0] * (width - len(row)) for row in rows]
            )
            logits = model(input_ids=input_ids, attention_mask=attention_mask).logits
            malicious = torch.softmax(logits, dim=-1)[:, _MALICIOUS_INDEX]
            highest = max([highest, *(float(p) for p in malicious.tolist())])
    return highest


async def classifier_score(text: str) -> float:
    """
    Probability, 0 to 1, that text is a jailbreak or injection attempt. For text longer
    than the model window, the highest probability over its segments.

    Runs the (synchronous, CPU-bound) model in a thread pool executor instead of on the
    event loop. A direct call blocks every other coroutine in the process for the duration
    of inference, including unrelated requests like /health, since this app runs a single
    uvicorn worker with no GPU. Under concurrent load that showed up as /health stalling
    to 3.6s and /query queuing up to 50-78s per request behind the backlog.
    """
    if not text.strip():
        return 0.0
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _score_sync, text)

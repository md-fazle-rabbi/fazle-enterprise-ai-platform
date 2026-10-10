"""
Tests for the injection classifier's segment scoring, label check and segment cap. They use
a small fake tokenizer and a fake model, so no Hugging Face download or token is needed. The
fake model flags any row that contains the marker token, which stands in for an injection.
"""

from itertools import pairwise
from types import SimpleNamespace

import pytest
import torch
from rag_engine.security import classifier

BENIGN_ID = 5
MARKER_ID = 9


class _FakeTokenizer:
    cls_token_id = 1
    sep_token_id = 2
    pad_token_id = 0

    def __call__(self, text: str, add_special_tokens: bool = True):
        ids = [MARKER_ID if word == "INJECT" else BENIGN_ID for word in text.split()]
        if add_special_tokens:
            ids = [self.cls_token_id, *ids, self.sep_token_id]
        return {"input_ids": ids}


class _NoSpecialTokensTokenizer(_FakeTokenizer):
    def __call__(self, text: str, add_special_tokens: bool = True):
        return super().__call__(text, add_special_tokens=False)


class _FakeModel:
    def __init__(self) -> None:
        self.rows_seen = 0
        self.longest_row = 0

    def __call__(self, input_ids, attention_mask):
        self.rows_seen += input_ids.shape[0]
        self.longest_row = max(self.longest_row, input_ids.shape[1])
        flagged = (input_ids == MARKER_ID).any(dim=1, keepdim=True)
        malicious = torch.tensor([[-5.0, 5.0]])
        benign = torch.tensor([[5.0, -5.0]])
        return SimpleNamespace(logits=torch.where(flagged, malicious, benign))


@pytest.fixture
def fake_model(monkeypatch):
    model = _FakeModel()
    monkeypatch.setattr(classifier, "_get_pipeline", lambda: (_FakeTokenizer(), model))
    return model


def _text(benign_words: int, injected_words: int = 0) -> str:
    return " ".join(["ok"] * benign_words + ["INJECT"] * injected_words)


def test_windows_short_input_is_one_window():
    assert classifier._windows([1, 2, 3], size=10, overlap=2) == [[1, 2, 3]]


def test_windows_cover_every_token_with_the_requested_overlap():
    ids = list(range(1000))
    windows = classifier._windows(ids, size=100, overlap=20)
    assert all(len(window) <= 100 for window in windows)
    assert windows[0][0] == 0
    assert windows[-1][-1] == 999
    for before, after in pairwise(windows):
        assert before[-20:] == after[:20]
    assert {token for window in windows for token in window} == set(ids)


@pytest.mark.asyncio
async def test_short_injection_scores_high_in_one_row(fake_model):
    score = await classifier.classifier_score(_text(10, 3))
    assert score > 0.99
    assert fake_model.rows_seen == 1


@pytest.mark.asyncio
async def test_injection_after_the_first_512_tokens_is_found(fake_model):
    score = await classifier.classifier_score(_text(1200, 8))
    assert score > 0.99
    assert fake_model.rows_seen > 1
    assert fake_model.longest_row <= 512


@pytest.mark.asyncio
async def test_long_benign_text_scores_low(fake_model):
    assert await classifier.classifier_score(_text(1200)) < 0.01


@pytest.mark.asyncio
async def test_empty_text_scores_zero_without_calling_the_model(fake_model):
    assert await classifier.classifier_score("   ") == 0.0
    assert fake_model.rows_seen == 0


@pytest.mark.asyncio
async def test_text_past_the_segment_cap_is_not_scored(fake_model):
    # Why: this pins the known limit. Only the first _MAX_SEGMENTS segments are scored, so
    # an injection after them is left to the regex layer. The README says the same.
    step = classifier._MAX_INPUT_TOKENS - classifier._SPECIAL_TOKENS
    step -= classifier._OVERLAP_TOKENS
    words = step * (classifier._MAX_SEGMENTS + 20)
    score = await classifier.classifier_score(_text(words, 8))
    assert fake_model.rows_seen == classifier._MAX_SEGMENTS
    assert score < 0.5


def test_label_check_accepts_the_prompt_guard_2_layouts():
    classifier._check_labels({0: "LABEL_0", 1: "LABEL_1"})
    classifier._check_labels({0: "BENIGN", 1: "MALICIOUS"})


def test_label_check_refuses_the_prompt_guard_1_layout():
    with pytest.raises(RuntimeError):
        classifier._check_labels({0: "BENIGN", 1: "INJECTION", 2: "JAILBREAK"})


def test_label_check_refuses_swapped_labels():
    with pytest.raises(RuntimeError):
        classifier._check_labels({0: "MALICIOUS", 1: "BENIGN"})


def test_template_check_accepts_cls_text_sep():
    classifier._check_template(_FakeTokenizer())


def test_template_check_refuses_a_tokenizer_that_adds_no_special_tokens():
    with pytest.raises(RuntimeError):
        classifier._check_template(_NoSpecialTokensTokenizer())

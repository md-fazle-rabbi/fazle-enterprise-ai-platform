import uuid

import pytest

from rag_engine.search import RRF_K, _reciprocal_rank_fusion


def test_rrf_favors_items_ranked_high_in_both_lists():
    a, b, c = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    dense = [(a, 1), (b, 2), (c, 3)]
    sparse = [(c, 1), (a, 2), (b, 3)]
    fused = _reciprocal_rank_fusion(dense, sparse)
    assert fused[0][0] == a  # rank 1 dense + rank 2 sparse beats the alternatives


def test_rrf_includes_items_present_in_only_one_list():
    a, b = uuid.uuid4(), uuid.uuid4()
    fused = _reciprocal_rank_fusion([(a, 1)], [(b, 1)])
    assert {chunk_id for chunk_id, _ in fused} == {a, b}


def test_rrf_score_matches_formula_at_default_k():
    a = uuid.uuid4()
    fused = _reciprocal_rank_fusion([(a, 1)])
    assert fused[0][1] == pytest.approx(1 / (RRF_K + 1))


def test_rrf_empty_lists_return_empty():
    assert _reciprocal_rank_fusion([], []) == []

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


def test_rrf_tie_goes_to_the_better_rank_in_the_last_list():
    # Why: a is dense 1 and sparse 2, b is dense 2 and sparse 1. Same fused
    # score, so the winner must come from the rule, not from which one the
    # loop saw first. The last list (sparse in hybrid_search) decides.
    a, b = uuid.uuid4(), uuid.uuid4()
    fused = _reciprocal_rank_fusion([(a, 1), (b, 2)], [(b, 1), (a, 2)])
    assert fused[0][1] == pytest.approx(fused[1][1])
    assert [chunk_id for chunk_id, _ in fused] == [b, a]


def test_rrf_tie_order_does_not_depend_on_input_order():
    a, b = uuid.uuid4(), uuid.uuid4()
    fused = _reciprocal_rank_fusion([(b, 2), (a, 1)], [(a, 2), (b, 1)])
    assert [chunk_id for chunk_id, _ in fused] == [b, a]


def test_rrf_tie_between_single_list_items_prefers_the_last_list():
    a, b = uuid.uuid4(), uuid.uuid4()
    fused = _reciprocal_rank_fusion([(a, 1)], [(b, 1)])
    assert [chunk_id for chunk_id, _ in fused] == [b, a]


def test_rrf_a_real_score_gap_beats_the_tie_rule():
    # Why: the tie rule must never override evidence. a is in both lists, b
    # only wins the last list, so a stays first.
    a, b = uuid.uuid4(), uuid.uuid4()
    fused = _reciprocal_rank_fusion([(a, 2)], [(b, 1), (a, 2)])
    assert fused[0][0] == a

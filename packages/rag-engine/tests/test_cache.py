from rag_engine.cache import cosine_similarity


def test_identical_vectors_similarity_is_one():
    v = [1.0, 2.0, 3.0]
    assert cosine_similarity(v, v) == 1.0


def test_orthogonal_vectors_similarity_is_zero():
    assert cosine_similarity([1.0, 0.0], [0.0, 1.0]) == 0.0


def test_zero_vector_does_not_divide_by_zero():
    assert cosine_similarity([0.0, 0.0], [1.0, 1.0]) == 0.0

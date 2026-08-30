from rag_engine.routers.query import _flag_reasons


def test_flags_no_citations_when_context_existed():
    _, reasons = _flag_reasons(
        "A generic answer with no [n] tags.", cited_count=0, total_count=3
    )
    assert "no_citations" in reasons


def test_flags_low_grounding_under_half_cited():
    _, reasons = _flag_reasons("Answer citing [1].", cited_count=1, total_count=3)
    assert "low_grounding" in reasons


def test_no_flags_when_fully_grounded():
    _, reasons = _flag_reasons(
        "Answer citing [1] and [2].", cited_count=2, total_count=2
    )
    assert reasons == []


def test_flags_and_redacts_output_pii():
    answer, reasons = _flag_reasons(
        "Contact fazle@example.com for more.", cited_count=1, total_count=1
    )
    assert "output_pii" in reasons
    assert "fazle@example.com" not in answer

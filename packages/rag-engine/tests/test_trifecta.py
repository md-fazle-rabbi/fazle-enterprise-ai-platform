from rag_engine.security.trifecta import assess_trifecta


def test_all_three_conditions_triggers():
    result = assess_trifecta(
        "See https://attacker.example/?d=leaked",
        has_citations=True,
        max_classifier_score_on_context=0.7,
    )
    assert result.conditions_met == 3
    assert result.triggered is True


def test_only_one_condition_does_not_trigger():
    result = assess_trifecta(
        "A clean answer, no links.",
        has_citations=True,
        max_classifier_score_on_context=0.0,
    )
    assert result.conditions_met == 1
    assert result.triggered is False


def test_two_conditions_triggers():
    # NOTE: score raised from 0.5 to 0.6 (FLAG_THRESHOLD). At 0.5 this
    # would only hit 1 condition (exfiltration_channel) under the
    # threshold-aligned trifecta.py, since 0.5 < FLAG_THRESHOLD no
    # longer counts as untrusted_content_exposure -- see ADR 007.
    result = assess_trifecta(
        "See https://example.com for more.",
        has_citations=False,
        max_classifier_score_on_context=0.6,
    )
    assert result.conditions_met == 2
    assert result.triggered is True

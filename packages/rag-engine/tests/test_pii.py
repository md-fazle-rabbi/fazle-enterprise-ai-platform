from rag_engine.pii import redact_pii


def test_redacts_email():
    redacted, entities = redact_pii("Contact me at fazle@example.com for details.")
    assert "fazle@example.com" not in redacted
    assert "EMAIL_ADDRESS" in entities


def test_redacts_person_name():
    redacted, entities = redact_pii("My name is John Smith and I need help.")
    assert "John Smith" not in redacted
    assert "PERSON" in entities


def test_leaves_clean_technical_text_unchanged():
    text = "The RAG pipeline uses hybrid search with RRF fusion."
    redacted, entities = redact_pii(text)
    assert redacted == text
    assert entities == []


def test_multiple_entity_types_in_one_pass():
    # NOT 123-45-6789: Presidio's UsSsnRecognizer hardcodes that exact
    # number (and two others) as a known placeholder/sample SSN and
    # will never flag it, regardless of context. Any other 3-2-4 digit
    # string works fine.
    redacted, entities = redact_pii("Jane Doe's SSN is 234-56-7890.")
    assert "Jane Doe" not in redacted
    assert "234-56-7890" not in redacted
    assert {"PERSON", "US_SSN"}.issubset(set(entities))


def test_keeps_bare_relative_duration():
    text = "Customers can request a full refund within 30 days of purchase."
    redacted, entities = redact_pii(text)
    assert redacted == text
    assert entities == []


def test_keeps_hedged_relative_duration():
    # Regression test: this exact phrasing was produced by generation and
    # confirmed (via a live query) to be over-redacted to "<DATE_TIME>"
    # before this fix -- Presidio's DateRecognizer includes the "up to"
    # hedge word in the matched span, and the original anchored pattern
    # required the span to start with a digit, so it never matched.
    text = "Customers have up to 30 days from the date of purchase to request a full refund."
    redacted, entities = redact_pii(text)
    assert redacted == text
    assert entities == []


def test_keeps_other_common_hedge_phrasings():
    for phrase in [
        "Refunds must be requested at least 30 days before the renewal date.",
        "Support tickets are typically resolved within about 2 hours.",
        "The trial period lasts roughly 14 days.",
    ]:
        redacted, entities = redact_pii(phrase)
        assert redacted == phrase, f"unexpectedly redacted: {phrase!r} -> {redacted!r}"
        assert entities == []


def test_still_catches_absolute_date():
    text = "Patient intake form signed on March 15, 2024."
    redacted, entities = redact_pii(text)
    assert "<DATE_TIME>" in redacted
    assert entities == ["DATE_TIME"]


def test_still_catches_absolute_date_next_to_a_duration_phrase():
    # Guards against the broadened hedge-word pattern over-excluding: a
    # genuine date sitting in the same sentence as duration-shaped text
    # must still be redacted. Presidio scores these as two separate
    # spans (confirmed empirically), so each is filtered independently.
    text = "Appointment on March 15, 2024, lasting about 2 hours."
    redacted, _entities = redact_pii(text)
    assert "<DATE_TIME>" in redacted
    assert "March 15, 2024" not in redacted
    assert "about 2 hours" in redacted  # the duration itself stays untouched

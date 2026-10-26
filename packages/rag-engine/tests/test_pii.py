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


def test_redacts_a_phone_number_with_no_area_code_after_a_phone_word():
    # Regression test: found by the red-team toolkit's first run against this repo.
    # Presidio's stock PhoneRecognizer only accepts numbers libphonenumber calls
    # valid, and "+1-555-0100" (a country code plus 7 digits) is not one, so it was
    # stored and returned unredacted while the name and email beside it were
    # redacted. The cue pattern in pii.py catches it when a phone word comes first.
    text = "Support contact: Jane Doe, jane.doe@example.com, phone +1-555-0100."
    redacted, entities = redact_pii(text)
    assert "555-0100" not in redacted
    assert "PHONE_NUMBER" in entities


def test_redacts_phone_numbers_after_each_cue_word():
    for phrase in [
        "Call +1-555-0100.",
        "phone 555-0100",
        "Phone number: 555 0100",
        "Dial 555 0100 now.",
        "tel: +1-202-555-0173",
    ]:
        redacted, entities = redact_pii(phrase)
        assert "PHONE_NUMBER" in entities, f"not redacted: {phrase!r}"
        assert not any(c.isdigit() for c in redacted), f"digits left: {redacted!r}"


def test_phone_cue_leaves_ordinary_numbers_alone():
    # Guards against the cue pattern over-reaching: a phone word with no digits right
    # after it, and digit runs with no phone word before them, are not phone numbers.
    for phrase in [
        "Invoice 2024-1234 is overdue.",
        "Upgrade to version 3.2.1 now.",
        "Call volume rose 15 percent last quarter.",
        "Order 123-4567 shipped.",
    ]:
        _redacted, entities = redact_pii(phrase)
        assert "PHONE_NUMBER" not in entities, f"over-redacted: {phrase!r}"

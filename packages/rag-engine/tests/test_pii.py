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

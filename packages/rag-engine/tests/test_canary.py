from rag_engine.security.canary import register_canary, scan_for_canary_leak


def test_registered_canary_detected_in_output():
    token = register_canary()
    leaked = scan_for_canary_leak(f"Here's the internal doc: {token}")
    assert token in leaked


def test_unregistered_uuid_not_flagged():
    leaked = scan_for_canary_leak(
        "Some random uuid 12345678-1234-1234-1234-123456789012 appears here"
    )
    assert leaked == []


def test_clean_text_returns_nothing():
    assert scan_for_canary_leak("The RAG pipeline uses hybrid search.") == []

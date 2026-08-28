from rag_engine.chunking import chunk_markdown, count_tokens


def test_empty_input_returns_no_chunks():
    assert chunk_markdown("") == []
    assert chunk_markdown("   \n\n  ") == []


def test_no_headings_still_chunks():
    text = "Just a paragraph with no heading at all."
    chunks = chunk_markdown(text)
    assert len(chunks) == 1
    assert chunks[0].heading_path == []
    assert chunks[0].text == text


def test_heading_path_tracks_nesting():
    text = (
        "# Architecture\n\nTop level paragraph.\n\n"
        "## Data flow\n\nNested paragraph.\n\n"
        "# Deployment\n\nSibling section paragraph.\n"
    )
    paths = [c.heading_path for c in chunk_markdown(text)]
    assert ["Architecture"] in paths
    assert ["Architecture", "Data flow"] in paths
    assert ["Deployment"] in paths


def test_no_chunk_exceeds_token_budget():
    text = "\n\n".join(f"Paragraph number {i}, some content here." for i in range(50))
    chunks = chunk_markdown(text, max_tokens=30)
    assert all(c.token_count <= 30 for c in chunks)


def test_oversized_single_paragraph_gets_split():
    huge_paragraph = " ".join(["word"] * 2000)
    chunks = chunk_markdown(huge_paragraph, max_tokens=100)
    assert len(chunks) > 1
    assert all(c.token_count <= 100 for c in chunks)


def test_chunking_is_idempotent():
    text = (
        "# Title\n\nFirst paragraph.\n\n"
        "## Sub\n\nSecond paragraph with more words in it to pad length.\n"
    )
    first = chunk_markdown(text, max_tokens=20)
    second = chunk_markdown(text, max_tokens=20)
    assert [c.text for c in first] == [c.text for c in second]
    assert [c.heading_path for c in first] == [c.heading_path for c in second]


def test_boundary_paragraph_exactly_at_budget():
    paragraph = "word " * 10
    tokens = count_tokens(paragraph.strip())
    chunks = chunk_markdown(paragraph.strip(), max_tokens=tokens)
    assert len(chunks) == 1
    assert chunks[0].token_count == tokens


def test_chunk_index_increments_across_sections():
    text = "# A\n\npara one\n\n# B\n\npara two\n"
    indices = [c.chunk_index for c in chunk_markdown(text, max_tokens=5)]
    assert indices == list(range(len(indices)))

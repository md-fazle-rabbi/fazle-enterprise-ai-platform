from rag_engine.graph_stub import ExtractionResult


def test_extraction_result_parses_valid_shape():
    raw = {
        "entities": [{"name": "Fazle", "type": "PERSON"}],
        "relationships": [
            {"source": "Fazle", "target": "rag-engine", "relation": "builds"}
        ],
    }
    result = ExtractionResult.model_validate(raw)
    assert result.entities[0].name == "Fazle"
    assert result.relationships[0].relation == "builds"


def test_extraction_result_accepts_empty_lists():
    result = ExtractionResult.model_validate({"entities": [], "relationships": []})
    assert result.entities == []

from unittest.mock import AsyncMock, patch

import pytest
from rag_engine.vision import extract_image_content


@pytest.mark.asyncio
async def test_falls_back_to_ocr_when_vision_fails():
    with (
        patch("rag_engine.vision._vision_extract", new=AsyncMock(return_value=None)),
        patch("rag_engine.vision._ocr_extract", return_value="OCR extracted text"),
    ):
        text, modality = await extract_image_content(b"fake-bytes")
    assert text == "OCR extracted text"
    assert modality == "ocr_fallback"


@pytest.mark.asyncio
async def test_uses_vision_result_when_available():
    with patch(
        "rag_engine.vision._vision_extract",
        new=AsyncMock(return_value="Vision description"),
    ):
        text, modality = await extract_image_content(b"fake-bytes")
    assert text == "Vision description"
    assert modality == "image"


@pytest.mark.asyncio
async def test_raises_when_both_paths_produce_nothing():
    with (
        patch("rag_engine.vision._vision_extract", new=AsyncMock(return_value=None)),
        patch("rag_engine.vision._ocr_extract", return_value=""),
        pytest.raises(ValueError, match="no content"),
    ):
        await extract_image_content(b"fake-bytes")

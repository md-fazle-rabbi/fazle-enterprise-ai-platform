"""
Shared Gemini client. One client construction, one place to change if the
API key or client config needs to change, not repeated per module.
"""

import httpx
from google import genai
from google.genai import types

from core.settings import settings

_httpx_async_client = httpx.AsyncClient()

client = genai.Client(
    api_key=settings.gemini_api_key,
    http_options=types.HttpOptions(
        httpx_async_client=_httpx_async_client,
    ),
)

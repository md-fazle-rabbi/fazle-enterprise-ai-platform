"""
Shared Gemini client. One client construction, one place to change if the
API key or client config needs to change, not repeated per module.

Lazily constructed on first use, not at import time — importing this
module (or anything that transitively imports it, like FastAPI route
modules) must not require a live API key. Tests that never call Gemini
can import the app freely; only code paths that actually call the model
pay the cost of client construction, and only then does a missing key
surface as an error.
"""

from functools import lru_cache

import httpx
from google import genai
from google.genai import types

from core.settings import settings


@lru_cache(maxsize=1)
def get_client() -> genai.Client:
    httpx_async_client = httpx.AsyncClient()
    return genai.Client(
        api_key=settings.gemini_api_key,
        http_options=types.HttpOptions(
            httpx_async_client=httpx_async_client,
        ),
    )

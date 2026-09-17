"""
Shared Gemini client. One client construction per running event loop, not
repeated per module -- and in the common case (one long-running event
loop, e.g. a single Uvicorn worker) that's exactly one client for the
whole process, same as before.

Cached per event loop rather than globally with a single @lru_cache,
because the client wraps an httpx.AsyncClient whose connections are bound
to whichever event loop was running when it was built. A process that
only ever runs one event loop never notices the difference. But anything
that spins up more than one loop over its lifetime -- pytest-asyncio's
function-scoped loops, a background-job runner recycling loops, multiple
worker threads each calling asyncio.run() -- would otherwise get handed
back a client still holding connections tied to an event loop that has
since closed, surfacing as an intermittent "RuntimeError: Event loop is
closed" whose timing depends on httpx's connection-pool state rather than
anything about the call that triggered it.

A WeakKeyDictionary keyed by the running loop gives each loop its own
client and lets entries for closed/garbage-collected loops clean
themselves up automatically, rather than accumulating for the life of
the process.

Lazily constructed on first use per loop, not at import time -- importing
this module (or anything that transitively imports it, like FastAPI route
modules) must not require a live API key. Tests that never call Gemini
can import the app freely; only code paths that actually call the model
pay the cost of client construction, and only then does a missing key
surface as an error.
"""

import asyncio
import weakref

import httpx
from google import genai
from google.genai import types

from core.settings import settings

_clients: "weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, genai.Client]" = (
    weakref.WeakKeyDictionary()
)


def get_client() -> genai.Client:
    loop = asyncio.get_running_loop()
    client = _clients.get(loop)
    if client is None:
        httpx_async_client = httpx.AsyncClient()
        client = genai.Client(
            api_key=settings.gemini_api_key,
            http_options=types.HttpOptions(
                httpx_async_client=httpx_async_client,
            ),
        )
        _clients[loop] = client
    return client

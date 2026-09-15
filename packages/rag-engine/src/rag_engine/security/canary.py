"""
Canary tokens: unique UUIDs that have no legitimate reason to appear in
any generated output. Presence anywhere in a response is treated as
unconditional exfiltration evidence, not a probabilistic signal.
"""

import re
import uuid

_CANARY_REGISTRY: set[str] = set()
_UUID_RE = re.compile(
    r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.IGNORECASE
)


def register_canary() -> str:
    token = str(uuid.uuid4())
    _CANARY_REGISTRY.add(token)
    return token


def scan_for_canary_leak(text: str) -> list[str]:
    found = {m.group(0).lower() for m in _UUID_RE.finditer(text)}
    return sorted(found & _CANARY_REGISTRY)

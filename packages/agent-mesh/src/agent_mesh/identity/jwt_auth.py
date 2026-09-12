"""
Validates agent JWTs from Keycloak. RS256-only, explicitly, not just a
library default: the classic alg:none and algorithm-confusion attacks
work precisely because a verifier trusts whatever alg the token itself
claims. Pinning algorithms=["RS256"] at jwt.decode() is the actual
enforcement point, the header pre-check below is defense-in-depth for a
clearer error, not the real fix by itself.
"""

from typing import Any

import jwt
from core.settings import settings
from jwt import PyJWKClient

_jwks_client = PyJWKClient(
    f"{settings.keycloak_url}/realms/agent-mesh/protocol/openid-connect/certs"
)


def verify_agent_token(token: str) -> dict[str, Any]:
    header = jwt.get_unverified_header(token)
    if header.get("alg") != "RS256":
        raise ValueError(
            f"Rejected token: alg={header.get('alg')!r}, only RS256 is accepted"
        )

    signing_key = _jwks_client.get_signing_key_from_jwt(token)
    return jwt.decode(
        token,
        signing_key.key,
        algorithms=["RS256"],
        audience="agent-mesh",
        options={"require": ["exp", "iat"]},
    )

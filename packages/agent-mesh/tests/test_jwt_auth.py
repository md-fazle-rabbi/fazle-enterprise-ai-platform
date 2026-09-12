import jwt
import pytest
from agent_mesh.identity.jwt_auth import verify_agent_token


def test_rejects_alg_none() -> None:
    forged = jwt.encode({"sub": "attacker"}, key="", algorithm="none")
    with pytest.raises(ValueError, match="only RS256"):
        verify_agent_token(forged)


def test_rejects_hs256() -> None:
    forged = jwt.encode(
        {"sub": "attacker"},
        key="guessed-secret-that-is-at-least-32-bytes-long",
        algorithm="HS256",
    )
    with pytest.raises(ValueError, match="only RS256"):
        verify_agent_token(forged)

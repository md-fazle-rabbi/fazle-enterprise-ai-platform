from agent_mesh.messaging.envelope import (
    MessageEnvelope,
    sign_envelope,
    verify_envelope,
)
from agent_mesh.messaging.keys import generate_keypair


def test_valid_signature_verifies():
    priv, pub = generate_keypair()
    env = sign_envelope(
        MessageEnvelope(sender="a", recipient="b", type="q", payload={"q": "test"}),
        priv,
    )
    assert verify_envelope(env, pub) is True


def test_tampered_payload_fails_verification():
    priv, pub = generate_keypair()
    env = sign_envelope(
        MessageEnvelope(sender="a", recipient="b", type="q", payload={"q": "test"}),
        priv,
    )
    tampered = env.model_copy(update={"payload": {"q": "tampered"}})
    assert verify_envelope(tampered, pub) is False


def test_wrong_key_fails_verification():
    priv_a, _ = generate_keypair()
    _, pub_b = generate_keypair()
    env = sign_envelope(
        MessageEnvelope(sender="a", recipient="b", type="q", payload={}), priv_a
    )
    assert verify_envelope(env, pub_b) is False


def test_expired_ttl_detected():
    env = MessageEnvelope(
        sender="a", recipient="b", type="t", payload={}, timestamp=0, ttl=1
    )
    assert env.is_expired() is True

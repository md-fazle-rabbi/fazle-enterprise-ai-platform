"""
Signed message envelope. RS256 (RSA PKCS1v15 + SHA256), matching the
identity layer's algorithm choice, one signing scheme across the mesh.
"""

import base64
import binascii
import json
import time
import uuid

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from pydantic import BaseModel, Field


class MessageEnvelope(BaseModel):
    msg_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    sender: str
    recipient: str
    type: str
    payload: dict
    timestamp: float = Field(default_factory=time.time)
    ttl: int = 300
    signature: str | None = None

    def _signing_payload(self) -> bytes:
        """Every field except signature, sorted keys, so signing and
        verification always serialize identically."""
        data = self.model_dump(exclude={"signature"})
        return json.dumps(data, sort_keys=True, separators=(",", ":")).encode("utf-8")

    def is_expired(self) -> bool:
        return time.time() > self.timestamp + self.ttl


def sign_envelope(
    envelope: MessageEnvelope, private_key: rsa.RSAPrivateKey
) -> MessageEnvelope:
    sig = private_key.sign(
        envelope._signing_payload(), padding.PKCS1v15(), hashes.SHA256()
    )
    return envelope.model_copy(update={"signature": base64.b64encode(sig).decode()})


def verify_envelope(envelope: MessageEnvelope, public_key: rsa.RSAPublicKey) -> bool:
    if envelope.signature is None:
        return False
    try:
        public_key.verify(
            base64.b64decode(envelope.signature),
            envelope._signing_payload(),
            padding.PKCS1v15(),
            hashes.SHA256(),
        )
        return True
    except (InvalidSignature, binascii.Error, ValueError):
        # InvalidSignature: cryptography's own verification failure.
        # binascii.Error / ValueError: malformed base64 in envelope.signature
        # (untrusted input off the wire — must not crash the consumer loop).
        return False

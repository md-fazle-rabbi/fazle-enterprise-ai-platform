"""
Dev-only keypair generation. Real key distribution and rotation is the
Keycloak/OAuth2 identity layer, next step, this just makes signing
testable before that layer exists.
"""

from cryptography.hazmat.primitives.asymmetric import rsa


def generate_keypair() -> tuple[rsa.RSAPrivateKey, rsa.RSAPublicKey]:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return private_key, private_key.public_key()

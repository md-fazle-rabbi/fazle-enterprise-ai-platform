# Inter-Agent Signing Key Rotation

## When
Scheduled: every 90 days. Emergency: suspected key compromise, a departed
team member had key access, or an audit finding requires it.

## Steps

1. **Generate**: new RSA-2048 keypair via `agent_mesh.messaging.keys`,
   written to secure storage outside the repo, never committed.

2. **Update Keycloak**: upload the new public key to the realm's key
   provider config. Keycloak natively supports multiple simultaneously
   active keys via JWKS, this is what makes the grace period possible
   without downtime.

3. **Agents fetch**: no manual push needed, agents already pull the
   current key set from Keycloak's JWKS endpoint on each verification
   (PyJWKClient, from Day 4's jwt_auth.py), cached and re-fetched on an
   unrecognized key id.

4. **Grace period**: minimum 24 hours. New signing uses the new key
   immediately. The old key stays valid for verification only, not new
   signing, so messages already in flight when rotation started still
   verify correctly.

5. **Retire**: after the grace period, remove the old key from Keycloak's
   active JWKS entirely.

6. **Rollback**: if the new key causes mesh-wide verification failures,
   re-activate the old key in Keycloak immediately, it's still available
   if within the grace period, investigate before retrying rotation.
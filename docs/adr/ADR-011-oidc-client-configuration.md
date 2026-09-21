# ADR-011: OIDC client configuration in the web app

Status: Accepted (2026-09-21)

## Context
The web app logs users in through Keycloak (ADR-007). Keycloak has two
addresses: localhost:8080 for the browser and keycloak:8080 for containers.
Tokens carry the public one as issuer (ADR-006 style pinning with KC_HOSTNAME).
Local development has no TLS.

## Decision
1. Use the openid-client library, configured by hand, not by discovery. The
   authorization and logout endpoints use the public address. The token and
   key endpoints use the internal address.
2. The callback URL given to the library is rebuilt from our own redirect URI
   plus the incoming query, never taken from the request host.
3. ID token signature checking is switched on, because without TLS nothing
   else vouches for the token.
4. The library's http block is lifted only when a Keycloak address is http.
5. The scope is "openid". Claims come from the rag-engine-web client scope.
6. The client secret has no default and the app refuses to start without it.

## Options considered
- Discovery: rejected. It returns one set of addresses, which is wrong for
  either the browser or the containers, and it makes startup depend on
  Keycloak being up.
- oauth4webapi directly: rejected. openid-client wraps it and already covers
  the state, nonce and PKCE checks I need.
- Auth.js or a similar framework: rejected. It hides the split address setup
  and the Redis session design behind its own adapters.
- Trusting the TLS channel for the ID token: rejected for local use, see 3.

## Consequences
Positive: the same code works on the host and in Compose with two env values.
The state, nonce, PKCE and signature behaviour is covered by tests against a
simulated Keycloak.
Negative: the endpoint paths are hard coded for Keycloak's URL layout.
Risks and mitigations:
- Tests use a simulated Keycloak, not a real one. Mitigation: the first real
  login in the next step, and an end to end test later.
- The insecure request switch is deprecated by the library on purpose.
  Mitigation: it only runs for http addresses, so it is inert in production.
- The library's default client authentication is client_secret_post. Keycloak
  accepts it for confidential clients. Verified only by the real login.
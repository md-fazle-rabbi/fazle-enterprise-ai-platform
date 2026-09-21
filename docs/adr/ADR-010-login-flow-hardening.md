# ADR-010: Login flow hardening in the web app

Status: Accepted (2026-09-21)

## Context
The web app signs users in through Keycloak (ADR-007) and keeps sessions in
Redis (ADR-009). The browser redirect leg is where login attacks happen:
forged callbacks, replayed codes, session fixation and open redirects.

## Decision
1. Every login starts a transaction: a fresh PKCE code verifier, state and
   nonce, plus the local path to return to. It is stored in Redis under the
   hash of a random id and lives 10 minutes.
2. The random id travels in a short lived httpOnly cookie. The callback finds
   the transaction only through that cookie, so a callback URL sent to a
   different browser has nothing to match (login CSRF).
3. The transaction is read with GETDEL, so a callback URL works once.
4. The return path must be a plain local path. Anything else becomes "/".
5. Cookies are httpOnly, SameSite Lax, path "/" and have no Domain. Over https
   they use the __Host- prefix and Secure. Over http (local) they use plain
   names and no Secure flag, because as far as I know Safari does not keep
   Secure cookies over plain http.
6. The user profile stored in the session comes from validated claims. The
   access token payload is decoded only to fill the UI, and FastAPI verifies
   the signature on every call. A tenant group with a malformed id fails the
   login.

## Options considered
- State, nonce and verifier in an encrypted cookie: rejected. It needs a new
  secret and a crypto library, and it cannot be made single use.
- State only, without a binding cookie: rejected. It does not stop login CSRF.
- SameSite Strict: rejected. The redirect back from Keycloak is a cross site
  navigation, and Strict cookies are not sent on it.
- An allow list of return paths: rejected for now. A shape check is enough
  while the app has few routes, and it can tighten later.

## Consequences
Positive: forged, replayed and cross browser callbacks all find no transaction.
Negative: login needs Redis. A login that is started and abandoned leaves a key
that disappears after 10 minutes.
Risks and mitigations:
- The return path check is a shape check, not an allow list. Mitigation: 15 test
  cases now, and an allow list once the routes settle.
- Cookie flags differ between http and https. Mitigation: tests pin both.
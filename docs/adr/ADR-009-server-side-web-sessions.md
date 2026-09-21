# ADR-009: Server side web sessions in Redis

Status: Accepted (2026-09-21)

## Context
After Keycloak login the web app holds an access token, a refresh token and an
ID token. These must never reach the browser, must be revocable at logout, and
must survive an app restart. Redis already runs in docker-compose.

## Decision
The browser gets one opaque session id in an httpOnly cookie (added in the next
step). The tokens live in Redis under web:session:<sha256 of the id>, with a
fixed lifetime and a zod check on every read. The session id is 32 random
bytes. Updates use SET XX KEEPTTL so a session can neither be revived nor
extended by a token refresh. The store talks to Redis through a four method
interface, and the real client is adapted in one file.

## Options considered
- Encrypted cookie holding the tokens: rejected. By my estimate, not measured,
  the three tokens plus encryption overhead come close to the 4 KB cookie
  limit, and a stolen cookie cannot be revoked before it expires.
- In memory map: rejected. Next.js can load a module once per route bundle and
  again on hot reload, so sessions would vanish or split.
- ioredis: rejected. Its own README recommends node-redis for new projects.
- Storing the raw session id as the Redis key: rejected. Read access to Redis
  would then be enough to hijack sessions.
- Same Redis database as the backend: rejected. Database 1 keeps web sessions
  apart from the backend's data in database 0.

## Consequences
Positive: tokens never leave the server, logout really revokes, a session
survives an app restart.
Negative: the web app now depends on Redis being up. When it is not, login
fails and the page shows the backend as unreachable rather than hanging,
because connect attempts are bounded.
Risks and mitigations:
- Tokens sit unencrypted in Redis, and the compose Redis has no password or
  TLS. Acceptable for a local showcase, listed in Known limitations.
- Session ids are cookie bearer secrets. Mitigation in the next step: httpOnly,
  SameSite Lax, a new id at every login.
- The update path returns false for a missing session, so callers must treat
  that as logged out.
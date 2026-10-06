# ADR-024: Chat rate limits

Status: Accepted (2026-10-06)

## Context
Each chat question can trigger several model calls. Only the backend's per tenant daily
quota limited use, so one signed in user, or a script holding one session cookie, could
exhaust a whole tenant's quota, and several tabs could run answers in parallel.

## Decision
1. A sliding-window log per user: a sorted set of request times, checked and updated in one
   Lua script, using TIME from Redis. Default 20 per 60 seconds.
2. A concurrency cap per user: a sorted set of holders, each with its own expiry time,
   default 2. The expiry means a crashed process cannot leak a slot, and releasing removes
   only that holder's own entry.
3. The request is counted after the origin and session checks but before the body is parsed,
   so malformed requests use the allowance too. A slot is taken only for a valid question.
4. Fail closed: a Redis error is a 500, not a skipped check. Sessions live in the same Redis,
   so there is no working state in which the limiter is down and the route is up.
5. 429 carries a Retry-After header and one of two fixed messages (rate_limited,
   too_many_streams), in the same error table as every other chat error.

## Options considered
- Fixed window counter (INCR + EXPIRE): rejected. Cheaper, but a burst split across a window
  boundary can send twice the limit.
- Token bucket: rejected. Good for allowing bursts, but "N per window" is easier to state,
  test and explain here.
- Counting in Node memory: rejected. Not shared between instances or restarts.
- A plain INCR/DECR counter for streams: rejected. A crash between them leaks a slot
  forever, and a double release can go negative or free someone else's slot.
- Limiting by IP: rejected for this route. Callers are authenticated, so the user id is a
  better key, and there is no trusted proxy here to take a client IP from.

## Consequences
Positive: bounded cost per user, shared across instances, no new service or dependency.
Negative: O(limit) memory per active user (about 20 entries). EVAL sends the script text on
every call instead of using EVALSHA. At this size that cost is negligible.
Risks and mitigations:
- The unauthenticated login route is not limited. Mitigation: it only creates a short
  lived entry, and the gap is listed in the README.
- The limits are per user, not per tenant. The backend's tenant quota stays the shared
  ceiling.
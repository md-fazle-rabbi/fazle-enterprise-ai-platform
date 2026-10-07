# ADR-026: Saving history from the web tier

Status: Accepted (2026-10-07)

## Context
Part 1 (ADR-025) added per-user conversation storage in the backend. Something has to save
each exchange, and the browser, the web server and the backend are all candidates.

## Decision
1. /api/chat saves the exchange itself, after validating the result, then sends a final
   "history" event. The browser sends no answer to be stored.
2. A failed save never fails the answer. The browser is told it was not saved.
3. Every backend call during the save re-reads the session from Redis first.
4. A save into a conversation that no longer exists creates a new one and saves there. A
   save that fails right after a create deletes the empty conversation.
5. The browser reads the stream to its end, since "history" comes after the result.
6. Stored results are parsed tolerantly: one that no longer matches the current schema is
   shown as plain text.
7. GET routes require a session. DELETE also requires a matching Origin.

## Options considered
- The browser posting the answer back to be saved: rejected. The server already holds the
  validated result, and this would let the browser decide what goes into history.
- The backend saving inside /query/stream: rejected, see ADR-025.
- Reusing the session object from the start of the request for the save: rejected. The
  answer's own call may have refreshed the tokens, and a stale copy refreshes again with an
  old refresh token.
- Failing the whole conversation when one stored result is unreadable: rejected.

## Consequences
Positive: history cannot be shaped by the browser, a deleted conversation does not lose the
next answer, and an old stored result cannot break a conversation.
Negative: the stream stays open slightly longer after the result, and the question box stays
locked until the save settles.
Risks and mitigations:
- A save can fail silently from the user's point of view in this part, since there is no
  interface for it yet. Mitigation: the next part shows a note under an unsaved answer.
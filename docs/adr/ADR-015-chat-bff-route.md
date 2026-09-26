# ADR-015: Chat route in the web app

Status: Accepted (2026-09-26)

## Context
The browser must ask questions and see the answer as the backend produces it,
without holding a token, and without seeing anything the backend was not meant
to show. The backend streams Server-Sent Events (ADR-014).

## Decision
1. POST /api/chat requires: Origin equal to the app address, a JSON content
   type, a real session, and a question of 1 to 2000 characters.
2. The route does not pass the backend stream through. It reads each event
   with a small parser, validates it with zod, and writes a new event. Errors
   use fixed messages chosen from a table. The backend's detail text is never
   forwarded.
3. Unknown events and unknown stage names are dropped. A result of the wrong
   shape ends the stream with an internal error.
4. The handler owns an AbortController. When the browser leaves, the response
   stream's cancel aborts the request to the backend, which stops its work.
5. The whole call has a 120 second limit. There is one automatic retry of the
   401 case only (before the backend ran anything), and none otherwise.
6. The parser and the event schemas contain no server code, so the chat UI in the
   browser uses the same ones.

## Options considered
- Piping the backend response to the browser unchanged: rejected. It would
  forward backend text and shapes the web app never checked.
- The browser calling the backend directly: rejected by ADR-007 (tokens stay
  server side, no CORS).
- Relying on request.signal alone for disconnects: rejected. I could not verify
  that it fires, so the stream's own cancel is the primary path.
- WebSocket: rejected, the flow is one way (see ADR-014).

## Consequences
Positive: the browser only ever sees validated events with fixed error text, and
a closed tab stops the backend work.
Negative: a small parser to maintain, and a stage the web app does not know is
invisible to the user until the schema is updated.
Risks and mitigations:
- The web server sends no keepalive of its own. Behind a proxy with a short idle
  timeout, a long silent generation could be cut. Mitigation: stage events arrive
  regularly, and a keepalive can be added.
- There is no per user rate limit or cap on parallel streams in this route, only
  the backend's per tenant daily quota. Mitigation: listed as a limitation.
- The default tenant is the first one in the token until the selector exists.
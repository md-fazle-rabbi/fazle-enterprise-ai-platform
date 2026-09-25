# ADR-014: Streaming the query pipeline as stage events

Status: Accepted (2026-09-26)

## Context
The web chat should show progress while a query runs. The pipeline ends with
output checks (PII redaction, canary and trifecta detection) that read the
finished answer and can rewrite it. The injection firewall matches request
paths exactly.

## Decision
1. POST /query/stream runs the same pipeline as POST /query through one shared
   function, run_query. It reports each stage start through a callback.
2. The stream carries stage events, then one result event (the same body as
   /query) or one error event. It does not carry model tokens.
3. Native FastAPI SSE (0.135 or newer) is used: EventSourceResponse and
   ServerSentEvent. It adds the 15 second keepalive and the no-cache and
   no-buffering headers.
4. A worker task runs the pipeline in its own session and transaction and sends
   events through a queue. The result event is sent after the commit.
5. Failures after the stream has started become error events. Unexpected errors
   carry the fixed text "Internal server error" and are logged in full.
6. /query/stream is added to the firewall's inspected paths.

## Options considered
- Streaming model tokens: rejected. The output checks can redact the answer, so
  nothing generated may be shown before they ran.
- Turning the pipeline into a generator: rejected. Its early returns sit inside
  OpenTelemetry spans, and a yield inside a span would leave the span context
  open across the yield. The callback keeps /query's code path as it was.
- WebSockets: rejected. The flow is one way, SSE works over POST, and it passes
  through proxies more simply.
- sse-starlette: rejected. FastAPI now has native SSE, so no extra dependency
  needs to be declared.
- Reusing Depends(get_session) in the streaming endpoint: rejected. Its lifetime
  relative to a streamed response depends on the FastAPI version. The worker
  owns its transaction instead.

## Consequences
Positive: one pipeline for two endpoints, checked answers only, and stream
failures cannot leak internals.
Negative: a client that disconnects before the result event loses that
request's database writes (audit entry and review queue item). Redis side
effects (quota, cache) may already have happened.
Risks and mitigations:
- A new free text endpoint can be forgotten in the firewall path list. Mitigation:
  a test for /query/stream, and the limitation is written in the README.
- A blind client retry repeats generation and quota use. Mitigation: no
  reconnect semantics, documented, and the web client will not retry.
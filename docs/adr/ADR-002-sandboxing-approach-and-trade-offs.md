# ADR-002: sandboxing approach and trade-offs

## Status
Accepted

## Context
Agents can execute generated code and can loop. Two distinct risks:
malicious or buggy code doing real damage, and a healthy-looking loop
that never terminates and burns cost/resources indefinitely.

## Decision
- Code execution: AST static scan first (fast, free, catches obvious
  cases), then network-disabled, resource-limited, capability-dropped
  Docker container execution for whatever passes the scan.
- Runaway control: pub/sub-based kill switch, not a polled flag, proven
  under 5 seconds against a simulated loop, not just claimed.

## Options considered
- True gVisor (runsc) isolation: not used, needs host-level container
  runtime configuration this Docker-in-Docker setup doesn't have. Named
  explicitly as the production upgrade path, not silently substituted
  with plain Docker isolation while implying it's the same thing.
- Polling-based kill switch: rejected, propagation time is bounded by
  poll interval, and a short enough interval to hit <5s reliably means
  meaningful Redis load per agent per work-unit for a control that's
  active zero percent of the time.

## Consequences
Positive: the isolation properties actually claimed (network-disabled,
resource-capped, AST-filtered) are each individually tested, not asserted.
Negative: Docker socket access from whatever process spawns sandboxed
containers is real host reach if that process itself is compromised, a
genuine trade-off of this approach, not eliminated by anything built here.
Risk to mitigation: dedicated sandbox host or gVisor runtime before this
handles anything beyond a portfolio demo or a client's explicitly
authorized, low-stakes code.

## Amendment (post-implementation hardening)
Three correctness bugs surfaced during test-writing, after the initial
"proven under 5s" measurement was already taken. All three are fixed as
of this amendment; the original measurement (0.056s) was re-verified
against the fixed code and still holds.

1. **Clear-path bytes/str mismatch.** `KillSwitchListener._listen()`
   compared the pub/sub message payload directly against the string
   `"__cleared__"`. If the Redis client wasn't constructed with
   `decode_responses=True`, the payload arrives as `bytes`, so the
   comparison silently always fails — `deactivate()` would appear to
   succeed (log line, Redis key removed) while every listener's
   in-process `Event` stayed set forever. Fixed by decoding the payload
   defensively inside the listener itself, rather than depending on
   every caller constructing its Redis client identically.

2. **Subscribe race in `start()`.** `start()` created the background
   listener task and returned immediately, without waiting for the
   underlying `SUBSCRIBE` command to actually complete. Redis does not
   queue a published message for a subscriber whose `SUBSCRIBE` hasn't
   finished registering on the server — a caller that called
   `activate()` immediately after `start()` returned could lose the
   message entirely, with no error or signal that it happened. Fixed by
   moving `pubsub.subscribe()` into `start()` itself, awaited, so the
   method doesn't return until the subscription is actually live.

3. **Deprecated type annotation.** `admin.py`'s `lifespan` was annotated
   `-> AsyncIterator[None]`; `@asynccontextmanager` requires
   `-> AsyncGenerator[None]`. Cosmetic (a Pylance deprecation warning,
   not a runtime bug), fixed alongside the above.

None of these change the ADR's core decision or trade-offs. They're
listed here because (1) and (2) both directly undercut the "proven, not
claimed" premise the kill switch is supposed to satisfy — a kill switch
that silently fails to clear, or can silently fail to activate for a
listener started moments before the trigger, is not meaningfully
"proven" by a test that only ever exercised the lucky-timing path. A new
test (`test_kill_switch_clears_via_pubsub`) now exercises the clear path
specifically and would have caught (1) before it shipped; it also
caught (2) as a side effect, since it doesn't add the incidental sleep
the original test had before calling `activate()`.
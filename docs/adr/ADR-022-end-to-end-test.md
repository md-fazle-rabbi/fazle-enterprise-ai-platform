# ADR-022: End to end tests and accessibility scan

Status: Accepted, 2026-10-01 (amended after the first runs found a stalled chat stream)

## Context
The web app had no test through a real Keycloak login and a real backend answer. The
roadmap asks for one E2E smoke test plus an accessibility check.

The first runs found a real bug: run 3 stuck on "Searching your documents…" because
/query embedded each question twice (cache check, then inside hybrid_search). On Voyage's
free tier (3 requests per minute) the second call hit the rate limit and backed off 25 s
up to three times. No pipeline stage had a deadline, so the stream stayed silent.

## Decision
1. Two Playwright tests. One real journey: login page (axe), Keycloak sign in, chat
   question, cited answer, chat page (axe). One mocked failure: the stream ends with no
   answer, and the UI must show an error and re-enable Send. Shared sign in helper, no
   saved login state.
2. Keycloak fields are selected by id (#username, #password, #kc-login), not label text.
3. No Playwright webServer. The Next.js dev server and the Docker stack (Postgres, Redis,
   Keycloak, FastAPI) are started by hand.
4. Chromium only, no CI wiring (the real test needs Voyage and Gemini keys).
5. The password comes from the E2E_ALICE_PASSWORD environment variable, never a file.
6. pretest:e2e clears the semantic cache, because a cached answer has no sources and
   would fail the citation check.
7. The real test checks that the pipeline finishes (Send returns, 45 s), then that a
   citation link exists, and attaches the conversation text. retries stays 0.
8. The mocked test filters the alert by text (Next.js has its own role="alert").
9. One embedding per question: run_query passes its vector to hybrid_search through an
   optional query_vector argument. /search is unchanged.
10. Every pipeline call has a stage deadline (cache_lookup 40 s). A timeout becomes a 504
    error event, so a stream always ends with a result or an error.
11. embeddings.py spaces Voyage calls with a sliding-window limiter (3 per 62 s). A
    question waits at most 8 s for a slot, times out a call at 10 s, does not retry a
    429, worst case 39 s. Ingestion waits for slots and retries patiently.
12. client.ts ends a stream that closes without a result or error with an "unavailable"
    error.
13. Backend tests never call Voyage: conftest patches routers/query.py's embed_query and
    fails any test that reaches the real client (except test_embeddings.py).

## Options considered
- Shared storageState login, label-based selectors, a .env.test password: rejected.
- retries: 1: rejected, it would hide a stall behind a second attempt.
- Mocking the answer in the real test: rejected, it would test nothing about the pipeline.
- Paying for Voyage: not chosen, the build is designed around the free tier instead.
- Retrying a real 429 in a question: rejected, it will not clear within seconds.

## Consequences
Positive: a real unmocked path with accessibility scans; a stalled pipeline now shows an
error within about 40 s; one Voyage call per question; backend tests need no keys (105
passed in 27 s, was 2 failed in 164 s); Keycloak ids confirmed on a live instance.
Negative: the real test is slow (about 26 s) and covers one path. The free tier allows 3
questions per minute (every question needs one embedding, even a cached one), so space
E2E runs about 30 s apart and do not overlap pytest, E2E and manual chat.
Risks: a question with no free request slot fails instead of waiting (intended); the
limiter is per process, so a second process on the same key can still get a 429 (logged,
shown as an error); the dev server must be running (fails fast with ERR_CONNECTION_REFUSED).

## Known limitations left open
- A timeout or rate-limited embedding shows "Something went wrong"; a dedicated "busy,
  try again" code is a separate step.
- The cache stores only the answer text, so a cache hit shows citation markers with no
  sources. Storing citations with the answer is a separate step.
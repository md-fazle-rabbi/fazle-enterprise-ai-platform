# ADR-035: Web document upload route

Status: Accepted (2026-10-13)

## Context
The backend accepts documents at `/ingest` (JSON), `/ingest/image` and `/ingest/pdf`
(multipart), with the limits from ADR-034. The web app had no way to send a file. A browser
cannot call the backend directly, because the tokens stay on the server, so the upload needs
a route in the web app (a BFF route) that checks the request and forwards it.

Three facts from the Next.js 16.3.8 docs shaped the design (read in `node_modules/next/dist/docs`):
- Route Handlers document no body size limit.
- Server Actions are capped at 1 MB by default (`serverActions.bodySizeLimit`), too small for
  a PDF, so a Server Action is the wrong tool.
- `experimental.proxyClientMaxBodySize` defaults to 10 MB, applies only to requests the proxy
  handles, and silently truncates a larger body instead of refusing it. The `proxy.ts`
  matcher excludes `api`, so `/api/documents` is not buffered by it today.

The docs say nothing on how much memory `request.formData()` uses before it returns.

## Decision
1. `POST /api/documents` is a Route Handler. The rules live in `lib/upload/handler.ts`, with
   every dependency passed in, so they are tested without Redis, Keycloak or a backend.
2. Check order: Origin equals `APP_URL`, content type is multipart, session, rate limit,
   declared Content-Length, concurrency slot, bounded read, parse, classify, forward. Cheap
   checks run first, and the rate limit counts a request before its body is read.
3. The body is read by `readBoundedBody`, which counts bytes and cancels the stream past
   10 MiB plus 64 KiB. The form is then parsed from those bytes with
   `new Response(bytes).formData()`, so `request.formData()` is never used on an open stream.
4. The file is judged by its content, not by what the browser says. PNG, JPEG, WEBP and PDF
   are recognized by magic bytes, using the same lenient PDF header window as the backend
   (the first 1024 bytes). A name ending in `.txt` or `.md` is judged as strict UTF-8 text
   instead, so a Markdown file that mentions `%PDF-` is not read as a PDF.
5. The file name is cleaned before it is forwarded as `source_path`: last path segment only,
   control, zero width and bidirectional code points removed, NFC normalized, at most 200
   code points, extension kept.
6. A fresh request is built from the checked bytes. Text goes to `/ingest` as JSON, images to
   `/ingest/image` and PDFs to `/ingest/pdf` as multipart. The browser's own stream is never
   passed on.
7. Backend answers are checked with zod. Text from the backend reaches the browser only for
   400, 413, 415 and 422, and only when `detail` is a plain string cut to 300 characters.
   Everything else gets fixed text, and a 5xx body is never shown.
8. Uploads have their own limits, apart from chat: 10 per 600 seconds and 1 at a time per
   user, in Redis (`web:rl:upload:` and `web:conc:upload:`), set by `UPLOAD_RATE_LIMIT_MAX`,
   `UPLOAD_RATE_LIMIT_WINDOW_SECONDS` and `UPLOAD_MAX_CONCURRENT`.
9. The session is read again from Redis right before the backend call, because a large
   upload takes time and another request may have refreshed the tokens meanwhile.
10. Backend timeouts are 60 seconds for text and images and 180 seconds for a PDF. A timeout
    answers 504 with a message that says to check the document list before trying again.

## Options considered
- A Server Action: rejected. The 1 MB default is too small, and raising it changes the limit
  for every action.
- `request.formData()` directly: rejected. Its memory use is not documented, and it would
  read the stream before the size is known.
- Piping the browser's stream to the backend: rejected. The web app would not know what it
  forwarded, and the checks would be the backend's alone.
- Trusting the MIME type or the extension: rejected. Both are written by the client.
- Sharing the chat rate limit: rejected. An upload spends embedding quota and runs for
  minutes, a chat answer does not, so the budgets differ.
- Setting `proxyClientMaxBodySize`: not needed now. If the matcher ever stops excluding
  `api`, a PDF over 10 MB would be cut off without an error, so this ADR is the reminder.

## Consequences
Positive: an oversized, mistyped or flooding upload is stopped in the web tier before the
backend sees it, a backend error cannot leak text to the browser, and the rules are
unit tested. Alignment: OWASP LLM10:2025 (Unbounded Consumption) for the size, rate and
concurrency limits, and OWASP LLM01:2025 for file content, where the backend still runs the
injection firewall on stored text. As of August 2026 OWASP has no separate ID for injection
through images, so image content falls under LLM01:2025. This is risk reduction, not
elimination.
Negative:
- Each upload holds about two to three copies of the file in memory (the counted chunks,
  the joined bytes and the parsed file), up to roughly 30 MiB for a 10 MiB PDF, one upload per
  user at a time. This is arithmetic, not a measurement.
- The 60 and 180 second timeouts are starting guesses. The backend embeds through a free
  tier with 3 requests a minute, so a slow answer is normal.
- A 504 does not mean the backend failed. It may finish the work after the web app gave up.
- The limits are per user, so many users can still use up the shared embedding quota.
- A `.txt` file that is valid text is stored as text whatever its content, and a binary file
  renamed to `.txt` is refused with 422.
- This amends ADR-034, which said only `/api/chat` has a rate limit in the web app.
Risks and mitigations:
- The rules are checked twice, here and in the backend. Mitigation: `limits.test.ts` reads
  `upload_limits.py` and fails if the numbers drift apart.
- A new body carrying web route could skip these checks. Mitigation: the upload rules live
  in one handler with one test file, and this ADR names the pattern.

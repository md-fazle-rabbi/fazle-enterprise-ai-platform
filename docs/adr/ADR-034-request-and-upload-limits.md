# ADR-034: Request and upload limits

Status: Accepted (2026-10-11)

## Context
Starlette 1.6.0 limits only the plain fields of a multipart form (1 MiB each). A file part is
written to a temporary file with no limit, FastAPI calls request.form() with those defaults,
and the upload handlers then call file.read(), which loads the whole file into memory. The
firewall middleware also buffers the whole JSON body before pydantic sees it.

Other inputs were open as well. The PDF route rendered every page to PNG before checking
anything, with no limit on page count or page size: a page declared 14,400 points on a side
would ask for a 30,000 by 30,000 pixel render at 150 dpi. Image uploads were not checked for
type, so a junk file ended in a 500, and GIF went to Gemini although Gemini documents only
PNG, JPEG, WEBP, HEIC and HEIF. /query took any question and any top_k, and since the
classifier scores long text in up to 64 segments and every retrieved parent chunk, both
multiplied the cost of one request. /ingest sent every chunk in one Voyage request, and
voyage-4-large takes at most 1,000 texts and 120K tokens per request.

## Decision
1. A plain ASGI middleware caps the body of each listed POST path. A declared
   Content-Length over the limit is refused before a byte is read. Any other body is counted
   as it arrives and stopped over the limit. It is added after the firewall middleware, so it
   is the outer one and an oversized body never reaches the firewall.
2. The limits are named constants in upload_limits.py, each with its reason: images 8 MiB and
   50 million pixels, PNG, JPEG and WEBP only; PDFs 10 MiB, 20 pages, a 6 million pixel
   budget per rendered page, 8 MiB per rendered page; text 100,000 characters and 200 chunks;
   question 2,000 characters, top_k 1 to 20.
3. Content is checked where the file is opened: Pillow reads the image header, and pdf.py
   checks password protection and page count before rendering anything. A page over the
   pixel budget is rendered at a lower dpi.
4. The chunk count is checked before any insert or delete, so a refused document changes
   nothing.
5. Status codes: 413 for body size, 415 for file type, 422 for a limit on content (pixels,
   pages, sections) or a field.

## Options considered
- Check Content-Length only: rejected. A chunked body has none, and a client can lie.
- Check the size in the handler after file.read(): rejected. The file is already in memory
  and on disk by then.
- A reverse proxy limit: rejected for now. The repository runs without one, and the limit has
  to hold without it. It would still be a good second layer.
- Reject large PDF pages instead of lowering the dpi: rejected. A poster size page is a valid
  file, and a lower resolution is a smaller harm than a refusal.
- Settings from environment variables: rejected for now. Constants are easier to test, and
  the numbers are not tuned per deployment yet.

## Consequences
Positive: one request can no longer force the server to read, store or render an unbounded
amount, the numbers are in one file with their reasons, and a refused upload leaves no
document or chunk behind.
Negative:
- GIF uploads that worked through the OCR fallback are now refused with 415.
- The 20 rendered pages of a PDF are held in memory together, up to 160 MiB in the worst
  case. That is a bound, not a measured figure.
- A client that keeps sending after the 413 may see a connection reset instead of the
  response. The server replies with Connection: close.
- The limits stop one oversized request, not many small ones. Only /api/chat in the web app
  has a rate limit, and the shared embedding quota can still be used up by small requests.
- The other POST routes (agents, reviews, documents, governance) have no byte cap yet.
- A page rendered at a lower dpi may read poorly.
- Text made only of escaped non-ASCII characters can pass the character limit and still pass
  the byte limit, so such a body gets 413 where a plain one would get 422.
Risks and mitigations:
- The numbers come from vendor limits and arithmetic, not from real documents. Mitigation:
  README states it, and each constant carries its reason so it can be revised.
- A new body carrying endpoint is unprotected until it is added to BODY_LIMITS. Mitigation:
  the same rule as the firewall path list, written in upload_limits.py.
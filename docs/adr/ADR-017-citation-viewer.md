# ADR-017: Citation viewer

Status: Accepted (2026-09-26)

## Context
The backend's QueryResponse (rag_engine/routers/query.py) puts [N] markers in the answer text
that index retrieved_context (1-based). citations is a separate, filtered list built by
iterating a Python set (cited_indices: set[int]), so its order is not guaranteed to match the
numbers in the text. A cache hit returns an empty retrieved_context and an empty citations
list, but the cached answer text can still contain [N] from when it was first generated.

## Decision
1. A marker [N] resolves to retrieved_context[N-1]. citations is never used for index lookup,
   only for Set-based membership, to mark a retrieved source as actually cited.
2. A marker outside 1..retrieved_context.length renders as plain, muted, non-clickable text
   with an aria-label, not a broken link.
3. The "sources unavailable" note is a generic bounds check (does any marker fail to resolve),
   not a check against flag_reasons containing "cache_hit". This covers a cache hit and a
   hallucinated out-of-range index with the same code path, and does not couple the UI to an
   internal flag-reason string.
4. Each source is a real anchor target (id, tabIndex={-1}) that a real <a href="#id"> jumps to,
   so it works without JavaScript. An onClick handler additionally calls scrollIntoView and
   focus(), because the browser's native hash navigation does not re-fire on a click that does
   not change the hash, so a second click on the same marker would otherwise do nothing.
5. Highlighting uses the [&:target]:bg-... arbitrary Tailwind variant plus a :focus ring, not a
   parallel piece of React state, so it needs no extra state and matches the browser's own
   notion of "the current fragment".

## Options considered
- Indexing citations directly by position: rejected. Confirmed this session that its order
  comes from iterating a Python set, so a link built this way could point at the wrong source.
- Coupling the "no source" note to flag_reasons.includes("cache_hit"): rejected. A hallucinated
  out-of-range marker needs the same message and isn't a cache hit, and the check would break
  silently if the backend's flag-reason string ever changed.
- Hiding an unresolved marker from screen readers entirely (aria-hidden): rejected. It would
  leave a silent gap where sighted users still see "[5]"; an aria-label gives both audiences
  some signal.
- A JS-only click handler with preventDefault: rejected. Keeping the real href lets the jump
  work with JavaScript disabled, and update history/URL the way a native anchor does.

## Consequences
Positive: a citation link always points at the exact chunk the number refers to, verified
independently of the backend's own citations array order. A no-JS visitor still gets working
navigation.
Negative: no scroll-back from a source to where it was cited, and no length cap on a source's
shown text.
Risks and mitigations:
- If a future backend change starts sorting citations before returning them, nothing here
  breaks, since order is never relied on. If retrieved_context's indexing convention ever
  changes, this whole file needs revisiting; that convention is called out explicitly in the
  code comment.
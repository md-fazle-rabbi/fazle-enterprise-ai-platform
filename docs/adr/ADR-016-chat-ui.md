# ADR-016: Chat UI

Status: Accepted (2026-09-26)

## Context
/api/chat (ADR-015) streams validated events with fixed error text. The
browser needs a form, a live view of progress, and a place to show the
answer, keyboard and screen reader accessible, with no new attack surface
from the model's own output.

## Decision
1. A conversation history uses role="log" (implicit aria-live="polite",
   aria-atomic="false"), the technique W3C's ARIA23 and MDN document for chat.
2. Enter sends, Shift+Enter adds a line, and a check on
   event.nativeEvent.isComposing stops Enter from sending during IME input.
3. The field is readOnly while a question is in flight, not disabled, so it
   keeps focus. The Send button stays a plain disabled button; browsers only
   pull focus away from a disabled element that had it, and by the time the
   button is disabled the field is what has focus.
4. The model's answer is rendered as text, never through
   dangerouslySetInnerHTML.
5. flag_reasons is never shown. Only a generic "Flagged for review" note
   appears when flagged is true.
6. Stop calls the same AbortController the fetch to /api/chat already uses
   (ADR-015), so it reuses the existing abort chain down to the backend.
7. lib/chat/events.ts and lib/chat/client.ts carry no server code, so the
   parser and the event schemas that validated /api/chat's own request to
   the backend now validate the browser's request to /api/chat too.
8. History lives only in React state. Nothing is written to localStorage or
   any other browser storage.

## Options considered
- role="status" for the whole history: rejected. status implies
  aria-atomic="true", so the whole conversation would be re-read on every
  new message. log is the documented pattern for a growing history.
- A markdown renderer for the answer: rejected for now. It would add a
  dependency and a new place to get output handling wrong. Plain text is
  correct and safe; formatting can come later behind its own review.
- disabled on the textarea while busy: rejected, see decision 3.
- Letting several questions run at once: rejected. One at a time keeps the
  state machine and the tests simple, and it matches quota being a shared,
  limited resource.

## Consequences
Positive: the history is properly announced to screen readers, IME users are
not interrupted, and Stop is a real cancellation, not just a UI reset.
Negative: no markdown, no citation detail, no scrollback beyond the page's
memory.
Risks and mitigations:
- A very long session grows the DOM and React state with no cap. Acceptable
  for a local showcase, listed as a known limitation.
- jsdom's support for isComposing in synthetic KeyboardEvents was not
  independently verified; the test for it should be treated as a signal, not
  a guarantee, until checked in a real browser.
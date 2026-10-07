# ADR-027: History interface

Status: Accepted (2026-10-07)

## Context
Parts 1 and 2 (ADR-025, ADR-026) store and save history. The chat page needs a way to list,
open, continue and delete conversations without disturbing the one-thing-at-a-time design
or the accessibility work already done.

## Decision
1. A sidebar of the 50 most recent chats, a New chat button, and one active conversation id
   that /api/chat saves into and that the next question continues.
2. The sidebar is locked while an answer runs or a chat loads. Any new question, or New
   chat, cancels a pending open, so an older, slower load cannot overwrite the screen.
3. Delete is an inline two-step confirm, not a browser dialog.
4. A chat that cannot be opened shows a message and refreshes the list.
5. Loading a past chat switches the log's live region off for that render, so its messages
   are not all announced.
6. The chat panel is keyed on the current workspace.
7. Turns loaded from history use the first stored message id as their id, so the anchor ids
   used by the citation viewer stay unique across turns.

## Options considered
- window.confirm for deletes: rejected, awkward for keyboard and screen reader users.
- Letting the person switch chats while an answer streams: rejected, the saved exchange
  would attach to the wrong conversation.
- Leaving the live region on while loading history: rejected, it would read an entire
  conversation aloud on every open.
- Fetching the list on the server in the page: rejected. The list changes after every
  answer, and it is client state that needs refreshing.

## Consequences
Positive: history survives a refresh and a workspace switch, and nothing in the chat flow
can attach an answer to the wrong conversation.
Negative: no search, rename, export or pagination beyond the first 50. All of a
conversation's messages render at once.
Risks and mitigations:
- The live region behaviour has not been tested with a real screen reader. Mitigation:
  listed as a limitation.
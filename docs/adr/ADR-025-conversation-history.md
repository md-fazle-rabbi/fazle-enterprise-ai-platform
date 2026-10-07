# ADR-025: Conversation history in the backend

Status: Accepted (2026-10-06)

## Context
The web chat keeps its conversation only in the browser's memory. Daily use needs history
that survives a refresh. Redis here has no volume, so it is not durable, and the web app
talks only to the backend, never to the database.

## Decision
1. conversations and messages tables in Postgres, behind new backend routes.
2. Row level security on both tables requires tenant AND user. A missing user setting
   matches nothing, so a forgotten filter or a forgotten setting shows no data.
3. A real Keycloak token is required. The demo key and the raw header have no user.
4. A composite foreign key ties each message to its conversation's tenant and user.
5. The web tier saves one exchange (question plus validated result) per call, after a
   successful answer. Both rows are written in one transaction.
6. Caps: 500 conversations per user, 1,000 messages per conversation, 50,000 answer
   characters, 50 sources.
7. Timestamps come from the database clock, with the answer one millisecond after the
   question, so order is deterministic.

## Options considered
- Redis for history: rejected, not durable here.
- The backend saving inside /query/stream: rejected for now. It needs the user identity
  inside the streaming endpoint and a refactor of its worker, for a small gain.
- Tenant-only RLS plus WHERE user_id: rejected. One missing filter would expose other
  users' chats.
- Letting the database cascade alone on delete: rejected, the route deletes messages
  explicitly first rather than depend on cascade behaviour under forced RLS.

## Consequences
Positive: durable, private by construction, no new service.
Negative: stored text is a copy (including retrieved source text) that later document edits
do not change, and there is no expiry.
Risks and mitigations:
- If conversational memory is ever added (past turns fed back to the model), stored text
  becomes input to the model and must go through the injection firewall first.
- A user can write to their own history by calling the API directly. It is their own
  data, and history is not an audit record.
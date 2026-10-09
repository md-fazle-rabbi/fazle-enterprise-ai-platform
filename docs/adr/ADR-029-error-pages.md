# ADR-029: Error pages

Status: Accepted (2026-10-09)

## Context
The web app showed Next.js's default error and 404 pages, which look unfinished. A
client side error's message can also carry internal detail, so the error page is a place
where information can leak.

## Decision
1. Add app/error.tsx, app/not-found.tsx and app/global-error.tsx, with error.tsx and
   not-found.tsx sharing one ErrorPanel component.
2. The error page shows fixed text and the error digest as a reference. It never shows
   error.message.
3. Recovery uses the `retry` prop, which Next.js made stable in 16.3.0 (the repo requires
   ^16.3.5). Not `reset`, which does not re-fetch, and not `unstable_retry`, the 16.2 name.
4. global-error.tsx is self contained: its own html and body, and its CSS in a style
   element. It imports nothing from the app.

## Options considered
- Importing globals.css into global-error: rejected. The page that must work when
  everything else is broken should not depend on the CSS pipeline.
- Showing error.message in development only: rejected. Next's own development overlay
  already shows it, and a second code path is one more place to get wrong.
- A hand written error boundary class: rejected. The file convention does the same job.

## Consequences
Positive: a consistent look, no internal detail on screen, one place to restyle two pages.
Negative: global-error repeats the neutral colours, so a design change has to be copied
there by hand.
Risks and mitigations:
- A signed out visitor to an unknown address is redirected to /login by proxy.ts and never
  sees the 404 page. Accepted, and listed in the README.
- `retry` needs Next 16.3 or newer. Mitigation: the version range in package.json.

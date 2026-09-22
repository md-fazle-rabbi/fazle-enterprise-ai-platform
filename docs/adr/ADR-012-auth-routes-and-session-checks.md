# ADR-012: Auth routes and session checks in the web app

Status: Accepted (2026-09-21)

## Context
Login, callback and logout are the only routes that create or end a session.
Pages need to know who is signed in. Next.js 16 offers proxy.ts for request
level checks, and its own docs say it is not a session solution.

## Decision
1. proxy.ts is an optimistic gate: no session cookie means a redirect to the
   login page with a safe return path. It never reads Redis.
2. Every page that needs a user calls getSession, which looks the session id up
   in Redis. No data there means no session, whatever the cookie says.
3. The route logic lives in lib/auth/handlers.ts and receives Redis, Keycloak
   and the cookie rules as parameters. Route files only wire real ones in.
4. Logout is a POST route handler: the Origin header must equal the app
   address, the session is deleted first, and the answer is a 303 to Keycloak's
   end session URL. It is not a Server Action.
5. Auth redirects carry Cache-Control: no-store. A failed login shows one of
   three fixed messages chosen from a Map, never text taken from the URL.
6. A login replaces any older session of the same browser.

## Options considered
- Full session validation in proxy.ts: rejected. Slow work does not belong
  there, and a matcher mistake would silently drop the check.
- Logout as a Server Action: rejected. It has to redirect to an external
  address, and I could not confirm how Next.js handles that. A form POST with a
  303 is plain HTTP.
- Logout as a GET link: rejected. Any page could trigger it.
- Testing the routes with module mocks: rejected. Passing dependencies in makes
  the tests plain and keeps the security rules visible.

## Consequences
Positive: a forged or leftover cookie gets through the gate but not past the
page. Handlers are tested without a browser, Redis or Keycloak.
Negative: two layers to keep in step, and every new page must call getSession.
Risks and mitigations:
- A page that forgets getSession is only protected by the gate. Mitigation:
  requireSession is the one call to make, and the end to end test later.
- Redis down means pages that need a session fail. Mitigation: the login page
  and the auth routes fall back to a message.
- The Origin check refuses a browser that sends no Origin. Mitigation: modern
  browsers send it on form POSTs.
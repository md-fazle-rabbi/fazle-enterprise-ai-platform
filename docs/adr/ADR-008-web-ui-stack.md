# ADR-008: Web UI stack

Status: Accepted (2026-09-20)

## Context
The platform needs a UI that shows real login, chat with citations, tenant
selection and an admin view, and that a reviewer can run locally with one
command. It must respect ADR-007: tokens stay server side and the browser only
talks to the UI's own origin.

## Decision
apps/web is a Next.js 16 App Router project (Next acts as the backend for
frontend), TypeScript strict, Tailwind CSS 4, ESLint flat config plus
Prettier, Vitest with Testing Library for components, Playwright for
end to end (added later), zod for environment validation, npm as package
manager, Node 24 LTS. Server only code imports server-only. FastAPI is called
from one module (src/lib/backend.ts).

## Options considered
- Jest: still documented by Next.js, rejected for heavier configuration next
  to Vitest, which the Next.js docs also cover.
- Vite single page app: rejected, it would hold tokens in the browser and need
  CORS, which conflicts with ADR-007.
- Biome instead of ESLint and Prettier: supported by Next.js, rejected because
  eslint-config-next carries the Next.js and accessibility rules.
- pnpm, yarn or bun: rejected, npm ships with Node so a reviewer installs
  nothing extra.
- Node 20: rejected, it reached end of life on 30 April 2026 even though
  Next.js 16 still runs on it.
- CSS modules instead of Tailwind: rejected, more hand written CSS for the
  chat and admin screens.

## Consequences
Positive: one runtime and one origin for the browser, strict types end to end,
lint, types and tests run with one command.
Negative: Vitest cannot render async Server Components (Next.js docs), so pages
like the home page need the end to end test, which does not exist yet.
Risks and mitigations:
- No Content Security Policy yet. It needs per request nonces. Mitigation: basic
  security headers now, CSP as a later hardening step.
- Environment is validated when the module first loads, so a bad value shows up
  on the first request that touches the backend, not at boot. Mitigation: the
  error text names the variable, and the Docker health check will catch it.
- output: standalone is off until the Dockerfile step, because next start warns
  with it on.
# ADR-023: Docker and CI for the web app

Status: Accepted (2026-10-01)

## Context
apps/web had no Dockerfile and no CI coverage. production_ready calls for a multi-stage,
non-root Dockerfile and a CI pipeline. The backend's Dockerfile and ci.yml already set
conventions (Debian slim base, BuildKit cache-mounted apt upgrade, non-root user, pinned
action SHAs) that this should follow rather than invent new ones.

## Decision
1. Next.js standalone output is enabled now. The Dockerfile has
   three stages: deps (npm ci only, for cache stability), builder (npm run build), runtime
   (Debian slim, apt-upgraded, non-root, only the traced files).
2. The runtime stage uses the `node` user (uid/gid 1000) that ships in the node base image.
   A first attempt to create a separate `appuser` with uid 1000 failed because that uid and
   gid are already taken in node:24-slim. Reusing the built-in user keeps the same uid as the
   backend's non-root user without fighting the base image.
3. env.ts has one required setting with no default (KEYCLOAK_WEB_CLIENT_SECRET), and
   `next build` imports every route, so the build needs a value. It is passed inline on the
   single `RUN npm run build` command, not with ENV. ENV would persist in image metadata and
   trigger Docker's SecretsUsedInArgOrEnv lint. The real secret is supplied at container
   start, like every other env.ts setting.
4. HOSTNAME=0.0.0.0 is set explicitly. At its default the server binds only to the
   container's loopback interface and Docker's port mapping reaches nothing.
5. next.config.ts pins `turbopack.root` and `outputFileTracingRoot` to apps/web. The repo
   has a second package-lock.json at the root, and Next inferred that as the workspace root.
   That nests the standalone server under `.next/standalone/apps/web/` and makes local
   builds behave differently from Docker, which has no parent lockfile.
6. web-checks and web-build-and-scan mirror the backend's lint-and-typecheck/test and
   build-and-scan jobs: same Trivy severity gate, same SARIF upload. The backend's pip-audit
   step is non-blocking because it has findings history to triage. The web image has none, so
   Trivy fails the job (exit-code 1) from the start.
7. The exact actions/setup-node SHA was not trusted from research. Two sources disagreed on
   the v6 pin in the same session, so it is resolved with `git ls-remote` and recorded in
   ci.yml after manual verification.

## Options considered
- Alpine base for the web image: rejected for consistency with the backend's Debian slim
  convention and to avoid musl-libc issues with native npm packages.
- Creating a dedicated `appuser`: rejected after the uid 1000 collision. Changing to a
  different uid would diverge from the backend for no benefit.
- Building from the repo root instead of apps/web: rejected. apps/web is a standalone npm
  project with its own lockfile, and a narrower context is faster and simpler.
- Enforcing a coverage percentage gate on the web app in CI: deferred. No module has been
  chosen as the equivalent anchor to the backend's chunking gate; recorded as a known
  limitation.

## Consequences
Positive: apps/web has a reproducible, non-root, CVE-patched container. Every push runs the
full test suite (including real-Redis integration tests), an image boot smoke test, and a
Trivy scan. The build-time placeholder does not appear in image metadata.
Negative: the setup-node pin needs one manual verification, and the placeholder secret is
still present in the builder stage's layers (discarded with that stage, never shipped).
Risks and mitigations:
- A wrong or stale action SHA breaks CI loudly (the job fails to start) rather than
  weakening it silently, so the risk is availability, not a quiet security gap.
- Two lockfiles in the repo can mislead Next's root inference again if the config pin is
  removed. The pin in next.config.ts is the guard.
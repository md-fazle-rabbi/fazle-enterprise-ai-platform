# ADR-028: Dependency update and audit policy

Status: Accepted (2026-10-09)

## Context
The repo has three dependency surfaces: a uv workspace, an npm web app, and container
images. Without automation they go stale, and stale pins are how known CVEs stay in a
build. The project runs on free tiers only.

## Decision
1. Dependabot opens grouped PRs: npm weekly, GitHub Actions, Docker and docker-compose
   monthly. All four ecosystems use a 7 day cooldown, and npm majors wait 14 days. The uv
   ecosystem is not listed, see the first update below.
2. CI runs `npm audit --omit=dev --audit-level=high` in the web-checks job. It fails the
   build on high or critical findings in production dependencies.
3. The web Vitest run enforces coverage thresholds set slightly below measured coverage.
4. Python 3.13, the Node major, and pgvector are excluded from automatic bumps.
5. Images whose registry gives Dependabot no publication date are excluded and bumped by
   hand: Keycloak (quay.io) and the uv image copied into the rag-engine Dockerfile (ghcr.io).

## Options considered
- Renovate: rejected. More flexible, but needs a separate app install and token.
  Dependabot is built into GitHub and is free.
- Auditing dev dependencies too: rejected. Noisy, and build time tools do not ship to
  users.
- A high fixed coverage target (80 or 90 percent): rejected. It would be false today,
  because the page files under src/app have no unit tests. A floor that blocks
  regressions is honest.
- Making pip-audit blocking in the same change: rejected for now. Its findings have not
  been triaged yet.

## Consequences
Positive: dependency drift and new production CVEs show up in CI without manual checks.
Negative: PR noise, and an unfixed high finding can block CI until it is handled.
Risks and mitigations:
- Dependabot PRs cannot read Actions secrets (as far as I know), so the Python test and
  RAGAS jobs may fail on them. Mitigation: review and run those locally before merging.
- Cooldown is best effort for the Docker ecosystems. When a registry exposes no publication
  date, Dependabot logs a warning and opens the PR without a delay. Mitigation: the monthly
  schedule, grouped PRs, and CI plus the image scan act as the backstop.

## Update 2026-10-09
Dependabot's uv job errored on this repo ("Dependabot does not support your uv version"), so the
uv ecosystem was removed from dependabot.yml. Python advisories are covered only by pip-audit in
CI, which is still non-blocking. Open item: triage the pip-audit findings, then make it blocking.

## Update 2026-10-09: Keycloak removed from Dependabot
Dependabot cooldown only works when the registry exposes a publication date. Docker Hub does
(the job logs show new python tags skipped during the cooldown period), quay.io does not, so a
Dependabot PR for Keycloak would arrive with no delay. Keycloak is therefore ignored in
dependabot.yml and reviewed by hand: a monthly GitHub issue (keycloak-review.yml) reminds me to
check the release is at least 7 days old, read the notes, bump the tag and pass the e2e test
before merging. This replaces the earlier rule of reviewing Keycloak Dependabot PRs. Cost:
Keycloak security releases are no longer announced by Dependabot, so the monthly check is the
only trigger.

## Update 2026-10-09: Dependabot config corrections
Reading the Dependabot job logs showed three problems with the first version of the config:
- Ignore names carry no registry host. Dependabot calls the image `keycloak/keycloak`, not
  `quay.io/keycloak/keycloak`, so the first Keycloak ignore matched nothing and a PR for
  Keycloak 26.8 opened with no cooldown. The ignore now uses the short name. The uv image is
  listed under both `ghcr.io/astral-sh/uv` and `astral-sh/uv` for the same reason.
- The docker ecosystem accepts only `default-days` in `cooldown`. Adding `semver-major-days`
  made Dependabot reject the whole file as invalid, which stopped every ecosystem. Only npm
  keeps `semver-major-days`.
- ghcr.io, like quay.io, gives no publication date, so the uv image in
  packages/rag-engine/Dockerfile is ignored and bumped by hand together with UV_VERSION in
  ci.yml. The monthly keycloak-review.yml reminder should list it too.
Verification: after the fix every Dependabot job (npm, github-actions, docker, docker-compose)
finishes green, and the docker job logs show the cooldown skipping a new python patch tag.
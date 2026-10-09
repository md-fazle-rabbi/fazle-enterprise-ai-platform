# ADR-028: Dependency update and audit policy

Status: Accepted (2026-10-09)

## Context
The repo has three dependency surfaces: a uv workspace, an npm web app, and container
images. Without automation they go stale, and stale pins are how known CVEs stay in a
build. The project runs on free tiers only.

## Decision
1. Dependabot opens grouped PRs: npm weekly, uv, GitHub Actions, Docker and docker-compose
   monthly. npm and uv use a 7 day cooldown (14 days for npm majors).
2. CI runs `npm audit --omit=dev --audit-level=high` in the web-checks job. It fails the
   build on high or critical findings in production dependencies.
3. The web Vitest run enforces coverage thresholds set slightly below measured coverage.
4. Python 3.13, the Node major, and pgvector are excluded from automatic bumps.

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
- Dependabot support for uv workspace members and override-dependencies is unverified
  until the first uv PR appears. Mitigation: read that PR before trusting the setup.

## Update 2026-10-09
Dependabot's uv job errored on this repo ("Dependabot does not support your uv version"), so the
uv ecosystem was removed from dependabot.yml. Python advisories are covered only by pip-audit in
CI, which is still non-blocking. Open item: triage the pip-audit findings, then make it blocking.

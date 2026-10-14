# Security exceptions

Findings that are known and not fixed. Each entry says what it is, why it is accepted for now,
and when it gets a second look.

## braces (GHSA-vfj7-8cjw-p6xm)

- **What:** `braces` can run out of stack on deeply nested patterns, a denial of service.
  `npm audit` rates it high.
- **Where:** `apps/web`, development dependencies only. The path is `eslint-config-next`,
  `@next/eslint-plugin-next`, `fast-glob`, `micromatch`, `braces`. It does not appear in
  `npm audit --omit=dev`, which CI runs and fails on a high finding
  ([`proof/web-npm-audit.txt`](../proof/web-npm-audit.txt)).
- **Why it is accepted:** it runs only when this repository is linted, on patterns written in
  this repository. It is not in the web image that serves users.
- **The offered fix:** `npm audit fix --force` installs `eslint-config-next@14.2.35`, which
  npm marks as a breaking change. That is a move to an older major version of the lint config
  for the sake of a dev-only finding, so it was not taken. Seen again on 2026-10-13.
- **Not covered:** CI does not gate development dependencies, so a new dev-only finding would
  not fail the build.
- **Review date:** 2026-11-08. Look for a new `eslint-config-next` release, or a patched
  `braces` or `micromatch`, and remove this entry when `npm audit` is clean.

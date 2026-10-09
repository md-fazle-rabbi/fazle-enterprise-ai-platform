# ADR-031: Branding for a local only app

Status: Accepted (2026-10-10)

## Context
Nothing identified the app in a browser tab, and the repository had no share image. The app
runs locally by design, so no crawler or chat app ever fetches a link preview from it.

## Decision
1. One SVG app icon at app/icon.svg: a shield with a check, in the accent colour.
2. No Open Graph tags and no share image in the web app.
3. A 1280x640 social preview image for the GitHub repository, rendered from an HTML file with
   Playwright and committed under docs/branding. It is uploaded by hand in the repository
   settings.
4. proxy.ts skips /icon.svg by exact file name, so the icon loads without a session.

## Options considered
- opengraph-image through next/og: rejected. Nothing would ever request it.
- A favicon.ico made from the SVG: rejected for now. It needs an image tool that is not in the
  toolchain, and current browsers read SVG icons.
- Skipping the proxy for any path that contains a dot: rejected. It would also exempt files
  that should need a session.

## Consequences
Positive: the share image sits where people actually see links, which is GitHub. The login
page shows its icon.
Negative: no ICO fallback. The social preview has to be re-rendered and uploaded again if the
numbers on it change.
Risks and mitigations:
- The proxy skip list has to grow with every new public static file. A test pins which paths
  are skipped and which are not.

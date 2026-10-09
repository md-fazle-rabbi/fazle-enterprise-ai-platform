# ADR-030: Landing page and design tokens

Status: Accepted (2026-10-08)

## Context
The sign in page was a heading and one button, so a visitor who had not signed in learned
nothing about the project. The whole web app used plain neutral colours and the system font.
The project runs locally by design, so there is no public site to host a separate landing page.

## Decision
1. The landing content lives on /login. proxy.ts already sends every signed out visit there.
2. Fonts are Geist Sans and Geist Mono from the `geist` npm package, served by next/font from
   this site.
3. One accent colour and the font names are Tailwind theme tokens in globals.css. The primary
   button uses the accent.
4. The six measured results on the page are copied by hand from the README table.

## Options considered
- A new public / route: rejected. The proxy rules and two end to end tests expect a signed out
  visit to / to end on /login. Changing that costs test changes and gives nothing here.
- next/font/google: rejected. It fetches at build time, so offline Docker builds would break.
- Fontsource: rejected. A second package for a job that geist already does and that
  integrates with next/font.
- Reading the results from the README at build time: rejected. Extra machinery to parse prose.

## Consequences
Positive: no routing change, fonts served from this site, a colour change is a three line edit.
Negative: the numbers can drift from the README. `geist` is a production dependency that
Dependabot and the npm audit gate now watch.
Risks and mitigations:
- Only the sign in page, the buttons and the fonts are redesigned so far. Mitigation: listed in
  the README as a known limitation.
- Colour contrast. Mitigation: ratios were computed, and the axe scan in the end to end test
  checks the login page.

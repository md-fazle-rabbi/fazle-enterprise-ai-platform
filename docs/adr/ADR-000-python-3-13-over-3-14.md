# ADR-000: Python 3.13.15 over 3.14 for the initial build

## Status
Accepted

## Context
Python 3.14.7 is a fully stable release as of August 2026, not a preview build. The
question is whether to build fazle-enterprise-ai-platform against 3.14 from day one or
stay on 3.13.

Presidio, the PII detection/redaction library the governance package, is the deciding factor. Presidio's own installation docs currently list official support
only through Python 3.10-3.13. Its changelog shows Python 3.14 wheel support landed very
recently, and one entry specifically calls out working around a spaCy release that does
not ship compatible Python 3.14 wheels. That is a live, current compatibility issue in a
transitive dependency, not a hypothetical one.

I did not find a confirmed 3.14-specific blocker in pgvector-python or asyncpg themselves.
Flagging that so this ADR does not overstate the evidence beyond what Presidio shows.

## Decision
Pin the project to Python 3.13.15 via `uv python pin 3.13.15` once the repo exists, not 3.14.7.

## Options considered
- Python 3.14.7: rejected for now. Stable release, but its dependency graph through
  Presidio and spaCy is still stabilizing. Building the governance/PII package against it
  today risks a wheel-compatibility break unrelated to our own code.
- Python 3.13.15: accepted. Full official support across every planned dependency
  (Presidio, FastAPI, LangGraph, pgvector-python), still receiving security patches, one
  release behind current instead of two.

## Consequences
Positive: no dependency-resolution surprises when Presidio gets wired in.
Negative: not on the newest interpreter, misses 3.14 improvements until migration.
Risk to mitigation: re-check Presidio's official support matrix, open a
follow-up ADR to move to 3.14 once it is clean.
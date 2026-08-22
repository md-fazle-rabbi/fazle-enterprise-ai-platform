# ADR-001: FastAPI over Flask/DRF

## Status
Accepted

## Context
rag-engine spends most of its time waiting on I/O: LLM API calls, pgvector
queries, Redis lookups, and eventually agent-mesh calls, not CPU work.

## Decision
Build on FastAPI, not Flask or Django REST Framework.

## Options considered
- Flask: synchronous by default, async support is bolted on rather than
  native, needs Marshmallow or similar layered on top for validation.
- Django REST Framework: heavier than this needs, ORM-first design fights
  an async, agentic workload, most of Django's batteries go unused here.
- FastAPI: accepted. Native async/await throughout, Pydantic v2 validation
  built in, automatic OpenAPI 3.1 schema generation becomes the live Swagger
  docs promised in the README, and it's what agent-mesh and MCP work later
  in the roadmap already assumes.

## Consequences
Positive: one validation layer, Pydantic v2, shared across the whole
monorepo through packages/core, not a different one per package.
Negative: smaller plugin ecosystem than Django's, admin UI and built-in auth
get built by hand instead of installed.
Risk to mitigation: async-everywhere means one blocking call stalls the
event loop for every other request. A py-spy profile pass before calling
anything production-ready is already on the roadmap for the CI step.
# fazle-enterprise-ai-platform

![CI](https://github.com/md-fazle-rabbi/fazle-enterprise-ai-platform/actions/workflows/ci.yml/badge.svg)
![License](https://img.shields.io/badge/license-MIT-green)
![Python](https://img.shields.io/badge/python-3.13.15-blue)
![RAGAS Faithfulness](https://img.shields.io/badge/RAGAS_faithfulness-passing_(≥0.90)-brightgreen)
![RAGAS Answer Relevancy](https://img.shields.io/badge/RAGAS_relevancy-passing_(≥0.85)-brightgreen)
![RAGAS Context Precision](https://img.shields.io/badge/RAGAS_context_precision-passing_(≥0.80)-brightgreen)

## Hire me
I build production AI systems that pass security audits, not demos: enterprise RAG that
doesn't hallucinate across text and visual input, agent meshes with signed inter-agent
messaging, and GDPR/HIPAA/EU AI Act compliance tooling. This repo is the proof.
Contact: mfrabbi.ai@gmail.com · Loom walkthrough: [link]

## 30 second read
RAG chatbots hallucinate and leak data across tenants. This system enforces both problems
shut at the infrastructure layer: Postgres Row-Level Security for tenant isolation (not
app-code filtering), enforced citation tags so every claim traces to a retrieved chunk, a
two-layer prompt-injection firewall, PII redaction before anything reaches storage, and an
automated RAGAS gate in CI that fails the build if answer faithfulness regresses. An agent
mesh sits alongside it: sandboxed code execution, a kill switch measured under 5 seconds
against a simulated runaway loop, RS256-signed inter-agent messaging, and OAuth/OPA-backed
identity and authorization — all reachable through this same merged API.

## Architecture

```mermaid
graph TB
    subgraph "External"
        User[API Client]
        Gemini[Gemini API<br/>generation + vision + agent]
        Voyage[Voyage AI<br/>embeddings]
        KC[Keycloak]
        OPA[OPA]
    end

    subgraph "rag-engine (merged API surface)"
        API[FastAPI Service]
        FW[Injection Firewall<br/>pattern + classifier]
        PII[Presidio<br/>PII redaction]
        Agents["/agents/research"]
        Admin["/admin/kill-switch"]
    end

    subgraph "agent-mesh (packages)"
        RA[Research Agent<br/>tenant bound server-side]
        MCP[MCP Tool Interface]
        KS[Kill Switch]
        SB[Code Sandbox]
    end

    subgraph "Data"
        PG[(Postgres + pgvector<br/>RLS enforced)]
        Redis[(Redis: rate limit, streams, kill switch)]
    end

    User -->|X-Tenant-ID or demo key| API
    API --> FW
    FW --> PII
    PII --> PG
    API -->|embed| Voyage
    API -->|generate| Gemini
    API --> Redis
    Agents --> RA
    RA -->|tenant-bound, server-side| API
    RA -.->|generation| Gemini
    Admin --> KS
    RA -.->|JWT verified| KC
    SB -.->|policy check| OPA
```

## CI & evals
Every push runs lint, `mypy --strict`, the chunking test suite (90% coverage gate),
agent-mesh's test suite, a Trivy image scan, CodeQL, and a RAGAS quality gate — all in
[`.github/workflows/ci.yml`](.github/workflows/ci.yml).

The RAGAS badges above are static text, not a live feed — `shields.io` static badges
just render whatever string is in the URL; they don't query GitHub Actions or RAGAS
directly. They currently reflect a passing run against this repo's own thresholds
(faithfulness ≥0.90, answer relevancy ≥0.85, context precision ≥0.80). For the exact
per-question numbers behind that pass, open the
[Actions tab](https://github.com/md-fazle-rabbi/fazle-enterprise-ai-platform/actions/workflows/ci.yml),
open the relevant run, and expand the **ragas-gate** job's **"Run RAGAS gate"** step —
that's where RAGAS prints its actual scores; the badges above don't update automatically
when those numbers change on a later run. See
[`packages/rag-engine/evals/run_ragas.py`](packages/rag-engine/evals/run_ragas.py) for
the gate's exact threshold logic.

### GitHub repo secrets required
Set these under **Settings → Secrets and variables → Actions**:

| Secret | Used by | Required for |
|---|---|---|
| `VOYAGE_API_KEY` | `test`, `ragas-gate` | embeddings |
| `GEMINI_API_KEY` | `ragas-gate` | RAGAS judge model + generation; also the research agent's own model at runtime |
| `HF_TOKEN` | `test` | Hugging Face model downloads (Presidio/transformers) |

No CI job invokes the live `/agents/research` endpoint (the `build-and-scan` smoke test
only imports `rag_engine.main` without calling it, and agent-mesh's own test suite tests
the research agent's tool directly rather than through the LLM), so `GEMINI_API_KEY`
isn't strictly required for CI to pass — but it does need to be set as a deployment env
var wherever this service serves real traffic to `/agents/research`.

## Demo
This system runs on Postgres+pgvector, Redis, and a FastAPI service — infrastructure
that doesn't fit a free public hosting tier without compromising the security model
it's built to demonstrate. Rather than run a stripped-down version publicly, the demo
is a Loom walkthrough of the full stack running locally end-to-end (ingestion,
tenant-isolated retrieval, injection firewall, PII redaction, citation-backed answers):

**Loom walkthrough:** [link]

### Run it yourself
```bash
git clone https://github.com/md-fazle-rabbi/fazle-enterprise-ai-platform.git
cd fazle-enterprise-ai-platform
docker-compose up
```

Then query it:
```bash
curl -X POST http://localhost:8000/query \
  -H "Authorization: Bearer fazle-demo-key" \
  -H "Content-Type: application/json" \
  -d '{"question": "How does this system enforce tenant isolation?"}'
```

Or invoke the research agent directly:
```bash
curl -X POST http://localhost:8000/agents/research \
  -H "X-Tenant-ID: <uuid>" \
  -H "Content-Type: application/json" \
  -d '{"question": "How does this system enforce tenant isolation?"}'
```

Swagger/OpenAPI docs at `http://localhost:8000/docs` once running.

## Known limitations
- Tenant identification via header/demo-key only, no signed auth yet
- BM25-family ranking via Postgres native `ts_rank_cd`, not exact Okapi BM25
- GraphRAG entity extraction is stored but not wired into retrieval
- PDF pages process sequentially, not concurrently
- `/admin/kill-switch/*` has no network restriction or auth yet — local-only until that's
  added, same stated gap as the Day 3 review-queue endpoints
- The MCP tool interface (`agent_mesh.mcp_server`) still takes `tenant_id` as an
  LLM-visible tool argument, unlike the HTTP-facing `/agents/research` path, which binds
  it server-side. Proper fix is deriving tenant/scope from the caller's OAuth token via
  Keycloak, not a tool parameter — tracked as a dedicated follow-up, not bolted onto the
  tenant-binding fix already shipped
- `test_authz.py` (agent-mesh's OPA-gated tests) isn't wired into CI yet — needs a live
  OPA instance, which GitHub Actions' `services:` block can't bind-mount policies into
  before checkout runs; needs a manual `docker run` step post-checkout instead

## License
MIT, see LICENSE.md.
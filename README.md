# fazle-enterprise-ai-platform

![CI](https://github.com/md-fazle-rabbi/fazle-enterprise-ai-platform/actions/workflows/ci.yml/badge.svg)
![License](https://img.shields.io/badge/license-MIT-green)
![Python](https://img.shields.io/badge/python-3.13.15-blue)
![RAGAS Faithfulness](https://img.shields.io/badge/RAGAS_faithfulness-pending_first_run-lightgrey)

## Hire me
I build production AI systems that pass security audits, not demos: enterprise RAG that
doesn't hallucinate across text and visual input, agent meshes with signed inter-agent
messaging, and GDPR/HIPAA/EU AI Act compliance tooling. This repo is the proof.
Contact: mfrabbi.ai@gmail.com · Live demo: [link once deployed] · Loom walkthrough: [link]

## 30 second read
RAG chatbots hallucinate and leak data across tenants. This system enforces both problems
shut at the infrastructure layer: Postgres Row-Level Security for tenant isolation (not
app-code filtering), enforced citation tags so every claim traces to a retrieved chunk, a
two-layer prompt-injection firewall, PII redaction before anything reaches storage, and an
automated RAGAS gate in CI that fails the build if answer faithfulness regresses.

## Architecture

```mermaid
graph TB
    subgraph "External"
        User[API Client]
        Gemini[Gemini API<br/>generation + vision]
        Voyage[Voyage AI<br/>embeddings]
    end

    subgraph "rag-engine (this repo)"
        API[FastAPI Service]
        FW[Injection Firewall<br/>pattern + classifier]
        PII[Presidio<br/>PII redaction]
    end

    subgraph "Data"
        PG[(Postgres + pgvector<br/>RLS enforced)]
        Redis[(Redis<br/>rate limiting)]
    end

    User -->|X-Tenant-ID or demo key| API
    API --> FW
    FW --> PII
    PII --> PG
    API -->|embed| Voyage
    API -->|generate| Gemini
    API --> Redis
```

## One-command demo
```bash
curl -X POST https://[demo-url]/query \
  -H "Authorization: Bearer fazle-demo-key" \
  -H "Content-Type: application/json" \
  -d '{"question": "How does this system enforce tenant isolation?"}'
```

## Live demo
https://fazle-enterprise-ai-platform.onrender.com · Public Swagger/OpenAPI: https://fazle-enterprise-ai-platform.onrender.com/docs

## Known limitations
- Tenant identification via header/demo-key only, no signed auth yet
- BM25-family ranking via Postgres native `ts_rank_cd`, not exact Okapi BM25
- GraphRAG entity extraction is stored but not wired into retrieval
- PDF pages process sequentially, not concurrently

## License
MIT, see LICENSE.md.
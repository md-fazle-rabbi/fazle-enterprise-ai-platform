# ADR-004: LangGraph runtime pin + model provider + MCP spec finding

## Status
Accepted

## Context
Agent orchestration needs a durable, stateful runtime, and tool interfaces
need a real protocol rather than ad-hoc function signatures. Both choices
need their exact current versions recorded, not assumed, per this
project's own honesty discipline. Model provider switched from Claude to
Gemini 3.5 Flash-Lite after this ADR's first draft — see the platform-wide
provider-swap note for the full rationale and file list.

## Decision
- LangGraph [run `uv run python -c "from importlib.metadata import version;
  print(version('langgraph'))"` in packages/agent-mesh and paste the
  result here — not yet captured; `import langgraph; print(langgraph.__version__)`
  fails with AttributeError since the module doesn't expose that
  attribute]. Pinned transitively via `langchain>=1.0`, not as a direct
  dependency — an earlier direct pin of `langgraph>=1.3.11` was
  unsatisfiable against every current `langchain` release (all cap
  `langgraph<1.3.0` as of this writing), caught by `uv sync` failing
  outright rather than silently resolving to something wrong.
- Agents built exclusively with `from langchain.agents import create_agent`,
  never `langgraph.prebuilt.create_react_agent` (deprecated) or the legacy
  `AgentExecutor` (maintenance-only, not deleted, not used here).
- Model: `gemini-3.5-flash-lite` via `langchain_google_genai.ChatGoogleGenerativeAI`,
  not `ChatAnthropic`. Flash-Lite is Google's high-throughput/low-cost tier,
  not a reasoning-depth model — fine for this agent's tool-calling role,
  re-verify against RAGAS/eval numbers before trusting it for anything
  closer to the main generation path.
- MCP: `mcp==2.2.0` installed, implementing the 2026-07-28 protocol
  revision (the stable v2 SDK line, GA alongside that spec date). This
  is a from-scratch breaking rewrite of the 1.x SDK — `mcp.server.fastmcp`
  no longer exists in it (moved to `mcp.server.MCPServer`), fields are
  now snake_case on the wire, and `mcp.types` is a separate `mcp-types`
  package aliased in. This confirms the earlier decision to build the
  tool interface on standalone `fastmcp` (Prefect's package) rather than
  anything from `mcp.server` directly — that choice predates this
  version check but turns out to be the right one for a second reason:
  it insulates the tool code from the v1→v2 rewrite entirely.
- MCP tool interface built on standalone `fastmcp` 4.0.3, not the in-SDK
  `mcp.server.fastmcp`. `fastmcp` 4.0.3 also removed `stateless_http` from
  the `FastMCP()` constructor (moved to `run()` / `run_http_async()` /
  `http_app()`, or the `FASTMCP_STATELESS_HTTP` env var) between when the
  original pattern was written and when it was actually run — caught by
  running the server, not by trusting the constructor signature as
  documented.
- Signed inter-agent messaging over Redis Streams (RS256 envelope
  signing, `XAUTOCLAIM`-based retry, dead-letter after 3 delivery
  attempts). Identity/authz layer: Keycloak 26.6 (client_credentials
  grant per agent, RS256-only enforced at `jwt.decode()`), OPA for
  policy-as-code tool authorization.

## Options considered
- Raw ReAct loop, hand-rolled: rejected, durable execution (survives a
  process restart mid-agent-run), checkpointing, and human-in-the-loop
  approval gates are exactly what LangGraph exists to not reimplement.
- `langgraph.prebuilt.create_react_agent`: rejected, explicitly deprecated
  as of LangChain/LangGraph's October 2025 v1.0 reset.
- Direct pin on `langgraph>=1.3.11`: rejected, unsatisfiable — no released
  `langchain>=1.0` version depends on a `langgraph` that high; letting
  `langchain` own the transitive constraint is what actually resolves.
- Claude (`ChatAnthropic`) as the agent model: superseded by the
  platform-wide Gemini swap; kept here as history, not as a live option.
- Importing `mcp.server` (v2) directly for the tool interface: rejected,
  standalone `fastmcp` insulates the tool code from the v1→v2 breaking
  rewrite and is the more widely-adopted stateless pattern regardless.
- A hand-rolled retry-counter table for messaging: rejected, Redis
  Streams consumer groups already track per-message delivery count
  natively (including across a crashed consumer), a parallel counter can
  only drift from that truth.
- An if/elif authorization chain in Python instead of OPA: rejected,
  policy-as-code keeps the "who can call what" rule in one auditable
  file, reviewable without reading the whole codebase, and changeable
  without a redeploy.

## Consequences
Positive: one durable runtime, one agent-construction pattern, across
every agent this mesh eventually holds. The MCP tool layer is decoupled
from `mcp` SDK churn by design, not by luck. The mesh now has a working
agent, an MCP tool interface, signed and retried messaging, and real
identity plus authorization — not stubs.
Negative: MCP's stateless rewrite means any tool-interface code written
before checking the installed package version risks targeting a spec
that no longer matches what actually ships — mitigated here since the
version check confirmed alignment before the tool interface was built.
Flash-Lite's smaller tier means agent tool-selection quality should be
spot-checked, not assumed equal to what Sonnet was giving. Also: don't
trust a package's own `__version__` attribute to exist —
`importlib.metadata.version()` is the reliable check going forward, this
ADR itself was almost written with a wrong number because of that gap.
LangChain's `StructuredTool` (Pydantic v2, strict) rejects instance-level
attribute patching (e.g. `patch("...tool.ainvoke", ...)`) since `ainvoke`
isn't a declared model field — tests that need to stub a tool's behavior
should patch the module-level name the tool is bound to, not an
attribute on the tool instance itself.
`redis.asyncio.Redis.from_url(...)` defaults to `decode_responses=False`,
returning stream field dicts with bytes keys/values (`b"envelope"`, not
`"envelope"`). Every Redis client used with this bus must be constructed
with `decode_responses=True`, or field lookups like `fields["envelope"]`
fail with KeyError despite the data being present.
Risk to mitigation: re-check both LangGraph and MCP versions again before 
decision gate, both are moving fast enough that a two-week-old
assumption is already a real risk. Rotate every dev-placeholder secret
(Keycloak client secrets, admin password) before this repo runs against
real data — none of the current values are production-safe.
# DocOrbit Product Specification

## 1. Product Identity

* **Name**: DocOrbit
* **Tagline**: The documentation intelligence layer for coding agents.
* **Core Abstraction**: **Documentation Intelligence**
  `Source Discovery → Documentation Model → Project Context → Task Context → Agent Context → Verification`
* **Target Audience**: AI coding agents (Claude Code, Cursor, Windsurf, Codex, Aider) and software engineers utilizing autonomous agent workflows.
* **Primary Modalities**:
  1. **CLI**: Fast, scriptable command-line interface (`apps/cli`).
  2. **MCP Server**: Native Model Context Protocol tools and resources (Milestone 5).
  3. **Local HTTP API & Web Dashboard**: Lightweight inspection UI (Milestone 7).

---

## 2. Product Principles

1. **Deterministic Core**: Never burn LLM tokens where deterministic parsing (OpenAPI, JSON schema, Markdown AST, regex, SemVer) produces bit-for-bit reliable results.
2. **Purpose-Driven Source Selection**: Different documentation formats serve different purposes. OpenAPI is optimal for API schemas; Markdown/llms.txt for mental models and guides; GitHub repositories for real-world examples.
3. **Project & Version Aware**: Anchor documentation context to the local repository's pinned dependency versions (`package.json`, `Cargo.lock`, `go.mod`).
4. **Token-Budgeted Context**: Maximize useful signal per token. Avoid dumping entire multi-megabyte docs into an agent's context window.
5. **Untrusted Documentation Model**: Treat all external documentation as untrusted data. Protect against SSRF, payload floods, and prompt injections through structural isolation and security annotations.
6. **Project-Scoped Storage by Default**: Index databases default to the local repository root (`.docorbit/docorbit.db`). If users or agents do not specify any flag, storage is strictly project-local to eliminate orphaned disk leaks and prevent cross-project version collisions. Global storage (`-g`) is explicitly opt-in.

---

## 3. Phased Roadmap

### Milestone 1: Core Documentation Intelligence (CURRENT)
- **Scope**:
  - Target URL input.
  - Pluggable discovery providers (`LlmsTxt`, `OpenApi`, `Markdown`, `Sitemap`, `Github`, `Skill`, `GenericWeb`).
  - Source validation (validating real structures vs. false positives).
  - Purpose-based source ranking (`navigation`, `conceptual`, `api`, `examples`, `implementation`).
  - Secure fetch engine with SSRF guard and streaming size limits.
  - Deterministic Markdown normalization and AST extraction (headings, links, code blocks, warnings).
  - Prompt injection annotation (without destructive regex stripping).
  - SQLite persistence (`sources`, `pages`, `links`, `code_examples`, `snapshots`).
  - CLI commands: `docorbit inspect <url> [--json]` and `docorbit add <url> [--json]`.
  - Comprehensive test suite with HTTP test fixtures A through J.

### Milestone 2: Semantic Slicing & Retrieval Foundation (COMPLETED)
- Markdown AST section-based chunking with heading hierarchy breadcrumbs.
- Atomic code block and warning/admonition preservation.
- Shallow deterministic symbol extraction (functions, classes, endpoints, config).
- Sequential, hierarchical, and semantic chunk relationship graph.
- SQLite + FTS5 full-text indexing with transaction triggers.
- Configurable & versioned scoring weights (`ScoringWeights`) and query intent detection.
- Context packing optimizing for relevance + coverage - redundancy within token budget.
- CLI: `docorbit search "<query>" [--type <t>] [--limit <n>]` and `docorbit context "<task>" [--tokens <n>]`.
- Benchmark evaluation suite with Precision@K, Recall@K, MRR, and 1k/10k chunk scaling.

### Milestone 3: Version Intelligence & Project Awareness (COMPLETED)
- Workspace scanner across 8 ecosystems (`npm`, `cargo`, `go`, `pypi`, `composer`, `rubygems`, `pub`, `maven`).
- Zero-dependency SemVer parsing, comparisons, range evaluation, and 6-stage confidence ladder (`exact` 1.0 → `major_minor` 0.95 → `major` 0.90 → `range` 0.85 → `latest_fallback` 0.50 → `unresolved` 0.0).
- Monorepo package directory tracking (`sourceFile`, `packagePath`) supporting multiple versions of the same package.
- Deterministic, churn-free `docs.lock` manifest: sorts keys alphabetically, isolates snapshot identity (`snapshotHash`) from retrieval timestamp (`retrievedAt`) to ensure bit-for-bit file equality across repeated runs.
- Project-aware `RetrievalEngine` boosting project versions (`+weights.versionBonus`), penalizing incompatible major versions, while preserving unversioned/latest docs as neutral supplemental context.
- CLI: `docorbit init [dir]`, `docorbit update [pkg]`, `--project <dir>`, and `--doc-version <ver>`.
- Multi-version conflict benchmark (Next.js 14 vs 15 vs 16).

### Milestone 4: Structured Implementation Knowledge (COMPLETED)
- Deep OpenAPI 3.0/3.1 and Swagger 2.0 parser with internal JSON pointer `$ref` resolution, parameters, request/response schemas, auth mechanisms, pagination heuristics, and deprecation flags.
- First-class code example indexing (`IndexedExample`) with framework detection (`next`, `react`, `express`, `fastapi`, `flask`, `django`, etc.), router calls, and authority tagging.
- Non-inferential pitfall & deprecation extraction (`Pitfall`): breaking changes, server-only/client-only restrictions, rate limits, security warnings.
- Evidence-grounded Implementation Recipe engine (`RecipeEngine`) compiling prerequisites, ordered steps, required APIs, code examples, pitfalls, and evidence-based validation steps.
- Strict evidence-grounding with explicit evidence-level markers (`documented_fact`, `inferred_relationship`, `missing_information`).
- CLI: `docorbit api <query>`, `docorbit examples <task>`, `docorbit pitfalls <task>`, `docorbit recipes <goal>`.
- 20-task knowledge benchmark across 11 categories (100% pass with strict evidence grounding).

### Milestone 5: Agent-Native MCP Integration (Completed)
- JSON-RPC 2.0 Stdio and Streamable HTTP (POST `/mcp`, GET `/sse`, GET `/health`) Model Context Protocol server conforming to MCP 2024-11-05.
- Centerpiece tool: `get_implementation_context` executing 9-stage pipeline (task → project/version resolution → intent → retrieval → APIs → examples → pitfalls → recipe → token-budgeted context → provenance).
- 8 Low-level tools: `search_docs`, `get_doc`, `find_api`, `find_example`, `find_pitfall`, `find_recipe`, `get_version`, `list_sources`.
- Dual format output (structured machine-readable JSON + concise agent-friendly Markdown).
- Explicit `untrusted: true` security boundaries on all external documentation data.
- Bounded MCP resource reads (`docorbit://sources`, `docorbit://pages/{pageId}`, `docorbit://chunks/{chunkId}`).
- CLI: `docorbit mcp [--stdio] [--port <port>] [--host <host>] [--db <path>] [--project <dir>]`.

### Milestone 6: Verification & Documentation Diffing (COMPLETED)
- Deterministic AST/pattern extraction (`CodeApiExtractor`) for JavaScript/TypeScript (`fetch`, `axios`, SDK calls, Next.js route params), Python (`requests`), and cURL/HTTP.
- Deterministic schema and contract verifier (`SchemaVerifier`) evaluating 8 rules without LLMs: `endpoint_validity`, `method_validity`, `required_parameters`, `deprecated_api`, `removed_api`, `version_mismatch`, `response_assumption`, `unsupported_syntax`.
- Four explicit verification statuses: `verified`, `warning`, `mismatch`, and `insufficient_evidence` (for unresolvable dynamic expressions or unsupported syntax).
- Semantic documentation diffing engine (`DocDiffEngine`): compares snapshots and versions, detecting added, removed, modified, and deprecated endpoints/pitfalls while ignoring formatting-only whitespace differences.
- Workspace impact analysis (`WorkspaceImpactScanner`): scans repository source files against diff results, pinpoints exact line, code snippet, matched pattern, traceable reason, and certainty ranking (`high`, `medium`, `heuristic`).
- Expanded MCP server from 9 to 12 native tools (`check_api`, `diff_docs`, `analyze_impact`) with dual JSON/Markdown output and provenance.
- Enhanced `get_implementation_context` with proactive `verificationHints`.
- CLI commands: `docorbit verify <code>`, `docorbit diff`, `docorbit impact`.

### Milestone 7: Web Dashboard & File Exports
- **Zero-Dependency Local HTTP Dashboard** (`DashboardServer` via native `node:http` on port 3737):
  - Read-only visual inspector: overview stats, indexed sources, active versions, untrusted documentation boundary.
  - Interactive API Explorer: filterable OpenAPI paths, HTTP methods, required parameters, and schemas.
  - Pitfalls & Warnings: severity badges (`error`, `warning`, `info`), kinds, breaking changes, and mitigations.
  - Code Examples: categorized by language and framework.
  - Interactive API Verifier: test code snippets in real-time against indexed schemas and version constraints.
  - REST JSON APIs: `/api/stats`, `/api/sources`, `/api/pages`, `/api/apis`, `/api/pitfalls`, `/api/examples`, `/api/docs-map`, `/api/export`, `/api/verify`, `/api/diff`, `/api/impact`.
- **Deterministic Agent Guidance Exporters** (`ExportService`):
  - `AGENTS.md`: Universal agent documentation rules, version matrix, verified API contracts, and critical pitfalls.
  - `CLAUDE.md`: Claude Code / Anthropic specific guidelines, verification CLI commands, and hard caveats.
  - `skill.md`: Structured agent skill format with YAML frontmatter and evidence-grounded recipes.
  - `llms.txt` / `llms-full.txt`: Standardized documentation summaries and full markdown aggregations.
  - `docs-map.md`: Hierarchical documentation tree with section breadcrumbs, chunk density, and token footprints.
- **Expanded Agent MCP Server**:
  - Expanded from 12 to 14 native tools by adding `get_documentation_map` and `export_agent_context`.
- **CLI Commands**:
  - `docorbit dashboard` (alias: `ui`)
  - `docorbit export [format] [--output <path>] [--stdout] [--doc-version <v>]`

---

## 4. Milestone 1 Detailed Specifications

### 4.1 CLI Experience
```bash
# Inspection (read-only, does not store full crawl)
docorbit inspect https://docs.example.com
docorbit inspect https://docs.example.com --json

# Ingestion (runs discovery, ranking, crawl, normalization, slicing, and local storage)
docorbit add https://docs.example.com
docorbit add https://docs.example.com --json

# Search documentation chunks (Milestone 2)
docorbit search "webhook signature verification"
docorbit search "verifySignature" --type code

# Pack documentation context for an agent task within token budget (Milestone 2)
docorbit context "Implement Stripe webhook signature verification in Node.js" --tokens 2000
```


### 4.2 Test Fixtures (HTTP Servers)
- **Fixture A**: Simple HTML documentation.
- **Fixture B**: HTML + `llms.txt`.
- **Fixture C**: HTML + `llms.txt` + `llms-full.txt`.
- **Fixture D**: HTML + OpenAPI / Swagger schema.
- **Fixture E**: Versioned documentation site.
- **Fixture F**: GitHub-style Markdown documentation.
- **Fixture G**: Malicious redirect attempting SSRF (e.g. redirecting to `169.254.169.254` or `127.0.0.1`).
- **Fixture H**: Prompt-injection payload inside documentation text.
- **Fixture I**: Broken sitemap and 404 links.
- **Fixture J**: Large response exceeding payload size limit.

---

## 5. Performance SLOs (Milestone 1)

| Metric | Target |
| :--- | :--- |
| **Inspect Latency** (Probing root sources) | < 1,500ms |
| **Single Page Fetch & Normalization (50KB)** | < 100ms |
| **Large Page Fetch & Normalization (500KB)** | < 350ms |
| **SQLite Storage Write per Page** | < 15ms |
| **CLI Cold Start** | < 40ms |

---

## Section 3.8 — Milestone 8: Real-World Agent Evaluation & Production Hardening

### Goals
Turn DocOrbit's design-time claims into measured, inspectable evidence; harden the system against real production failure modes.

### Evaluation Framework

**CLI**: `docorbit eval [--split train|eval|all] [--strategy docorbit|context7|web_search] [--task <id>] [--output <dir>] [--json] [--verbose]`

**Strategies**:
- `agent_docorbit` — real in-process `McpServer` + `get_implementation_context` pipeline against a seeded local SQLite database
- `agent_context7` — real `context7-mcp` stdio subprocess querying live `context7.com` backend (with offline simulation mode `--simulation` for CI)
- `agent_web_search` — direct HTTPS fetch to canonical official documentation URLs (with offline simulation mode `--simulation` for CI)

**Benchmark dataset**: 10 tasks across TypeScript/Next.js 14–15, JavaScript/Stripe v1/v3, Python/Pydantic v1–v2, Python/FastAPI 0.95–1.0, Rust/tokio-postgres, Go/gin-gonic — 4 train tasks used for integration validation, 6 held-out eval tasks never used during development.

**Measured metrics**: task success rate, correct version selection accuracy, retrieval precision@k, retrieval recall@k, mean token ingestion, context preparation latency, AST verification catches, false positives, `insufficient_evidence` rate.

**Artifacts**: every task result saved as raw JSON to `eval-results/raw/` with `isSimulation: boolean` auditability; summary JSON and Markdown report saved to `eval-results/summary_<timestamp>.*`.

**Important constraints** (hard requirements):
- No hardcoded expected winners in assertions
- No tuning DocOrbit against held-out eval tasks
- No claims of superiority unless measured data supports it
- Mode (`REAL` vs `SIMULATION`) clearly labeled in all outputs and JSON payloads


### Production Hardening Tests (9)

| Test | What it hardens |
| :--- | :--- |
| Large monorepo scan (20 packages) | Workspace scan completes in < 100ms regardless of package count |
| 10,000 chunk documentation set | FTS5 search and context packing both complete in < 50ms |
| 20 concurrent MCP calls | No races, deadlocks, or busy-lock failures under parallel load |
| Stale snapshot re-ingestion | ON CONFLICT DO UPDATE prevents ghost/duplicate chunks |
| Missing version graceful fallback | Unresolvable version returns `[]` not a crash |
| Malformed OpenAPI ingestion | Normalizer handles null paths, truncated YAML, empty objects without throwing |
| Dynamic/ambiguous code | `verifyCode` returns `insufficient_evidence` — zero false mismatches |
| Adversarial documentation | `detectSecurityAnnotations` flags prompt injections; normal content is clean |
| SQLite WAL rollback | Failed batch insert rolls back; previously committed chunks survive |


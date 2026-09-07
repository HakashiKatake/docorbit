# DocOrbit

> **The documentation intelligence layer for AI coding agents.**

DocOrbit bridges the gap between raw developer documentation websites and autonomous coding agents (Claude Code, Cursor, Codex, Windsurf, Devin, etc.). 

Instead of forcing coding agents to consume bloated HTML pages, guess API signatures, or drown in 200k-token sitemaps, DocOrbit discovers authoritative machine-readable specifications (`llms.txt`, OpenAPI, Agent Skills, raw Markdown), normalizes content into structured AST representations, guards against documentation-based prompt injection and SSRF attacks, and indexes documentation into a lightning-fast local SQLite database.

---

## The Problem: Why Scrapers Aren't Enough

| Approach | What It Does | Why It Fails Coding Agents |
| :--- | :--- | :--- |
| **Search APIs** (Tavily, Exa) | Returns top Google/Bing web search snippets | Outdated SEO spam, blog posts from 2021, missing full API types, high latency. |
| **Web Scrapers** (Firecrawl, Jina) | Converts raw browser DOM to Markdown | Dumps navigation chrome, headers, footers, cookie banners, lacks source hierarchy. |
| **Doc Aggregators** (Context7) | Pulls central `llms.txt` / curated repositories | Narrow scope, lacks multi-source ranking, lacks local offline-first SQLite FTS5 caching, lacks prompt injection annotations. |
| **DocOrbit** | **Full documentation intelligence pipeline** | Discovers machine-readable specs, ranks by agent purpose, strips boilerplate, detects prompt injections, isolates network threats, and stores structured ASTs with FTS5 search. |

---

## Architectural Principles

1. **Zero External Runtime Dependencies**: Built entirely with modern Node.js 24 ESM, native `--experimental-strip-types`, and built-in `node:sqlite`. No bloated npm dependencies, no native toolchain compilation, cold boot in < 40ms.
2. **Authority-Driven Source Discovery**: Automatically probes and prioritizes `llms-full.txt` > `openapi.json` > `llms.txt` > `skill.md` > raw Markdown > GitHub > HTML sitemaps.
3. **Purpose-Aware Source Ranking**: Intelligently re-ranks available sources based on the agent's immediate intent (`navigation`, `conceptual`, `api`, `examples`, `implementation`).
4. **Security-Hardened Ingestion**:
   - **SSRF Prevention**: Prohibits private IP ranges (RFC 1918, RFC 4193), loopback (`127.0.0.1`), link-local, and cloud metadata endpoints (`169.254.169.254`) on all requests and redirect hops.
   - **Non-Destructive Security Annotations**: Detects suspicious instructions (prompt injection, exfiltration attempts, command execution triggers) in external documentation and tags them in metadata without mutating the text.
   - **Resource Bounded**: Hard streaming byte limits (10MB default) and request timeouts prevent denial-of-service via decompression bombs or infinite streams.
5. **Offline-First Structured Storage**: Powered by SQLite in WAL mode with relational tables for sources, pages, links, code examples, snapshots, and an FTS5 full-text search index.

---

## Directory Structure

```text
docorbit/
├── apps/
│   └── cli/                      # Command-line interface (inspect, add, formatters)
├── bin/
│   └── docorbit.js              # Executable entry point
├── docs/                         # Specification & deep research
│   ├── architecture.md           # Full system architecture
│   ├── competitive-analysis.md   # Competitive breakdown vs Context7, Firecrawl, etc.
│   ├── product-spec.md           # Product requirements & 7-milestone roadmap
│   └── research.md               # Research on ecosystem capabilities
├── packages/
│   ├── core/                     # Inspection coordinator & IngestionPipeline
│   ├── crawler/                  # SecureFetcher with SSRF validation & streaming limits
│   ├── discovery/                # 7 discovery providers + purpose-based ranker
│   ├── normalizer/               # HTML-to-Markdown, OpenAPI parser, llms.txt parser
│   ├── security/                 # SSRF validator & security annotation detector
│   ├── shared/                   # TypeScript domain types, hashing, errors
│   └── storage/                  # SQLite schema, WAL setup, and repository
└── tests/
    ├── fixtures/                 # In-memory WHATWG fetch server (Fixtures A–J)
    ├── integration/              # Real-world fixture pipeline & benchmark tests
    └── unit/                     # Focused unit tests across all packages
```

---

## Getting Started

### Requirements
- **Node.js 24.0.0+** (utilizes native `--experimental-strip-types` and `node:sqlite`)
- **No `npm install` needed** for core runtime!

### Installation
Clone the repository and link or run directly:

```bash
# Clone repository
git clone https://github.com/your-org/docorbit.git
cd docorbit

# Run CLI directly
node --experimental-strip-types bin/docorbit.js --help
```

---

## CLI Usage

### 1. Inspect Documentation Sources (`inspect`)

Probes a target documentation URL to discover and rank all available machine-readable and human-readable documentation endpoints:

```bash
node --experimental-strip-types bin/docorbit.js inspect https://mintlify.com/docs
```

Sample Terminal Output:
```text
DocOrbit — Documentation Source Discovery
Target URL: https://mintlify.com/docs
Discovered Sources: 9 total (7 machine-readable)

Machine-Readable Documentation Sources:
  1. llms_full_txt (llms-full.txt)
     URL:        https://mintlify.com/docs/llms-full.txt
     Authority:  authoritative | Confidence: 95%
     Metadata:   {"description":"Full AI-native documentation bundle"}

  2. openapi (OpenAPI Specification)
     URL:        https://mintlify.com/docs/openapi.json
     Authority:  authoritative | Confidence: 95%
     Metadata:   {"description":"REST API OpenAPI specification"}

  3. llms_txt (llms.txt)
     URL:        https://mintlify.com/docs/llms.txt
     Authority:  authoritative | Confidence: 90%
...
```

For JSON output (ideal for feeding into scripts or coding agents):
```bash
node --experimental-strip-types bin/docorbit.js inspect https://mintlify.com/docs --json
```

### 2. Ingest Documentation (`add`)

Fetches, normalizes, extracts code blocks, tokenizes, and stores the documentation into your local SQLite database:

```bash
node --experimental-strip-types bin/docorbit.js add https://mintlify.com/docs --max-pages 5
```

Sample Output:
```text
DocOrbit — Documentation Ingested Successfully
Target URL:  https://mintlify.com/docs
Snapshot ID: snap_ca92c2c785b1739d
Duration:    2833ms

Ingested Pages (4):
  1. Documentation
     URL:    https://www.mintlify.com/docs
     Tokens: ~138 | Code blocks: 0 | Hash: 4a5f740d
  2. Mintlify External API (OpenAPI 3.0.1)
     URL:    https://www.mintlify.com/docs/openapi.json
     Tokens: ~3687 | Code blocks: 1 | Hash: ff65050a
  3. AI-native documentation
     URL:    https://www.mintlify.com/docs/llms-full.txt
     Tokens: ~391390 | Code blocks: 746 | Hash: 4104aa48
  4. Install the CLI
     URL:    https://www.mintlify.com/docs/cli/install
     Tokens: ~1538 | Code blocks: 10 | Hash: 21fe04e7

Ingestion Summary:
  Total Pages:            4
  Total Raw Bytes:        2428.7 KB
  Estimated Tokens:       ~396753
  Total Code Examples:    757
  Machine-readable types: 7
```

### 3. Search Documentation Chunks (`search`)

Execute deterministic hybrid search combining FTS5 lexical ranking, exact phrases, heading hierarchy breadcrumbs, shallow symbol detection, and query intent weighting:

```bash
node --experimental-strip-types bin/docorbit.js search "webhook signature verification"
node --experimental-strip-types bin/docorbit.js search "verifySignature" --type code
node --experimental-strip-types bin/docorbit.js search "POST /v1/webhook_endpoints" --json
```

Sample Output:
```text
DocOrbit — Search Results for: "webhook signature verification"
════════════════════════════════════════════════════════════════
  1. Signature Verification > Example Code (Score: 32.45)
     Type: code | Est. Tokens: ~120 | Chunk: chk_a1b2c3d4
     Matches: BM25 base (14.45) • Exact phrase match (+5.0) • Title match [verification] (+8.0) • Intent alignment 'examples' (+6.0)
     Symbols: verifyWebhookSignature, constructEvent
     │ ```typescript
     │ export function verifyWebhookSignature(payload: string, headerSig: string, secret: string) {
     │   const event = stripe.webhooks.constructEvent(payload, headerSig, secret);
```

### 4. Pack Agent Task Context (`context`)

Assembles a structured, high-signal documentation package optimized for autonomous coding agents, optimizing for relevance + coverage - redundancy under strict token budgets:

```bash
node --experimental-strip-types bin/orbit.js context "Implement Stripe webhook signature verification in Node.js" --tokens 2000
```

Sample Output:
```text
DocOrbit — Assembled Context Package
════════════════════════════════════════════════════════════════
Task:             Implement Stripe webhook signature verification in Node.js
Detected Intent:  examples
Estimated Tokens: ~850 / 2000 (heuristic)
Chunks Included:  4
Sources Cited:    https://docs.stripe.com/webhooks/signatures

Package Markdown Preview:
────────────────────────────────────────────────────────────────
# Context Package: Implement Stripe webhook signature verification in Node.js
- **Detected Intent**: `examples`
- **Estimated Tokens**: ~850 / 2000 tokens (heuristic estimate)
- **Sources Included**: [https://docs.stripe.com/webhooks/signatures](https://docs.stripe.com/webhooks/signatures)

---

### Signature Verification > Verification Overview
*Type: `prose` | Est. Tokens: ~180*
Verify event signatures using HMAC-SHA256 to ensure webhook notifications originated from Stripe...
```

---

### 5. Workspace Dependency Detection & Lockfile (`init`)

Scan project manifests across 8 ecosystems (`npm`, `cargo`, `go`, `pypi`, `composer`, `rubygems`, `pub`, `maven`), correlate with lockfiles, resolve against ingested documentation versions, and generate a deterministic `docs.lock`:

```bash
node --experimental-strip-types bin/docorbit.js init .
```

Sample Output:
```text
=== DocOrbit Project Initialization ===
Workspace Root:  /path/to/my-app
Ecosystems:     npm
Manifests:       package.json, package-lock.json
Dependencies:    18 detected
Locked Docs:     1 dependencies resolved to documentation

-----------------------------------------------------------------------------
| Package               | Project Ver | Doc Ver  | Match       | Confidence |
-----------------------------------------------------------------------------
| next                  | 14.2.3      | v14      | major       | 90%        |
-----------------------------------------------------------------------------

Generated deterministic docs.lock at: /path/to/my-app/docs.lock
```

### 6. Refresh Locked Documentation (`update`)

Selectively update specific dependencies or globally re-sync documentation versions while preserving timestamps on unchanged entries:

```bash
node --experimental-strip-types bin/docorbit.js update next
```

### 8. API Intelligence & Structured Schemas

Query parsed OpenAPI 3.x / Swagger 2.0 endpoints with parameters, JSON request/response schemas, authentication mechanisms, pagination heuristics, and deprecation markers:

```bash
# Query endpoints by path, operation, or action
node --experimental-strip-types bin/docorbit.js api "create webhook endpoint"
node --experimental-strip-types bin/docorbit.js api "/v1/webhook_endpoints" --method POST
```

### 9. Code Example Intelligence

Find first-class code snippets classified by language and detected framework (`next`, `react`, `express`, `fastapi`, `flask`, `django`, `spring`, `gin`):

```bash
# Query code examples for a specific framework or task
node --experimental-strip-types bin/docorbit.js examples "verify signature" --framework express
node --experimental-strip-types bin/docorbit.js examples "FastAPI webhook" --language python
```

### 10. Pitfalls, Deprecations & Runtime Restrictions

Inspect explicit admonitions, deprecation notices, breaking changes, rate limit caveats, and runtime boundary restrictions (`server_only`, `client_only`):

```bash
# Query pitfalls for a task or filter by kind
node --experimental-strip-types bin/docorbit.js pitfalls "route params" --kind deprecated
node --experimental-strip-types bin/docorbit.js pitfalls "secret" --kind server_only
```

### 11. Evidence-Grounded Implementation Recipes

Compile deterministic, traceable recipes that connect prerequisites, ordered steps, code examples, pitfalls, and evidence-based validation assertions directly from indexed documentation:

```bash
# Assemble recipe for a goal with strict evidence grounding
node --experimental-strip-types bin/docorbit.js recipes "create webhook endpoint" --doc-version v1
node --experimental-strip-types bin/docorbit.js recipes "Next.js dynamic routes" --project .
```

### 12. Deterministic Code Verification (`verify`)

Statically verifies agent-generated or workspace code against indexed OpenAPI schemas, parameters, required request body fields, deprecations, removed APIs, and version boundaries:

```bash
# Verify code string against resolved project documentation
node --experimental-strip-types bin/docorbit.js verify "fetch('https://api.stripe.com/v1/webhook_endpoints', { method: 'POST', body: JSON.stringify({ url: 'https://example.com' }) })" --version v14

# Output structured JSON verdict and findings
node --experimental-strip-types bin/docorbit.js verify "fetch('/v1/charges', { method: 'POST' })" --json
```

Sample Terminal Output:
```text
DocOrbit — API Schema Verification
Verdict: ❌ MISMATCH (Confidence: 95%)

Findings (1):
  1. [ERROR] (required_parameters) Missing required body field "enabled_events" for "POST /v1/webhook_endpoints"
     Evidence: Endpoint ID ep_post_webhooks_v14
     Expected: ["enabled_events"]
     Actual:   missing
```

### 13. Semantic Documentation Diffing (`diff`)

Compares documentation versions or snapshots, pinpointing added, modified, removed, and deprecated API endpoints and breaking pitfalls while ignoring formatting-only whitespace churn:

```bash
# Diff documentation between two versions
node --experimental-strip-types bin/docorbit.js diff --from v14 --to v15

# Diff between specific snapshots with JSON output
node --experimental-strip-types bin/docorbit.js diff --from snap_001 --to snap_002 --json
```

Sample Terminal Output:
```text
DocOrbit — Documentation Diff
From: v14 → To: v15

Summary:
  Endpoints Added:      1
  Endpoints Removed:    1
  Endpoints Modified:   1
  Pitfalls Added:       1

API Endpoint Changes:
  • [🔴 REMOVED]    POST /v1/charges (Charges API permanently removed)
  • [🔵 MODIFIED]   GET /v1/users (Added query parameter "starting_after")
  • [🟢 ADDED]      POST /v1/payment_intents (Create a PaymentIntent)

Pitfall & Breaking Changes:
  • [⚠️ NEW] breaking_change: Next.js 15: Asynchronous Route Parameters
```

### 14. Workspace Impact Analysis (`impact`)

Scans your repository workspace source files against documentation diffs, pinpointing exact files, lines, code snippets, matched patterns, and certainty rankings (`high`, `medium`, `heuristic`):

```bash
# Analyze impact of documentation upgrade on current project
node --experimental-strip-types bin/docorbit.js impact . --from v14 --to v15
```

Sample Terminal Output:
```text
DocOrbit — Project Impact Analysis
Scanned Workspace: /path/to/my-project
Files Scanned:     24
Impacted Files:    2
Total Locations:   2

Impacted Files & Locations:
  1. src/services/billing.ts:42 (High Certainty, 95% confidence)
     Reason: Endpoint "POST /v1/charges" was removed in API documentation.
     Matched Pattern: /v1/charges
     Code:
       const res = await fetch('https://api.stripe.com/v1/charges', { method: 'POST' });

  2. app/blog/[slug]/page.tsx:8 (Medium Certainty, 85% confidence)
     Reason: Synchronous route parameter access detected. Documentation deprecation notice: Next.js 15: Asynchronous Route Parameters
     Matched Pattern: params.
     Code:
       const slug = params.slug;
```

### 15. Local Web Dashboard & Inspector (`dashboard` / `ui`)

Launch an embedded, zero-dependency local web dashboard powered by native `node:http` (port 3737) to inspect indexed documentation, OpenAPI specifications, version matrices, pitfalls, and code examples, and run interactive code verifications:

```bash
# Start local dashboard server on http://127.0.0.1:3737/
node --experimental-strip-types bin/docorbit.js dashboard

# Or specify custom port
node --experimental-strip-types bin/docorbit.js dashboard --port 8080
```

Key Dashboard Capabilities:
- **Visual Overview & Health**: Live counts of indexed sources, pages, chunks, APIs, pitfalls, active documentation versions, and storage stats with explicit `untrusted: true` boundary markers.
- **Interactive API Explorer**: Filterable by HTTP method, path, and version tag, displaying parameter requirements and JSON schemas.
- **Critical Pitfalls & Caveats**: Color-coded by severity (`error`, `warning`, `info`) and category (`deprecated`, `removed`, `server_only`, `rate_limit`, `security`).
- **Curated Code Examples**: Categorized by framework and language.
- **Interactive API Verifier**: Test code snippets in real-time against indexed schemas, parameter constraints, and version rules.
- **Documentation Map & Token Tree**: Visual breakdown of page hierarchy, headings, and token allocation footprints.
- **Export Center**: One-click preview and clipboard copy for `AGENTS.md`, `CLAUDE.md`, `skill.md`, `llms.txt`, and `docs-map.md`.

### 16. Deterministic Agent Guidance Exporters (`export`)

Generate reproducible, version-grounded agent configuration and context files directly from indexed documentation and workspace package manifests:

```bash
# Export universal AGENTS.md guide to workspace root
node --experimental-strip-types bin/docorbit.js export agents.md

# Export Claude Code / Anthropic specific CLAUDE.md
node --experimental-strip-types bin/docorbit.js export claude.md

# Export structured agent skill definition
node --experimental-strip-types bin/docorbit.js export skill.md

# Export standard llms.txt index
node --experimental-strip-types bin/docorbit.js export llms.txt

# Export hierarchical documentation map
node --experimental-strip-types bin/docorbit.js export docs-map.md

# Output directly to stdout or custom destination
node --experimental-strip-types bin/docorbit.js export agents.md --stdout
node --experimental-strip-types bin/docorbit.js export agents.md --output docs/AGENTS.md --doc-version v14
```

### 17. Model Context Protocol (MCP) Server (`mcp`)

Start DocOrbit as an agent-native MCP server communicating via JSON-RPC 2.0. Coding agents (Claude Code, Cursor, Windsurf, OpenCode) can interact over standard input/output (`stdio`) or Streamable HTTP:

```bash
# Start in Stdio mode (for CLI agents like Claude Code, Cursor, OpenCode)
node --experimental-strip-types bin/docorbit.js mcp --stdio

# Or start in Streamable HTTP mode (supports POST /mcp, GET /sse, GET /health)
node --experimental-strip-types bin/docorbit.js mcp --port 3000 --host 127.0.0.1
```

#### The 14 Agent-Native Tools:

| Tool Name | Type | Description |
| :--- | :--- | :--- |
| `get_implementation_context` | **High-Level Centerpiece** | Orchestrates task → project/dependency detection → version resolution → intent → retrieval → APIs → examples → pitfalls → recipe → token-budgeted context → provenance → verification hints. |
| `check_api` | Verification | Deterministically checks code against indexed OpenAPI schemas, parameters, required body fields, deprecations, and version contracts. |
| `diff_docs` | Intelligence | Compares documentation versions/snapshots to detect added, removed, modified, and deprecated endpoints/pitfalls. |
| `analyze_impact` | Intelligence | Scans workspace project files for breaking changes and deprecated APIs, returning line, snippet, and certainty. |
| `get_documentation_map` | Structure | Retrieves the hierarchical documentation tree, section headings, and token footprints. |
| `export_agent_context` | Agent Export | Generates `AGENTS.md`, `CLAUDE.md`, `skill.md`, `llms.txt`, and `docs-map.md` grounded in project versions. |
| `search_docs` | Low-Level | Hybrid FTS5 retrieval over indexed documentation chunks with version boosting. |
| `get_doc` | Low-Level | Retrieves a specific document chunk or complete page by ID with untrusted annotations. |
| `find_api` | Low-Level | Inspects OpenAPI endpoints with parameters, request/response schemas, and auth. |
| `find_example` | Low-Level | Discovers verified code examples filtered by framework, language, and task. |
| `find_pitfall` | Low-Level | Finds deprecations, breaking changes, rate limits, and server-only restrictions. |
| `find_recipe` | Low-Level | Compiles evidence-grounded blueprints with documented fact vs inferred steps. |
| `get_version` | Low-Level | Reconciles workspace dependencies using the hierarchical SemVer confidence ladder. |
| `list_sources` | Low-Level | Lists indexed documentation sources, snapshots, and machine-readability status. |

#### Agent Configuration Examples:

**For Claude Code / Claude Desktop (`claude_desktop_config.json`):**
```json
{
  "mcpServers": {
    "docorbit": {
      "command": "node",
      "args": ["--experimental-strip-types", "/path/to/docorbit/bin/docorbit.js", "mcp", "--stdio"]
    }
  }
}
```

**For Cursor (`.cursor/mcp.json`):**
```json
{
  "mcpServers": {
    "docorbit": {
      "command": "node",
      "args": ["--experimental-strip-types", "/path/to/docorbit/bin/docorbit.js", "mcp", "--stdio"]
    }
  }
}
```

---

## Performance Benchmarks

DocOrbit is designed to run in CI/CD pipelines and local developer machines with negligible overhead.

### Milestone 1 Ingestion & Normalization
| Documentation Size | Normalization Latency | SQLite Storage Latency | Total Processing Time |
| :--- | :--- | :--- | :--- |
| **50 KB Page** | ~7.2 ms | ~0.5 ms | **~7.7 ms** |
| **500 KB Page** | ~13.8 ms | ~1.8 ms | **~15.6 ms** |
| **5 MB Spec / Page** | ~125.5 ms | ~17.4 ms | **~142.9 ms** |

- **Batch Ingestion Rate**: ~72 ms for 50 pages (**~1.4 ms per page**).
- **Memory Footprint**: Heap allocation delta strictly bounded (< 65 MB peak for 5MB payloads).

### Milestone 2 Retrieval & Scaling Benchmarks
Tested with 8 evaluation categories (conceptual, API, examples, configuration, troubleshooting, migration, and negative queries):

| Evaluation Metric | Measured Value | Standard Target |
| :--- | :--- | :--- |
| **Precision@3** | **0.833** | >= 0.75 |
| **Recall@3** | **0.875** | >= 0.75 |
| **Mean Reciprocal Rank (MRR)** | **1.000** | >= 0.75 (Rank 1 ground truth on all queries) |
| **Token Efficiency** | **21.6%** | High-signal core snippets packed under budget |

Scaling Performance across SQLite FTS5 Index:
- **1,000 Chunks**: Ingestion 244 ms (0.24 ms/chunk), Search query latency **1.21 ms**, Context packing latency **4.36 ms**.
- **10,000 Chunks**: Search query latency **4.58 ms**, Context packing latency **7.04 ms**, Total Heap **15.8 MB**.

### Milestone 3 Version Disambiguation Benchmark
Tested across multi-version conflict environments (Next.js 14 project vs Next.js 14, 15, and 16 documentation chunks):

| Metric / Scenario | Result | Evaluation |
| :--- | :--- | :--- |
| **Next.js 14 Project Query** | Rank 1: `v14` (Score: 17.43) | **100% Accuracy** (v14 accurately preferred over v15/v16) |
| **Incompatible Major Penalty** | `v15` (Score: -1.90), `v16` (Score: -3.23) | Clear score separation penalizes breaking major versions |
| **Supplemental Context** | `latest` (Score: 7.43) | Neutral retention of unversioned deployment documentation |
| **docs.lock Determinism** | Bit-for-bit identical on repeated runs | **Zero git churn**; timestamps preserved for unchanged snapshots |

### Milestone 4 Implementation Knowledge Benchmark
Evaluated across 20 tasks spanning 11 categories (API lookup, parameter constraints, schema precision, auth recognition, pagination heuristics, framework matching, deprecations, runtime restrictions, rate limits, recipe evidence grounding, and multi-version conflicts):

| Benchmark Category | Tasks | Status | Key Verification Point |
| :--- | :--- | :--- | :--- |
| **1. API Lookup** | 2 | 100% PASS | Exact method/path and natural language fuzzy matching |
| **2. Parameter Extraction** | 2 | 100% PASS | Path parameters and required query parameters extracted |
| **3. Schema Precision** | 1 | 100% PASS | Request and response properties parsed with internal `$ref` |
| **4. Auth Recognition** | 1 | 100% PASS | Header/bearer/basic authentication identification |
| **5. Pagination Discovery** | 1 | 100% PASS | Heuristic detection of cursor and offset/limit pagination |
| **6. Example Matching** | 2 | 100% PASS | Framework-specific Express and FastAPI code matching |
| **7. Deprecation Detection** | 3 | 100% PASS | API endpoint deprecations, v15 deprecated, v16 removed |
| **8. Runtime Restrictions** | 1 | 100% PASS | Strict extraction of `server_only` secret isolation |
| **9. Rate Limits & Security** | 1 | 100% PASS | Extraction of HTTP 429 warnings and security caveats |
| **10. Recipe Grounding** | 4 | 100% PASS | Prerequisites, steps, validation schemas strictly grounded; missing information flagged without assumptions |
| **11. Version Conflict** | 2 | 100% PASS | Dynamic route params correctly resolved for v14 sync vs v15 async |

- **Overall Accuracy**: **20/20 (100.0%)**
- **Strict Evidence Grounding**: **100%** (Undocumented tasks yield explicit `missing_information` and confidence 0.0)

---

## Test Suite & Verification

The test suite runs 100% hermetically without network access using a custom in-memory WHATWG fetch server mocking real-world edge cases.

To run the complete test suite:

```bash
npm test
```

### Covered Test Matrix (105 Tests Passing)
- **Unit & Hardening Tests (79 Tests)**:
  - `verification.test.ts`: Deterministic AST/token extraction (JS/TS, Python, cURL), valid endpoint verification, invalid path detection, wrong HTTP method detection, missing required body field/query parameters, deprecated API warning with provenance, Next.js version conflict detection, and dynamic/unsupported expression handling (`insufficient_evidence`).
  - `diff.test.ts`: Endpoint additions, removals, modifications, parameter diffs, pitfall diffs across versions, and whitespace-invariant semantic chunk diffing.
  - `impact.test.ts`: Workspace impact scanning, affected file pinpointers, exact line numbers, code snippets, matched patterns, and certainty rankings (`high`, `medium`, `heuristic`).
  - `mcp.test.ts`: MCP tool factory (12 native tools), schema compliance, JSON-RPC protocol error handling, resource manager bounded reads, and individual tool execution.
  - `openapi.test.ts`: OpenAPI 3.0/3.1 and Swagger 2.0 parsing, circular `$ref` recursion defense, auth schemes, and pagination heuristics.
  - `examples.test.ts`: Framework identification (`next`, `express`, `fastapi`, etc.), symbol detection, and language filtering.
  - `pitfalls.test.ts`: Extraction of admonitions, deprecation tags, server-only restrictions, and rate limit warnings.
  - `recipes.test.ts`: Evidence-grounded recipe compilation, prerequisite extraction, evidence-based validation assertions, and missing information handling.
  - `semver.test.ts`: SemVer parsing, comparisons, range satisfaction, and hierarchical confidence ladder.
  - `workspace.test.ts`: Manifest scanning across 8 ecosystems, lockfile extraction, monorepos, and deterministic `docs.lock`.
  - `slicer.test.ts`: Heading hierarchy breadcrumbs, atomic code blocks, and shallow symbol extraction.
  - `retrieval.test.ts`: Intent detection, transactional FTS5 synchronization with triggers, scoring weights, and context packing.
  - `hardening.test.ts`: IPv6 bracketed SSRF prevention, redirect loops, snapshot idempotency, `CrawlPolicy` depth bounds, and prompt injection annotations.
  - `security.test.ts`: SSRF defense, loopback & private IP blocking, non-destructive prompt injection tagging.
  - `discovery.test.ts`: LLMs.txt, OpenAPI, Sitemap, Markdown, GitHub, and Skill providers.
  - `ranker.test.ts`: Purpose-based ranking logic (`navigation`, `api`, `examples`, `implementation`).
  - `normalizer.test.ts`: HTML to Markdown conversion, code block extraction, OpenAPI schema detection, content hashing stability.
  - `storage.test.ts`: SQLite schema initialization, cascading foreign keys, WAL mode, FTS5 full-text indexing, and snapshot page membership.
- **Integration & Benchmark Tests (26 Tests)**:
  - `verification-e2e.test.ts`: End-to-end coding agent workflow over MCP: `get_implementation_context` with verification hints → `check_api` catching removed API, invalid HTTP method, missing required body field → ambiguous dynamic call returning `insufficient_evidence` → valid corrected code returning `verified` → `diff_docs` detecting breaking API/pitfall changes → `analyze_impact` locating affected project files with high certainty.
  - `mcp-e2e.test.ts`: Full realistic coding agent lifecycle over MCP (tools/list → `get_implementation_context` → targeted follow-ups `find_pitfall`, `get_doc`, `find_example` → resource inspection).
  - `mcp-transports.test.ts`: Stdio transport batching/single request/isolated stderr logs and Streamable HTTP transport (POST `/mcp` JSON & SSE stream, GET `/sse`, GET `/health`).
  - `knowledge-benchmark.test.ts`: 20-task structured knowledge benchmark across 11 categories (100% pass).
  - `version-benchmark.test.ts`: Next.js 14 vs 15 vs 16 version conflict resolution, score separation, and context packaging under project awareness.
  - `retrieval-benchmark.test.ts`: 8-category evaluation benchmark (P@K, R@K, MRR) + 1k and 10k chunk latency and memory scaling tests.
  - `fixtures.test.ts`: Fixtures A through J end-to-end crawl, normalization, chunking, and FTS retrieval verification.
  - `cli.test.ts`: `--help`, `--version`, `--json`, `init`, `update`, `inspect`, `add`, `search`, `context`, `api`, `examples`, `pitfalls`, and `recipes` command validation.
  - `benchmark.test.ts`: 50KB, 500KB, 5MB latency and memory profiling.

---

## 7-Milestone Roadmap

- [x] **Milestone 1: Ingestion, Normalization, Security, & Local SQLite** *(Completed)*
  - Source discovery (`llms.txt`, OpenAPI, Sitemap, GitHub, Markdown, Skill)
  - Purpose-aware source ranker
  - SSRF protection & security annotations
  - HTML & spec normalizer to structured AST
  - Node.js 24 SQLite storage with WAL & FTS5
  - CLI `inspect` and `add`
- [x] **Milestone 2: Semantic Slicing & Retrieval Foundation** *(Completed)*
  - Markdown AST section-based chunking with heading hierarchy breadcrumbs
  - Indivisible code fences and warning/admonition preservation
  - Shallow deterministic symbol extraction (functions, classes, endpoints, config)
  - Sequential, hierarchical, and semantic chunk relationship graph
  - Transactionally synchronized FTS5 indexing with triggers
  - Configurable/versioned scoring weights and deterministic query intent detection
  - Relevance + Coverage - Redundancy token budget context packing
  - CLI `search` and `context`
  - Evaluation benchmark dataset (Precision@K, Recall@K, MRR, 1k/10k scaling)
- [x] **Milestone 3: Version Intelligence & Project Awareness** *(Completed)*
  - Workspace scanner for 8 ecosystems (`npm`, `cargo`, `go`, `pypi`, `composer`, `rubygems`, `pub`, `maven`)
  - SemVer confidence ladder (`exact` → `major_minor` → `major` → `range` → `latest_fallback` → `unresolved`)
  - Reproducible `docs.lock` manifest with timestamp preservation (zero git churn)
  - Project-aware `RetrievalEngine` with version bonus and major-discrepancy penalties
  - CLI `init`, `update`, `--project`, and `--doc-version`
  - Multi-version conflict benchmark (Next.js 14 vs 15 vs 16)
- [x] **Milestone 4: Structured Implementation Knowledge** *(Completed)*
  - OpenAPI 3.x and Swagger 2.0 parser with JSON pointer `$ref` resolution, schemas, parameters, auth, pagination heuristics, and deprecation flags
  - First-class code example indexer with framework detection and router call parsing
  - Explicit pitfall and deprecation extractor (breaking changes, server-only restrictions, rate limits, security warnings)
  - Evidence-grounded Implementation Recipe engine with explicit evidence levels (`documented_fact`, `inferred_relationship`, `missing_information`)
  - CLI `api`, `examples`, `pitfalls`, and `recipes`
  - 20-task knowledge benchmark across 11 categories (100% pass)
- [x] **Milestone 5: Agent-Native MCP Integration** *(Completed)*
  - JSON-RPC 2.0 Stdio and Streamable HTTP (POST `/mcp`, GET `/sse`, GET `/health`) server conforming to MCP 2024-11-05
  - High-level centerpiece tool `get_implementation_context` orchestrating 9-stage pipeline
  - Dual response format: Structured JSON (`data`) + Concise agent Markdown (`markdown`)
  - Explicit `untrusted: true` security boundary tagging on all retrieved documentation
  - Dynamic MCP Resources with bounded streaming reads (`docorbit://sources`, `docorbit://pages/{id}`, `docorbit://chunks/{id}`)
  - CLI `docorbit mcp [--stdio] [--port 3000] [--host 127.0.0.1]`
- [x] **Milestone 6: Verification & Documentation Diffing** *(Completed)*
  - Deterministic AST and pattern code extractor (`CodeApiExtractor`) for JS/TS, Python, and cURL
  - Deterministic schema and version verifier (`SchemaVerifier`) evaluating 8 rules without LLMs
  - Strict verification statuses (`verified`, `warning`, `mismatch`, `insufficient_evidence`)
  - Documentation diffing engine (`DocDiffEngine`) detecting endpoint and pitfall changes across versions/snapshots
  - Workspace impact analyzer (`WorkspaceImpactScanner`) reporting affected files, lines, snippets, and certainty
  - Expanded MCP server with 12 native tools (`check_api`, `diff_docs`, `analyze_impact`)
  - Proactive `verificationHints` delivered in `get_implementation_context`
  - CLI commands: `docorbit verify <code>`, `docorbit diff`, `docorbit impact`
- [x] **Milestone 7: Web Dashboard & Agent File Exports** *(Completed)*
  - Local read-only dashboard via native `node:http` — no framework dependency
  - Single-page HTML dashboard for sources, snapshots, APIs, pitfalls, verification results, diffs, and impact
  - REST API layer at `/api/*` backed entirely by existing application services
  - Deterministic agent file exports: `AGENTS.md`, `CLAUDE.md`, `skill.md`, `llms.txt`, `docs-map.md`
  - Exports are reproducible: derived from indexed evidence, no runtime timestamps
  - MCP tools: `get_documentation_map` and `export_agent_context` (14 tools total)
  - CLI `docorbit dashboard` / `docorbit ui`, `docorbit export`
- [x] **Milestone 8: Real-World Agent Evaluation & Production Hardening** *(Completed)*
  - Empirical benchmark comparing DocOrbit vs Context7 vs Web Docs Fetch across 10 tasks (4 train, 6 held-out) in 5 ecosystems
  - **Real Context7 MCP integration**: spawns `context7-mcp` stdio child process querying live `context7.com` backend
  - **Real Web Docs Fetch baseline**: direct HTTPS fetches to canonical official documentation URLs
  - **Real DocOrbit MCP integration**: in-process `McpServer` executing the full `get_implementation_context` pipeline
  - **Deterministic offline simulation mode** (`--simulation`): runs offline CI regression without network dependencies
  - Metrics: task success rate, version accuracy, retrieval precision/recall, token usage, latency, AST catches, false positives
  - 9 production hardening tests: large monorepo scan, 10k chunk sub-50ms search, 20 concurrent MCP calls, stale snapshots, missing version graceful fallback, malformed OpenAPI, dynamic code `insufficient_evidence`, adversarial prompt injection, SQLite rollback consistency
  - CLI `docorbit eval` with `--split`, `--strategy`, `--task`, `--output`, `--json`, `--verbose`, `--simulation`
  - Raw benchmark artifacts saved to `eval-results/raw/` with `isSimulation` flag — every run independently auditable
  - No hardcoded winners; real results measured and auditable from saved JSON payloads



---

## License

MIT License. See [LICENSE](LICENSE) for details.

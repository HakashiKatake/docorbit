# DocOrbit Architecture & Systems Design

## 1. Core Abstraction: Documentation Intelligence

DocOrbit is an **Agent Documentation Operating Layer**. Rather than a flat document scraper or generic vector search engine, its architecture derives entirely from a single unified abstraction: **Documentation Intelligence**.

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                     THE DOCUMENTATION INTELLIGENCE CHAIN                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. Source Discovery    Detect machine-readable & canonical doc endpoints    │
│            ↓                                                                │
│  2. Documentation Model Deterministic, normalized, typed representation       │
│            ↓                                                                │
│  3. Project Context     Reconciles local repo dependencies & docs.lock      │
│            ↓                                                                │
│  4. Task Context        Assembles purpose-driven packages within token budget│
│            ↓                                                                │
│  5. Agent Context       Surfaces structured tools to MCP, CLI, and agents   │
│            ↓                                                                │
│  6. Verification Loop   Validates generated code against authoritative specs │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

The AI coding agent interacts with this intelligence layer without needing to know whether the underlying documentation originated from an `llms.txt` file, an OpenAPI schema, or a normalized documentation crawl.

---

## 2. Package & Repository Architecture

DocOrbit uses a clean, modular TypeScript package architecture designed for low overhead and isolation:

```text
docorbit/
├── apps/
│   └── cli/                     # CLI application entry point (bin/docorbit.js)
├── packages/
│   ├── shared/                  # Shared domain types, errors, and constants
│   ├── security/                # SSRF guard, IP validation, payload limits
│   ├── crawler/                 # Secure HTTP fetcher and rate-limiting client
│   ├── discovery/               # Pluggable discovery providers & purpose ranker
│   ├── normalizer/              # Deterministic Markdown, AST extraction, prompt guard
│   ├── storage/                 # SQLite storage layer (node:sqlite) and schemas
│   └── core/                    # Ingestion coordinator and query pipeline
├── tests/
│   ├── fixtures/                # Local HTTP test servers (Fixtures A through J)
│   ├── unit/                    # Unit tests for each package
│   └── integration/             # End-to-end integration and CLI pipeline tests
├── docs/                        # Research, competitive analysis, architecture, spec
└── README.md
```

### Dependency Rationale:
- **Zero Native Build Toolchains**: Leveraging Node.js 24's built-in `node:sqlite` (SQLite 3.45+), `node:test`, `node:assert`, `node:crypto`, `node:net`, and `node:dns`.
- **Minimal External Dependencies**: Only standard, pure-JavaScript parsers where standard libraries are absent (e.g., `cheerio` for deterministic HTML DOM traversal).

---

## 3. Detailed Component Design (Milestone 1 Scope)

### 3.1 Pluggable Discovery Engine (`packages/discovery/`)
Every discovery provider implements a unified interface:

```typescript
export interface DiscoveredSource {
  url: string;
  type: SourceType;
  discoveredBy: string;
  status: 'valid' | 'invalid' | 'unreachable';
  contentType?: string;
  confidence: number;
  authority: 'official' | 'community' | 'third_party';
  machineReadable: boolean;
  metadata?: Record<string, unknown>;
}

export type SourceType =
  | 'llms_txt'
  | 'llms_full_txt'
  | 'openapi'
  | 'markdown'
  | 'sitemap'
  | 'github'
  | 'skill'
  | 'web';

export interface DiscoveryProvider {
  name: string;
  discover(targetUrl: string): Promise<DiscoveredSource[]>;
}
```

#### Minimum Required Providers:
1. **`LlmsTxtProvider`**: Checks `/llms.txt`, `/llms-full.txt`, `/.well-known/llms.txt`, and parses HTTP `Link: <...>; rel="llms-txt"` response headers.
2. **`OpenApiProvider`**: Checks `/openapi.json`, `/openapi.yaml`, `/swagger.json`, `/v3/api-docs`, and scans `<link rel="service-doc">`. Validates basic OpenAPI/Swagger structure.
3. **`MarkdownProvider`**: Probes direct `.md` variants and checks for `text/markdown` content types.
4. **`SitemapProvider`**: Probes `/sitemap.xml`, `/sitemap_index.xml`, and `/robots.txt`.
5. **`GithubProvider`**: Detects official repository links and SDK sources from metadata.
6. **`SkillProvider`**: Probes `/skill.md` and `/.well-known/skills/*`.
7. **`GenericWebProvider`**: Inspects HTML root navigation, canonical metadata, and framework markers.

### 3.2 Source Validation (Anti-Guessing Engine)
Discovery is **not** blind URL guessing. A candidate is marked discovered and valid **only if** its payload validates:
- An OpenAPI candidate must parse as valid JSON/YAML containing `openapi` or `swagger` fields.
- An `llms.txt` candidate must parse as Markdown and contain at least one valid link structure.
- A Markdown candidate must return valid Markdown text (not an HTML 404 error page disguised as 200 OK).

### 3.3 Purpose-Based Source Ranking (`packages/discovery/ranker.ts`)
Rather than a naive global hierarchy, sources are ranked according to the **intended consumer purpose**:

```typescript
export type SourcePurpose =
  | 'navigation'       // Where to find things (llms.txt, sitemap)
  | 'conceptual'       // Architecture, guides, mental models (official Markdown, web)
  | 'api'              // Exact schemas, parameters, types (OpenAPI, Swagger)
  | 'examples'         // Working code blocks (GitHub repos, example folders)
  | 'implementation';  // End-to-end task recipes (skill.md, guide markdown)

export interface SourceRankResult {
  purpose: SourcePurpose;
  recommended: DiscoveredSource | null;
  ranked: DiscoveredSource[];
  rationale: string;
}

export function rankSources(
  sources: DiscoveredSource[],
  purpose?: SourcePurpose
): SourceRankResult;
```

### 3.4 Secure Fetcher & SSRF Guard (`packages/security/` & `packages/crawler/`)
External documentation sites are untrusted input. The fetch layer enforces strict guardrails:

```typescript
export interface CrawlerConfig {
  maxPages: number;            // Default: 50
  maxDepth: number;            // Default: 3
  maxBytesPerResponse: number; // Default: 10MB (10 * 1024 * 1024)
  timeoutMs: number;           // Default: 10,000ms
  maxRedirects: number;        // Default: 5
  concurrency: number;         // Default: 5
  allowedProtocols: string[];  // ['http:', 'https:']
}
```

#### Security Guardrails:
1. **IP & DNS Resolution Check (`SsrfGuard`)**:
   - Resolves target hostnames before sending requests.
   - Strictly blocks:
     - `127.0.0.0/8`, `::1` (Loopback)
     - `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` (RFC 1918 Private networks)
     - `169.254.0.0/16`, `fe80::/10` (Link-local)
     - `169.254.169.254` (Cloud instance metadata services)
     - `0.0.0.0/8`
   - Rejects non-HTTP protocols (`file://`, `ftp://`, `gopher://`).
2. **Redirect Validation**:
   - Follows redirects manually step-by-step; re-validates the destination IP on every hop.
3. **Payload Truncation & Limits**:
   - Streams responses with a byte counter; terminates connection immediately if `maxBytesPerResponse` is exceeded.

### 3.5 Deterministic Normalizer (`packages/normalizer/`)
Converts raw content into a clean, canonical representation without LLM involvement:
- Preserves full heading hierarchy (`#`, `##`, `###`) with anchors.
- Preserves fenced code blocks with language identifiers.
- Normalizes relative links into absolute canonical URLs.
- Strips navigation bars, sidebars, cookie banners, and footers.
- Preserves blockquotes, warnings (`NOTE`, `WARNING`, `TIP`, `IMPORTANT`), and deprecation notices.

#### Prompt Injection Handling (Untrusted Data Model):
Rather than naively stripping English words (which destroys technical documentation describing security concepts or AI tools), DocOrbit preserves the text and annotates suspicious patterns:

```typescript
export interface SecurityAnnotation {
  type: 'prompt_injection_suspected' | 'unsafe_link' | 'suspicious_instruction';
  location?: string;
  evidence: string;
  severity: 'low' | 'medium' | 'high';
}
```

Documentation is stored and served to agents as **quoted, delimited data**, neutralizing injection threats structurally.

### 3.6 Normalized Page Model & Content Hashing

```typescript
export interface NormalizedPage {
  id: string;
  sourceId: string;
  title: string;
  url: string;
  content: string; // Deterministic, sanitized Markdown
  headings: Array<{ level: number; text: string; anchor: string }>;
  links: Array<{ text: string; url: string; isExternal: boolean }>;
  codeExamples: Array<{
    id: string;
    language: string;
    code: string;
  }>;
  contentHash: string; // SHA-256 of normalized content
  fetchedAt: string;
  rawBytes: number;
  estimatedTokens: number;
  securityAnnotations: SecurityAnnotation[];
}
```

### 3.7 Storage Layer (`packages/storage/`)
Uses Node.js 24's native `node:sqlite` (`DatabaseSync`):
- Write-Ahead Logging (`PRAGMA journal_mode = WAL;`) for high-concurrency reading.
- Foreign key constraints enabled (`PRAGMA foreign_keys = ON;`).
- **Project-Local Default Storage Architecture**:
  - **Zero Disk Leak Lifecycle**: By default, documentation databases are stored in the nearest project root (`<projectRoot>/.docorbit/docorbit.db`). When a project is deleted or archived, all indexed data is removed with it, preventing permanent disk bloat.
  - **Hierarchical Project Root Detection (`findNearestProjectRoot`)**: Recursively ascends the directory tree from `cwd` or `--project` looking for project root markers (`package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`, `requirements.txt`, `pom.xml`, `build.gradle`, `.git`, `.docorbit`), stopping safely before user home.
  - **Storage Resolution Ladder (`resolveDefaultDbPath`)**:
    1. Explicit `--db <path>` parameter (or `:memory:`).
    2. Explicit global flag (`-g` / `--global`) → resolves to `~/.docorbit/docorbit.db`.
    3. Explicit project directory (`--project <dir>` or `-p`) → resolves to `<projectDir>/.docorbit/docorbit.db`.
    4. Auto-detected project root from `cwd` → resolves to `<projectRoot>/.docorbit/docorbit.db`.
    5. Fallback only outside any project (root `/` or user home) → `~/.docorbit/docorbit.db`.
  - **Interactive TTY Selection (`promptStorageLocation`)**: First-time interactive runs prompt users to choose between `[1] Project-local (default)` and `[2] Global`, which can be bypassed with `-p` or `-g`.
- Schema tables:
  - `sources`: Discovered and ingested sources.
  - `pages`: Normalized documentation pages with hashes and provenance.
  - `links`: Outbound documentation relationships and link graph.
  - `code_examples`: Extracted code snippets with language tags.
  - `snapshots`: Historical capture points for diffing.
  - `snapshot_pages`: Join table for point-in-time snapshot page membership.
  - `chunks`: Standalone retrieval units with section path breadcrumbs, token estimates, and content hashes.
  - `chunk_code`: Atomic code fences linked to chunks.
  - `symbol_references`: Extracted symbols (functions, classes, endpoints, config keys).
  - `chunk_relationships`: Graph relationships (`parent_section`, `next_chunk`, `previous_chunk`, `contains_code`, `explains_code`).
  - `pages_fts`: Full-text search virtual table (FTS5) for pages.
  - `chunks_fts`: Full-text search virtual table (FTS5) for chunks transactionally synchronized via SQLite triggers.

### 3.8 Semantic Slicing Engine (`packages/normalizer/src/slicer.ts`)
Converts `NormalizedPage` records into standalone, context-preserving `DocumentChunk` retrieval units:
- **Heading Hierarchy**: Tracks current heading stack (`#`, `##`, `###`) so every chunk inherits full breadcrumbs (e.g. `['Authentication', 'OAuth 2.0', 'Tokens']`).
- **Atomic Code Block Preservation**: Code blocks are treated as indivisible blocks; code fences are never split across chunks.
- **Warning & Admonition Binding**: Blockquotes and admonitions (`> [!NOTE]`, `> [!WARNING]`) are bound with their section context, never orphaned.
- **Secondary Splitting**: Large sections exceeding `maxTokens` (default 1000) are split on atomic paragraph or code boundaries within `targetTokens` (default 500).
- **Shallow Deterministic Symbol Extraction**: Regex-based extraction of functions, arrow functions, classes, interfaces, REST API endpoints (`GET /v1/...`), and config keys.
- **Relationship Graph**: Sequential links (`previous_chunk`, `next_chunk`), hierarchy links (`parent_section`), and semantic links (`contains_code`, `explains_code`).

### 3.9 Deterministic Hybrid Retrieval & Context Packer (`packages/retrieval/`)
Offline, deterministic retrieval engine combining lexical search, symbol matching, and context assembly:
- **Configurable & Versioned Scoring Weights (`ScoringWeights`)**: Default V1 weights support custom overrides for BM25 weight, exact phrase bonus, title bonus, section breadcrumb bonus, symbol match bonus, intent alignment bonus, and source authority weighting.
- **Query Intent Detection (`QueryIntent`)**: Deterministic pattern matching categorizes tasks into `api`, `examples`, `configuration`, `troubleshooting`, `implementation`, or `conceptual`.
- **Transactional FTS5 Synchronization**: `chunks_fts` updates in the same transaction as `chunks`, with cascade delete triggers.
- **Context Packing (Relevance + Coverage - Redundancy)**: Iterative selection optimizes for relevance while penalizing section redundancy and rewarding cross-page coverage within strict heuristic token budgets.

### 3.10 Version Intelligence & Workspace Awareness (`packages/workspace/`)
Reconciles project dependencies and resolved versions against documentation snapshots:
- **Hierarchical SemVer Confidence Ladder (`resolveDocVersion`)**:
  `exact (1.0) → major_minor (0.95) → major (0.90) → range (0.85) → latest_fallback (0.50) → unresolved (0.0)`. Never over-claims exact precision when documentation exposes broad tags like `v14` or `latest`.
- **Ecosystem Detection (`detectWorkspaceDependencies`)**:
  Scans 8 ecosystems:
  1. `npm`: `package.json`, `package-lock.json`
  2. `cargo`: `Cargo.toml`, `Cargo.lock`
  3. `go`: `go.mod`
  4. `pypi`: `requirements.txt`, `pyproject.toml`
  5. `composer`: `composer.json`
  6. `rubygems`: `Gemfile`
  7. `pub`: `pubspec.yaml`
  8. `maven`: `pom.xml`
  Preserves monorepo package boundaries (`packagePath`, `sourceFile`) and supports multiple distinct versions of the same dependency across workspace packages.
- **Deterministic `docs.lock` Manifest (`generateDocsLock`, `writeDocsLock`)**:
  Sorts dependency keys alphabetically with 2-space indentation. Separates content/snapshot identity (`snapshotHash`) from retrieval timestamp (`retrievedAt`), ensuring bit-for-bit file equality on repeated runs without git churn.
- **Project-Aware Context Resolution (`resolveProjectContext`)**:
  Identifies when queries or coding tasks reference project dependencies and provides target documentation versions to `RetrievalEngine`.
- **Nuanced Version Scoring (`RetrievalEngine`)**:
  Grants `+weights.versionBonus` for exact/major matches, applies major version discrepancy penalties for incompatible versions, while retaining unversioned/`latest` documentation as neutral supplemental context.

### 3.11 Structured Implementation Knowledge (`packages/normalizer/`, `packages/retrieval/`)
Transforms flat text into queryable, typed implementation primitives:
- **API Intelligence (`parseOpenApiEndpoints`)**:
  - Deterministic OpenAPI 3.0/3.1 and Swagger 2.0 parsing into `ApiEndpoint` models.
  - JSON pointer internal `$ref` resolution with circular reference tracking and recursion prevention.
  - Request bodies, response status schemas (`200`, `201`, errors `>= 400`), authentication schemes (Bearer, Basic, API Key), pagination heuristics (cursor vs offset/page), and deprecation flags.
- **Code Example Indexing (`extractIndexedExamples`)**:
  - Indexes code examples as first-class searchable entities (`IndexedExample`).
  - Framework detection (`next`, `react`, `express`, `fastify`, `hono`, `fastapi`, `flask`, `django`, `spring`, `gin`).
  - Route handler and symbol detection with authority tagging.
- **Pitfall & Deprecation Intelligence (`extractPitfalls`)**:
  - Non-inferential extraction of explicit warnings (`Pitfall`): `deprecated`, `removed`, `breaking_change`, `server_only`, `client_only`, `required_config`, `permission`, `rate_limit`, `runtime_restriction`, `security`.
- **Implementation Recipe Engine (`RecipeEngine`)**:
  - Compiles structured implementation recipes (`Recipe`) connecting prerequisites, ordered steps, required APIs, code examples, pitfalls, and evidence-based validation steps.
  - Strict evidence-level tagging: `documented_fact`, `inferred_relationship`, and `missing_information`.
  - Strict evidence-grounding with explicit evidence-level markers: Undocumented tasks produce explicit `missing_information` markers with confidence 0.0 without ungrounded steps.

### 3.12 Agent-Native MCP Integration (`packages/mcp/`)
Exposes DocOrbit's multi-dimensional documentation intelligence directly to AI coding agents through the Model Context Protocol (MCP 2024-11-05 spec):
- **Centerpiece Tool (`get_implementation_context`)**:
  - Implements the complete 9-stage orchestration pipeline:
    `Task → Workspace Scan & Dependency Matching → SemVer Resolution → Intent Classification → Recipe Assembly → OpenAPI Lookup → Example Matching → Pitfall Extraction → Hybrid Chunk Retrieval → Token-Budgeted Dual Response`.
  - Solves complex coding tasks in a single turn while allowing granular follow-up queries.
- **Granular Low-Level Tools (8 Tools)**:
  - `search_docs`: Hybrid FTS5 retrieval with version boosting and pagination.
  - `get_doc`: Single-chunk or full-page retrieval with explicit untrusted annotations.
  - `find_api`: OpenAPI endpoint lookup with method, query/path parameters, schemas, and auth.
  - `find_example`: Verified code examples filtered by framework, language, and task.
  - `find_pitfall`: Deprecation notices, breaking changes, rate limits, and security warnings.
  - `find_recipe`: Evidence-grounded step-by-step implementation blueprints.
  - `get_version`: SemVer confidence ladder workspace version resolution.
  - `list_sources`: Indexed documentation sources, snapshots, and machine-readability status.
- **Dual Content Response Model**:
  - Every tool returns structured JSON under `data` for programmatic reasoning alongside agent-friendly concise Markdown under `markdown`.
- **Security Boundaries**:
  - Every external documentation item is explicitly annotated with `untrusted: true` and accompanied by a visible security warning banner.
- **MCP Dynamic Resources (`McpResourceManager`)**:
  - `docorbit://sources`: List of all indexed sources, snapshot counts, and URLs.
  - `docorbit://pages/{pageId}`: Specific page content and metadata with bounded reads (default 64KB).
  - `docorbit://chunks/{chunkId}`: Specific chunk content, hierarchy breadcrumbs, and provenance.
- **Transports (`packages/mcp/transports/`)**:
  - **Stdio (`StdioServerTransport`)**: Strict JSON-RPC 2.0 over stdin/stdout with diagnostic logging isolated to stderr.
  - **Streamable HTTP (`StreamableHttpTransport`)**: Zero-dependency `node:http` supporting POST `/mcp` (direct JSON and SSE chunked streaming), GET `/sse` (legacy SSE stream), GET `/health`, and CORS headers.
  - **CLI Command**: `docorbit mcp [--stdio] [--port 3000] [--host 127.0.0.1] [--db <path>] [--project <dir>]`.

---

### 3.6 Verification & Documentation Diffing (`packages/verification/`)

Milestone 6 introduces deterministic verification, documentation diffing, and workspace impact analysis:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                       VERIFICATION & DIFFING PIPELINE                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Agent / Workspace Code                                                     │
│            ↓                                                                │
│  CodeApiExtractor (JS/TS, Python, cURL AST & pattern parser)                 │
│            ↓ (ExtractedApiCall[] + dynamic markers)                         │
│  SchemaVerifier                                                             │
│       ├── Validates endpoint paths & HTTP methods                            │
│       ├── Validates required query params & request body fields             │
│       ├── Detects deprecated & removed APIs                                 │
│       └── Flags version mismatches (e.g., Next.js 14 sync vs 15 async)      │
│            ↓                                                                │
│  VerificationResult (verified | warning | mismatch | insufficient_evidence) │
│                                                                             │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                             │
│  DocDiffEngine                                                              │
│       ├── Compares versions / snapshots                                     │
│       ├── Identifies added, removed, modified, deprecated endpoints         │
│       ├── Tracks added & removed pitfalls                                   │
│       └── Ignores formatting-only whitespace diffs                          │
│            ↓                                                                │
│  WorkspaceImpactScanner                                                     │
│       ├── Scans project files against doc diff                              │
│       └── Pinpoints exact line, snippet, certainty (high/medium/heuristic)  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

- **Deterministic Code API Extraction (`CodeApiExtractor`)**:
  - Deterministic AST and regex pattern matching for JavaScript/TypeScript (`fetch`, `axios`, SDK calls like `stripe.*`, Next.js route params), Python (`requests`), and cURL.
  - Extracts endpoints, methods, parameters, request body schemas, and response field accesses.
  - Explicitly detects dynamic expressions (unresolved variables, function call return values) and marks them as `isDynamicOrAmbiguous: true`.
- **Deterministic Schema Verification (`SchemaVerifier`)**:
  - Verifies extracted calls against indexed OpenAPI schemas, endpoints, and version contracts via deterministic static schema analysis.
  - 8 Verification Rules: `endpoint_validity`, `method_validity`, `required_parameters`, `deprecated_api`, `removed_api`, `version_mismatch`, `response_assumption`, `unsupported_syntax`.
  - Strict Verification Statuses:
    - `verified`: Code perfectly matches documented schema and contracts.
    - `warning`: Non-breaking issues (e.g. deprecated endpoint).
    - `mismatch`: Breaking issues (missing required field, invalid HTTP method, removed API).
    - `insufficient_evidence`: Dynamic/unresolvable code that cannot be verified statically.
- **Documentation Diffing (`DocDiffEngine`)**:
  - Compares versions or snapshots to detect added, removed, modified, and deprecated endpoints.
  - Normalizes text whitespace to ignore formatting-only documentation changes.
- **Workspace Impact Analysis (`WorkspaceImpactScanner`)**:
  - Scans workspace files for affected patterns, outputting exact file path, line number, code snippet, matched pattern, traceable reason, and certainty (`high`, `medium`, `heuristic`).
- **MCP Expansion (12 Tools)**:
  - Adds `check_api`, `diff_docs`, and `analyze_impact`.
  - Augments `get_implementation_context` with `verificationHints`.

---

## 4. Operational Boundaries

- **Milestone 1 Scope (Completed)**: URL → Discovery → Validation → Purpose Ranking → Secure Fetching → Normalization → SQLite Persistence → CLI (`inspect`, `add`).
- **Milestone 2 Scope (Completed)**: Semantic Slicing → Contextual Chunks → Relationship Graph → Hybrid Retrieval Engine → Token Budget Context Packing → CLI (`search`, `context`) → Evaluation Dataset (P@K, R@K, MRR, 1k/10k benchmark).
- **Milestone 3 Scope (Completed)**: Workspace Dependency Detection (8 ecosystems) → SemVer Confidence Ladder → Deterministic `docs.lock` (zero timestamp churn) → Project-Aware Resolver & Version Boosting → CLI (`init`, `update`, `--project`, `--doc-version`) → Multi-Version Benchmark.
- **Milestone 4 Scope (Completed)**: API Intelligence (OpenAPI/Swagger) → Code Example Indexing → Pitfalls & Deprecations → Implementation Recipe Engine → CLI (`api`, `examples`, `pitfalls`, `recipes`) → 20-Task Implementation Knowledge Benchmark (100% pass).
- **Milestone 5 Scope (Completed)**: Agent-Native MCP Integration (9 tools, `get_implementation_context` pipeline, dual format, `untrusted: true`, resources, Stdio & Streamable HTTP transports, CLI `mcp`) → 90 passing tests.
- **Milestone 6 Scope (Completed)**: Verification & Documentation Diffing (`check_api`, `diff_docs`, `analyze_impact`, `CodeApiExtractor`, `SchemaVerifier`, `DocDiffEngine`, `WorkspaceImpactScanner`, 12 MCP tools, CLI `verify`, `diff`, `impact`) → 105 passing tests.
- **Milestone 7 Scope (Completed)**: Web Dashboard & Agent File Exports (`DashboardServer` via native `node:http`, single-page dashboard UI, REST APIs, `ExportService`, `AGENTS.md`, `CLAUDE.md`, `skill.md`, `llms.txt`, `docs-map.md`, 14 MCP tools with `get_documentation_map` and `export_agent_context`, CLI `dashboard`/`ui`, `export`).
- **Milestone 8 Scope (Completed)**: Real-World Agent Evaluation & Production Hardening (`BenchmarkRunner`, 3-strategy harness: real DocOrbit MCP server + real `context7-mcp` stdio subprocess + direct HTTPS official docs fetch baseline, offline deterministic simulation mode `--simulation` for CI, 10 benchmark tasks across 5 ecosystems, CLI `eval`, raw `eval-results/raw/` artifacts with `isSimulation` auditability, 9 production hardening integration tests covering 10k-chunk latency, 20 concurrent MCP calls, stale snapshots, missing versions, malformed OpenAPI, dynamic AST safe fallback, adversarial prompt injection, SQLite rollback consistency, large monorepo scan).

# DocRouter Architecture & Systems Design

## 1. Core Abstraction: Documentation Intelligence

DocRouter is an **Agent Documentation Operating Layer**. Rather than a flat document scraper or generic vector search engine, its architecture derives entirely from a single unified abstraction: **Documentation Intelligence**.

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

DocRouter uses a clean, modular TypeScript package architecture designed for low overhead and isolation:

```text
docrouter/
├── apps/
│   └── cli/                     # CLI application entry point (bin/docrouter.js)
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
Rather than naively stripping English words (which destroys technical documentation describing security concepts or AI tools), DocRouter preserves the text and annotates suspicious patterns:

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
- Schema tables:
  - `sources`: Discovered and ingested sources.
  - `pages`: Normalized documentation pages with hashes.
  - `links`: Outbound documentation relationships and link graph.
  - `code_examples`: Extracted code snippets with language tags.
  - `snapshots`: Historical capture points for diffing.
  - `pages_fts`: Full-text search virtual table (FTS5) for sub-millisecond lexical queries.

---

## 4. Operational Boundaries

- **Milestone 1 Scope**: URL → Discovery → Validation → Purpose Ranking → Secure Fetching → Normalization → SQLite Persistence → CLI (`inspect`, `add`).
- **Deferred to Later Milestones**:
  - Milestones 2-3: FTS5 semantic queries, dependency lockfile generator (`docs.lock`).
  - Milestone 4: Deep OpenAPI parameter & schema parsing, recipes, pitfalls.
  - Milestone 5: MCP server (`stdio` / `SSE`).
  - Milestone 6: `check_api` verification and `docrouter diff`.
  - Milestone 7: Web UI dashboard and agent file exports (`AGENTS.md`, `skill.md`).

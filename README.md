# DocRouter

> **The documentation intelligence layer for AI coding agents.**

DocRouter bridges the gap between raw developer documentation websites and autonomous coding agents (Claude Code, Cursor, Codex, Windsurf, Devin, etc.). 

Instead of forcing coding agents to consume bloated HTML pages, guess API signatures, or drown in 200k-token sitemaps, DocRouter discovers authoritative machine-readable specifications (`llms.txt`, OpenAPI, Agent Skills, raw Markdown), normalizes content into structured AST representations, guards against documentation-based prompt injection and SSRF attacks, and indexes documentation into a lightning-fast local SQLite database.

---

## The Problem: Why Scrapers Aren't Enough

| Approach | What It Does | Why It Fails Coding Agents |
| :--- | :--- | :--- |
| **Search APIs** (Tavily, Exa) | Returns top Google/Bing web search snippets | Outdated SEO spam, blog posts from 2021, missing full API types, high latency. |
| **Web Scrapers** (Firecrawl, Jina) | Converts raw browser DOM to Markdown | Dumps navigation chrome, headers, footers, cookie banners, lacks source hierarchy. |
| **Doc Aggregators** (Context7) | Pulls central `llms.txt` / curated repositories | Narrow scope, lacks multi-source ranking, lacks local offline-first SQLite FTS5 caching, lacks prompt injection annotations. |
| **DocRouter** | **Full documentation intelligence pipeline** | Discovers machine-readable specs, ranks by agent purpose, strips boilerplate, detects prompt injections, isolates network threats, and stores structured ASTs with FTS5 search. |

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
docrouter/
├── apps/
│   └── cli/                      # Command-line interface (inspect, add, formatters)
├── bin/
│   └── docrouter.js              # Executable entry point
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
git clone https://github.com/your-org/docrouter.git
cd docrouter

# Run CLI directly
node --experimental-strip-types bin/docrouter.js --help
```

---

## CLI Usage

### 1. Inspect Documentation Sources (`inspect`)

Probes a target documentation URL to discover and rank all available machine-readable and human-readable documentation endpoints:

```bash
node --experimental-strip-types bin/docrouter.js inspect https://mintlify.com/docs
```

Sample Terminal Output:
```text
DocRouter — Documentation Source Discovery
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
node --experimental-strip-types bin/docrouter.js inspect https://mintlify.com/docs --json
```

### 2. Ingest Documentation (`add`)

Fetches, normalizes, extracts code blocks, tokenizes, and stores the documentation into your local SQLite database:

```bash
node --experimental-strip-types bin/docrouter.js add https://mintlify.com/docs --max-pages 5
```

Sample Output:
```text
DocRouter — Documentation Ingested Successfully
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

---

## Performance Benchmarks

DocRouter is designed to run in CI/CD pipelines and local developer machines with negligible overhead.

Results from `tests/integration/benchmark.test.ts` (tested on Apple Silicon):

| Documentation Size | Normalization Latency | SQLite Storage Latency | Total Processing Time |
| :--- | :--- | :--- | :--- |
| **50 KB Page** | ~9.3 ms | ~0.9 ms | **~10.3 ms** |
| **500 KB Page** | ~10.6 ms | ~2.1 ms | **~12.7 ms** |
| **5 MB Spec / Page** | ~126.8 ms | ~27.9 ms | **~154.8 ms** |

- **Batch Ingestion Rate**: ~61 ms for 50 pages (**~1.2 ms per page**).
- **Memory Footprint**: Heap allocation delta strictly bounded (< 65 MB peak for 5MB payloads).
- **FTS5 Search Query Latency**: < 1.5 ms across thousands of indexed documentation fragments.

---

## Test Suite & Verification

The test suite runs 100% hermetically without network access using a custom in-memory WHATWG fetch server mocking real-world edge cases.

To run the complete test suite:

```bash
npm test
```

### Covered Test Matrix (37 Tests)
- **Unit Tests**:
  - `security.test.ts`: SSRF defense, loopback & private IP blocking, non-destructive prompt injection tagging.
  - `discovery.test.ts`: LLMs.txt, OpenAPI, Sitemap, Markdown, GitHub, and Skill providers.
  - `ranker.test.ts`: Purpose-based ranking logic (`navigation`, `api`, `examples`, `implementation`).
  - `normalizer.test.ts`: HTML to Markdown conversion, code block extraction, OpenAPI schema detection, content hashing stability.
  - `storage.test.ts`: SQLite schema initialization, cascading foreign keys, WAL mode, FTS5 full-text indexing.
- **Integration Fixture Tests**:
  - **Fixture A**: Simple HTML documentation crawl and normalization.
  - **Fixture B**: HTML + `llms.txt` discovery and multi-page crawl.
  - **Fixture C**: `llms.txt` + `llms-full.txt` discovery and source ranking.
  - **Fixture D**: OpenAPI 3.0 specification discovery and endpoint extraction.
  - **Fixture E**: Versioned documentation links identification (`/v1/`, `/v2/`, `/latest/`).
  - **Fixture F**: GitHub-style direct Markdown repository documentation.
  - **Fixture G**: Malicious redirect attempting SSRF to cloud metadata (`169.254.169.254`) blocked.
  - **Fixture H**: Prompt injection content identified and annotated in metadata.
  - **Fixture I**: Broken sitemaps and 404 links handled resiliently without crashing.
  - **Fixture J**: Oversized response exceeding max payload size cleanly aborted.
- **CLI & Benchmark Tests**:
  - `cli.test.ts`: `--help`, `--version`, `--json`, and error handling.
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
- [ ] **Milestone 2: Semantic Slicing & Chunking Architecture**
  - Section-level chunking preserving heading context and code blocks
  - Symbol & API signature graph extraction
  - Token-budget-aware chunk packer
- [ ] **Milestone 3: MCP Server & Agent Integration Protocol**
  - Model Context Protocol (MCP) server endpoints (`search_docs`, `get_page`, `inspect_source`)
  - Claude Code & Cursor native skill configuration
- [ ] **Milestone 4: Version Intelligence & Delta Sync**
  - Git tag & semantic version resolver
  - Version-aware doc diffing
  - Incremental update daemon / webhook trigger
- [ ] **Milestone 5: Task-Oriented Context Formulation & Recipes**
  - Prompt-to-documentation context assembler
  - Executable recipe and pattern extraction from docs
- [ ] **Milestone 6: API Verification & Runtime Hallucination Guard**
  - AST verification comparing generated code against indexed OpenAPI / type specs
  - Hallucination linting for LLM tool use
- [ ] **Milestone 7: Team Sync, Local Web UI, & Cloud Connector**
  - Local browser UI for doc exploration
  - Shared team cache & S3/R2 snapshot synchronization

---

## License

MIT License. See [LICENSE](LICENSE) for details.

# DocRouter Product Specification

## 1. Product Identity

* **Name**: DocRouter
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
  - CLI commands: `docrouter inspect <url> [--json]` and `docrouter add <url> [--json]`.
  - Comprehensive test suite with HTTP test fixtures A through J.

### Milestone 2: Indexing & Retrieval
- SQLite + FTS5 full-text indexing with BM25 ranking.
- Fast sub-10ms lexical and keyword search.
- CLI: `docrouter search <query>`.

### Milestone 3: Version Intelligence & Project Awareness
- Workspace scanner for `package.json`, `pnpm-lock.yaml`, `Cargo.lock`, `go.mod`, etc.
- Reproducible `docs.lock` manifest.
- Version comparison and resolution (`compare_versions`).
- CLI: `docrouter init`, `docrouter update`.

### Milestone 4: API, Examples, Recipes & Pitfalls
- Structured OpenAPI endpoint parsing (parameters, types, schemas, error codes).
- Structured code example extraction and indexing.
- Recipe generator and pitfall extractor.
- CLI: `docrouter api <endpoint>`, `docrouter examples <task>`, `docrouter recipes <goal>`.

### Milestone 5: MCP Server
- JSON-RPC 2.0 stdio and SSE MCP server.
- Exposing tools: `search_docs`, `get_doc`, `get_context`, `find_api`, `find_example`, `find_recipe`, `get_version`, `get_pitfalls`, `check_api`, `compare_versions`, `get_changes`, `list_sources`.
- CLI: `docrouter mcp`.

### Milestone 6: Verification & Documentation Diffing
- `check_api` engine: AST/pattern verification of agent code against indexed schemas.
- `docrouter diff`: Detect added, modified, and deprecated APIs between versions.
- Impact analysis showing affected project repository files.

### Milestone 7: Web Dashboard & File Exports
- Lightweight local dashboard for inspecting indexed sources, versions, APIs, and agent readiness.
- Exports: `AGENTS.md`, `CLAUDE.md`, `skill.md`, `llms.txt`, and `docs-map.md`.

---

## 4. Milestone 1 Detailed Specifications

### 4.1 CLI Experience
```bash
# Inspection (read-only, does not store full crawl)
docrouter inspect https://docs.example.com
docrouter inspect https://docs.example.com --json

# Ingestion (runs discovery, ranking, crawl, normalization, and local storage)
docrouter add https://docs.example.com
docrouter add https://docs.example.com --json
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

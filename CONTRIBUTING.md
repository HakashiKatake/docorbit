# Contributing to DocOrbit 🛰️

Thank you for your interest in contributing to **DocOrbit**! We are building the documentation intelligence layer for AI coding agents to eliminate version drift, parameter hallucinations, and token bloat.

Whether you're fixing a bug, adding a new ecosystem detector, improving sub-millisecond retrieval performance, or adding an MCP tool, we welcome your contributions.

---

## 1. Project Architecture & Codebase Layout

DocOrbit is structured as a zero-dependency TypeScript monorepo designed for high speed, determinism, and local-first execution.

```
docorbit/
├── apps/
│   └── cli/                # Command-line interface (`docorbit <command>`)
├── packages/
│   ├── crawler/            # Recursive documentation-tree crawler & HTML fetcher
│   ├── discovery/          # Doc root finder (llms.txt, sitemaps, framework detection)
│   ├── normalizer/         # HTML-to-Markdown, OpenAPI 3.x / Swagger parser, AST slicer
│   ├── retrieval/          # Hybrid FTS5 search engine, context packer, recipe assembler
│   ├── security/           # SSRF protection, IP blocklist, prompt injection defense
│   ├── shared/             # Canonical data models, error classes, content hashing
│   ├── storage/            # Embedded SQLite repository with WAL mode & statement caching
│   ├── verification/       # Closed-loop AST code verifier, diff engine, impact scanner
│   ├── workspace/          # Ecosystem scanners (npm, cargo, go, pypi, composer, etc.)
│   ├── mcp/                # 15 Agent-Native Model Context Protocol (MCP) tools
│   ├── export/             # Deterministic AGENTS.md, CLAUDE.md, skill.md, llms.txt export
│   └── evaluation/         # Empirical benchmarking engine (DocOrbit vs Context7 vs Firecrawl)
├── site/                   # Developer landing page & documentation (/docs)
├── bin/                    # Executable binary entrypoint (`bin/docorbit.js`)
└── tests/
    ├── unit/               # Hermetic unit tests
    └── integration/        # End-to-end MCP, crawler, and retrieval tests
```

---

## 2. Prerequisites & Setup

- **Node.js**: `>= 22.5.0` (DocOrbit leverages native Node.js type-stripping and modern web APIs).
- **Package Manager**: `npm` (bundled with Node).

### Clone & Build

```bash
# 1. Clone repository
git clone https://github.com/HakashiKatake/docorbit.git
cd docorbit

# 2. Build TypeScript packages
npm run build

# 3. Run the automated test suite (143 hermetic tests)
npm test
```

---

## 3. Development Workflow

### Running Tests
All tests run natively with Node's built-in test runner (`node --test`):

```bash
# Run all unit and integration tests
npm test

# Run only unit tests
npm run test:unit

# Run only integration tests
npm run test:integration
```

### Testing the CLI Locally
You can execute the local build directly:
```bash
node bin/docorbit.js --help
node bin/docorbit.js inspect https://example.com/docs
node bin/docorbit.js dashboard
```

### Testing MCP Server
You can launch the MCP server over stdio for testing in Cursor or Claude Desktop:
```bash
node bin/docorbit.js mcp
```

---

## 4. Core Design Principles

When submitting code, please align with our design ethos:

1. **Lazy & Efficient**: The best code is the code never written. Don't add abstractions nobody asked for.
2. **Sub-Millisecond Performance**: Avoid N+1 database queries. Batch chunk lookups with `WHERE id IN (...)`, use prepared statement caching, and keep read operations memory-mapped.
3. **Pure Clean Markdown by Default**: MCP tools deliver direct GitHub-flavored markdown to save LLM tokens (-55%), while supporting an optional `format: 'json'` for programmatic consumers.
4. **Hermetic Testing**: Tests must never rely on live external networks. Mock DNS resolutions and HTTP endpoints using fixtures.
5. **No Heavy External Dependencies**: DocOrbit runs on standard Node.js APIs without external runtime bloat.

---

## 5. How to Add a New Capability

### Adding a New MCP Tool
1. Define the tool definition and input schema in `packages/mcp/src/tools/`.
2. Register the tool in `packages/mcp/src/tools/index.ts`.
3. Support clean markdown delivery by default in `content[0].text`, with backward-compatible JSON mode.
4. Add unit and integration tests in `tests/unit/mcp.test.ts` and `tests/integration/mcp-e2e.test.ts`.

### Adding a New Ecosystem Scanner
1. Implement the package detector in `packages/workspace/src/ecosystems/<ecosystem>.ts`.
2. Implement lockfile parsing and SemVer resolution.
3. Register the ecosystem in `packages/workspace/src/detector.ts`.
4. Add test fixtures in `tests/unit/workspace.test.ts`.

---

## 6. Pull Request Checklist

Before opening a Pull Request:
- [ ] Code compiles with `npm run build` without errors.
- [ ] All tests pass cleanly with `npm test`.
- [ ] New logic is covered by at least one unit test.
- [ ] No unneeded external dependencies have been added to `package.json`.
- [ ] Commit message is clear and follows conventional commits (e.g., `feat:`, `fix:`, `docs:`, `perf:`).

---

## 7. Contributors

A massive thank you to everyone helping make documentation deterministic for AI coding agents:

- **Saurabh Yadav** ([@HakashiKatake](https://github.com/HakashiKatake)) — *Creator & Lead Maintainer*
- And all our open-source community contributors!

Join us in building the next generation of developer tooling! 🚀

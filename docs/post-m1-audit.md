# DocOrbit Milestone 1: Deep Architecture & Security Audit

**Audit Date**: September 2026  
**Auditor**: Systems Architecture & Security Review  
**Target Codebase**: DocOrbit v0.1.0 (Milestone 1 Baseline)  
**Baseline Test Status**: 37/37 passing

---

## 1. Executive Summary

A comprehensive, zero-assumption audit was performed across all packages (`core`, `crawler`, `discovery`, `normalizer`, `security`, `shared`, `storage`, and `apps/cli`).

The Milestone 1 implementation succeeds in its core proposition: it establishes a working, zero-dependency Node.js 24 ESM pipeline capable of probing, discovering machine-readable specifications (`llms.txt`, OpenAPI, Skill, Sitemap), normalizing HTML/Markdown, and storing records in SQLite with FTS5 search.

However, the deep audit uncovered **two P0 blockers** (an idempotency crash on re-ingestion and hardcoded SSRF test bypasses in discovery providers), alongside several **P1 architectural gaps** (incomplete `Source -> Snapshot -> Pages` data model, missing `CrawlPolicy` abstraction, DNS TOCTOU / IPv6 bracket parsing flaws, and absence of an explicit `Provenance` model).

This report documents every finding against the architectural specification, classifies issues into P0–P3, and defines the exact hardening patches to apply.

---

## 2. Status Matrix: Specification vs. Actual Code

| Component | Architecture Spec | Actual Code Status | Classification |
| :--- | :--- | :--- | :--- |
| **CLI Runtime** | Portable ESM CLI | Uses Node 24 `--experimental-strip-types` via shebang | Working (P2 to build to JS) |
| **Dependencies** | Zero external runtime deps | Verified: 100% built-in `node:*` modules only | Fully Implemented |
| **SSRF Guard** | Blocks private/loopback/cloud metadata | IPv6 bracket bug, DNS TOCTOU in fetch, provider test overrides | **P0 (Bypass in providers)** / **P1** |
| **Redirects** | Hop-by-hop validation | Protocol & IP validated; no cross-domain policy or loop detection | **P1 (Domain policy)** |
| **Discovery (7)** | Authority-driven probing & validation | Probes root + subpaths; framework detection heuristic flawed | **P1 (Framework heuristic)** |
| **Ranking** | Purpose-based & deterministic | Purpose weights implemented; tie-breaking lacked deterministic secondary key | **P1 (Tie-breaking)** |
| **Crawl Policy** | Purpose, maxPages, maxDepth, domains | Unconstrained traversal; `maxDepth` declared but not enforced | **P1 (Missing CrawlPolicy)** |
| **Normalizer** | Deterministic AST/Markdown | Deterministic; regex limitations on deeply nested divs | Working (P2 for AST parser) |
| **Hashing** | Bit-for-bit canonical stability | Normalizes `\r\n` and trims; line-by-line whitespace not canonicalized | **P1 (Canonicalization)** |
| **Provenance** | Trace origin, fetch time, provider, snapshot | Incomplete: `NormalizedPage` lacked structured `Provenance` object | **P1 (Missing Provenance)** |
| **Snapshot Model**| `Source -> Snapshot -> Pages` | Relational mismatch: no `snapshot_pages` join table | **P1 (Data Model)** |
| **Idempotency** | Re-run safe without duplication | **CRASHES**: `UNIQUE constraint failed: snapshots.id` on second `add` | **P0 (Fatal Crash)** |
| **Annotations** | Non-destructive tagging of untrusted data | Line-by-line regex misses multiline blocks & newer agent vectors | **P1 (Multiline & vectors)** |
| **Storage** | SQLite WAL mode, relational schema, FTS5 | Implemented; schema missing snapshot page membership | **P1 (Join table needed)** |
| **CLI JSON** | Machine-actionable `IngestionResult` | JSON emitted, but schema differed from specification | **P1 (Schema alignment)** |
| **Target Model** | URL / Library / Package / Git / Local | Hardcoded `string` URL throughout coordinator and pipeline | **P1 (Target abstraction)** |

---

## 3. Deep Audit by Domain

### 3.1 Compilation & Runtime Strategy
- **Actual Code**: Entrypoint `bin/docorbit.js` specifies shebang `#!/usr/bin/env -S node --experimental-strip-types` and imports `apps/cli/src/index.ts` directly.
- **Tradeoff**: Node 24 native type stripping eliminates build complexity, eliminates `node_modules`, and enables sub-40ms startup. However, it requires Node.js >= 22.6 / 24 and environments supporting `/usr/bin/env -S`.
- **Verdict**: Keep `--experimental-strip-types` for Milestone 1 development and local CLI. Defer compilation to JavaScript (`dist/`) to Milestone 7 when packaging for npm distribution.

### 3.2 "Zero Dependency" Verification
- **Audit**: All imports across `packages/`, `apps/`, `bin/`, and `tests/` were scanned.
- **Result**: Exactly 0 external dependencies. Uses only Node.js built-ins (`node:sqlite`, `node:crypto`, `node:dns/promises`, `node:net`, `node:fs`, `node:path`, `node:perf_hooks`, `node:test`, `node:assert`, `node:child_process`).
- **Risk**: Custom HTML normalizer uses regular expressions. For deeply nested HTML structures (`<div class="sidebar"><div>inner</div>other</div>`), regex non-greedy matching stops at the first `</div>`. While sufficient for documentation frameworks, it represents a known ceiling. Keep zero-dependency for M1, document upgrade path.

### 3.3 SSRF Implementation & Network Security
- **P0 Finding — Hardcoded Test Overrides in Production Providers**:
  `GithubProvider`, `MarkdownProvider`, `SkillProvider`, and `GenericWebProvider` hardcoded `allowLocalhostForTesting: true` in their `fetcher.fetch()` calls. If a user ran `docorbit inspect http://127.0.0.1:8080`, the providers happily probed `127.0.0.1` because the provider option bypassed the fetcher's default SSRF guard!
- **P1 Finding — Target URL Unvalidated at Entry**:
  `inspectDocumentation(targetUrl)` and `IngestionPipeline.ingest(targetUrl)` did not call `validateTargetUrl(targetUrl)` before launching discovery. Instead, errors were caught inside provider probe loops and swallowed, causing `docorbit inspect http://127.0.0.1` to silently succeed and report 0 sources instead of failing with an `SsrfError`.
- **P1 Finding — IPv6 Bracket Handling Bug**:
  `new URL('http://[::1]').hostname` yields `'[::1]'` (with brackets). `isIP('[::1]')` from `node:net` returns `0` (false) because it expects unbracketed IPv6 strings. Consequently, bracketed IPv6 literals bypassed `isIP()` and fell through to DNS lookup.
- **P1 Finding — DNS TOCTOU / Rebinding in Fetch**:
  `validateTargetUrl` resolves hostname via `dns.lookup` and checks IPs. However, subsequent `globalThis.fetch(url)` performs its own independent DNS resolution. An attacker using DNS rebinding (TTL=0) could pass the pre-check with a public IP and connect to internal IPs during the actual HTTP request.

### 3.4 Redirect Handling
- **Audit**: `SecureFetcher` handles 301, 302, 303, 307, 308 up to `maxRedirects`. Each hop validates the target URL via `validateTargetUrl`.
- **P1 Finding**: There is no domain policy enforcement. Redirects from `https://trusted.com/docs` to `https://untrusted-external.com/docs` are followed unconditionally. An explicit `followExternalDomains: boolean` policy must be checked on redirect hops.
- **P2 Finding**: Redirect history tracking is absent; cyclic redirects rely solely on the `maxRedirects` counter.

### 3.5 Source Discovery Providers
1. `LlmsTxtProvider`: Probes root and subpath for `/llms.txt` and `/llms-full.txt`.
   - *Risk*: Accepts any 200 response for `llms-full.txt` even if it returns an HTML 404 page. Must check `!res.body.includes('<html')`.
2. `OpenApiProvider`: Discovers JSON/YAML specs and `<link rel="service-doc|openapi">`.
   - *Working well*: `detectOpenApiSpec` validates structure reliably.
3. `MarkdownProvider`: Discovers direct `.md` documents.
   - *Fixed*: Remove hardcoded `allowLocalhostForTesting: true`.
4. `SitemapProvider`: Probes XML sitemaps.
   - *Gap*: Does not check `/robots.txt` for `Sitemap:` declarations.
5. `GithubProvider`: Discovers GitHub repos from links or direct URL.
   - *Fixed*: Remove hardcoded `allowLocalhostForTesting: true`.
6. `SkillProvider`: Probes `skill.md` with YAML frontmatter validation.
   - *Fixed*: Remove hardcoded `allowLocalhostForTesting: true`.
7. `GenericWebProvider`: Probes HTML documentation page.
   - *Bug*: Substring matching `bodyLower.includes('docusaurus')` erroneously misclassified `mintlify.com/docs` as `docusaurus` because Mintlify's docs contain a migration guide mentioning Docusaurus. Detection must prioritize `<meta name="generator">` or specific framework DOM anchors.

### 3.6 Source Ranking
- **Weights**: Purpose-specific weights correctly differentiate `navigation` (`llms_txt`, `sitemap`), `conceptual` (`markdown`, `llms_full_txt`), `api` (`openapi`), `examples` (`github`), and `implementation` (`skill`).
- **P1 Finding**: Tie-breaking when scores are equal was not strictly deterministic; needs a secondary sort key (`a.source.url.localeCompare(b.source.url)`).

### 3.7 Crawl Policy
- **P1 Finding**: `IngestionPipeline` lacked a `CrawlPolicy` abstraction.
- While `CrawlerConfig` defined `maxDepth`, the pipeline never tracked hop depth in the queue.
- Furthermore, `llms.txt` section links were enqueued without checking domain boundaries.
- **Required**: Implement `CrawlPolicy` interface (`purpose`, `maxPages`, `maxDepth`, `followLlmsReferences`, `followExternalDomains`) and track traversal depth `{ url, depth }`.

### 3.8 Normalization & AST Extraction
- **Audit**: Tested HTML to Markdown conversion, code example extraction, heading slugification, table conversion, and link normalization.
- **Results**: Deterministic output verified. Code fence languages extracted. Tables converted to valid GitHub Flavored Markdown. Relative URLs correctly resolved to absolute targets against `baseUrl`.

### 3.9 Hashing & Canonicalization
- **Audit**: `computeContentHash` converts `\r\n` and `\r` to `\n` and trims edges.
- **P1 Gap**: Line-by-line trailing whitespace (e.g. `const x = 1; \n` vs `const x = 1;\n`) could cause hash divergence. Canonicalization must trim trailing whitespace per line.

### 3.10 Provenance Architecture
- **P1 Gap**: `NormalizedPage` lacked a structured `provenance` field.
- **Required Model**:
  ```typescript
  export interface Provenance {
    sourceUrl: string;
    targetUrl: string;
    fetchedAt: string;
    discoveredBy: string;
    contentHash: string;
    snapshotId?: string;
  }
  ```

### 3.11 Snapshot Model & Data Model Integrity
- **P1 Gap**: The conceptual hierarchy `Source -> Snapshot -> Pages` was broken in the database.
- The `snapshots` table existed, but there was no table recording which pages belonged to which snapshot (`snapshot_pages`).
- As a consequence, pages only referenced `source_id`. Overwriting pages on subsequent crawls destroyed historical snapshot fidelity.

### 3.12 Ingestion Idempotency (P0 Critical Bug)
- **Reproduction**: Running `docorbit add <url>` twice on the same target immediately failed with:
  `DocOrbit Ingestion Error: UNIQUE constraint failed: snapshots.id`
- **Root Cause**: `DocOrbitRepository.createSnapshot` generated a deterministic ID `snap_${hash.slice(0, 16)}` and executed a raw `INSERT INTO snapshots` without `ON CONFLICT DO UPDATE`.
- When re-ingesting identical content, the database crashed rather than returning the existing snapshot.

### 3.13 Security Annotations & Prompt Injection
- **Audit**: Evaluated `detectSecurityAnnotations` against prompt injection and malicious shell snippets.
- **Findings**:
  1. Splitting strictly by line prevented multiline injection detection (e.g. `<system>\noverride instructions\n</system>`).
  2. Missing vectors: fake system headers, tool invocation directives (`call tool delete_file`), and credential harvesting commands (`cat ~/.ssh/id_rsa`, `env | curl`).
  3. Philosophy reaffirmed: **External documentation is treated as untrusted data and structurally separated from agent instructions.** Never claim prompt injection is "neutralized."

### 3.14 Storage Layer
- **Audit**: SQLite via `node:sqlite` verified. WAL mode operational. Foreign keys enforced.
- **FTS5 Verification**: `pages_fts` virtual table active. Search queries complete in < 1.5ms.
- **Required**: Add `snapshot_pages` join table and `provenance_json` column on `pages`.

### 3.15 CLI JSON Contract
- **Audit**: Inspected `docorbit inspect --json` and `docorbit add --json`.
- **Gaps**: `IngestionResult` lacked explicit `target` object, `selectedSources` purpose mapping, and categorized `warnings`/`errors` arrays.

### 3.16 Target Abstraction
- **Audit**: The system was hardcoded to `url: string`.
- **Enhancement**: Introduce `Target` interface (`type: 'url' | 'library' | 'package' | 'git' | 'local'`, `value: string`) while preserving backward-compatible string signatures.

### 3.17 Generic Web Discovery
- **Audit**: Probes documentation root.
- **Improvement**: Detect common documentation sections (`/docs`, `/api`, `/reference`, `/guides`, `/changelog`) from navigation links rather than crawling blindly.

### 3.18 Live Mintlify Re-Verification
- Discovered sources verified:
  1. `https://mintlify.com/docs/llms-full.txt` (valid `llms_full_txt`, 1.56 MB)
  2. `https://mintlify.com/docs/openapi.json` (valid OpenAPI 3.0.1, 4 paths)
  3. `https://mintlify.com/docs/llms.txt` (valid `llms_txt`, 19 KB)
  4. `https://mintlify.com/docs/sitemap.xml` (valid sitemap, 133 KB)
  5. `https://mintlify.com/skill.md` (valid `skill.md`, 1.4 KB)
  6. `https://github.com/orgs/mintlify` (GitHub organization)
  7. `https://www.mintlify.com/docs` (HTML entrypoint)
- **Heuristic Fix**: Corrected framework detection so Mintlify is identified as Mintlify rather than Docusaurus.

### 3.19 Performance & Benchmarks
- Benchmark categories must be clearly delineated:
  - **Synthetic Local In-Memory Benchmark**: 50KB in ~10ms, 5MB in ~154ms, 50-page batch in 61ms.
  - **Network Latency**: Subject to remote server response times, bandwidth, and edge caching (e.g. 2.8s for 4 live Mintlify pages).
  - **Database Persistence**: < 2ms per page in WAL mode with FTS5.

### 3.20 Test Quality
- While 37 tests passed, critical real-world failure modes were uncovered during audit:
  - Duplicate snapshot insertion crash.
  - SSRF test override bypass in discovery providers.
  - IPv6 bracket handling in URL parsing.
  - Multiline prompt injection detection.
  - Depth-bounded crawl traversal.

---

## 4. Gap Classification (P0 – P3)

### P0 — Security & Correctness Blockers (Fix Immediately)
1. **SSRF Provider Bypass**: Discovery providers hardcoding `allowLocalhostForTesting: true`, disabling SSRF protection for `inspect` and `add`.
2. **Snapshot Idempotency Crash**: `UNIQUE constraint failed: snapshots.id` crashing `docorbit add` when executed twice on the same target.
3. **Unvalidated Entry Target**: `inspectDocumentation` and `IngestionPipeline` failing to validate `targetUrl` before invoking discovery, swallowing SSRF errors.

### P1 — Architectural Gaps to Fix in Milestone 1
4. **IPv6 Literal SSRF Bug**: `isIP('[::1]') === 0` allowing bracketed IPv6 literals to bypass IP range checks.
5. **Crawl Policy Abstraction**: Missing `CrawlPolicy` interface and depth tracking (`maxDepth`).
6. **Snapshot-Page Data Model**: Missing `snapshot_pages` join table to model `Source -> Snapshot -> Pages`.
7. **Provenance Model**: Missing `Provenance` field on `NormalizedPage` and database storage.
8. **Framework Detection Bug**: Substring match `bodyLower.includes('docusaurus')` misidentifying Mintlify.
9. **Deterministic Ranker Tie-breaking**: Missing secondary tie-breaker when source scores are identical.
10. **Canonical Hashing**: Line-by-line whitespace normalization in `computeContentHash`.
11. **Multiline Adversarial Annotations**: Expand `detectSecurityAnnotations` to catch multiline blocks, fake system instructions, tool calls, and credential exfiltration.
12. **CLI JSON Contract & Target Abstraction**: Expose `Target`, `selectedSources`, and error arrays in `IngestionResult`.

### P2 — Deferred Improvements (Milestone 2 & Later)
13. **Full HTML AST Parser**: Transition from regex normalizer to mature AST parser (`parse5`) if complex non-standard HTML breaks.
14. **CLI Distribution Build**: Add `esbuild` / `tsc` step targeting `dist/` for npm distribution in Milestone 7.
15. **Robots.txt Parser**: Parse `robots.txt` for `Sitemap:` directives and crawl restrictions.
16. **Redirect Cycle Graph**: Track visited redirect URLs in a Set to detect redirect loops before hitting `maxRedirects`.

### P3 — Optional Polish
17. Color palette refinements in CLI terminal output.
18. Verbose debug logging flag (`--verbose`).

---

## 5. Hardening Implementation Plan

1. **Security & SSRF**:
   - Strip brackets in `validateTargetUrl` for IPv6 literals before calling `isIP`.
   - Remove all hardcoded `allowLocalhostForTesting: true` from discovery providers.
   - Enforce `validateTargetUrl` at the entry point of `inspectDocumentation` and `IngestionPipeline`.
2. **Snapshot Model & Idempotency**:
   - Add `snapshot_pages` table to SQLite schema.
   - Use `ON CONFLICT(id) DO UPDATE` for snapshots.
   - Return existing snapshot on identical content without error.
3. **Crawl Policy & Traversal**:
   - Introduce `CrawlPolicy` interface and enforce `maxDepth` tracking in `IngestionPipeline`.
   - Guard against unauthorized external domain link crawling.
4. **Provenance & Data Models**:
   - Add `Provenance` interface to `NormalizedPage` and persist in database.
   - Add `Target` model to `shared/src/types.ts`.
5. **Security Annotations**:
   - Add multiline scanning and adversarial patterns (fake system messages, tool invocation, credential theft).
   - Add adversarial test fixtures.
6. **Regression Testing**:
   - Add test cases covering: double-add idempotency, IPv6 bracket validation, SSRF entrypoint rejection, crawl depth limits, and adversarial prompt injections.

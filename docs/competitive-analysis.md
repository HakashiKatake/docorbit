# DocRouter Competitive Analysis

## 1. The Core Question

> **Why would a developer use DocRouter instead of Context7 + Firecrawl + their coding agent?**

A modern AI coding setup often combines an agent (Claude Code, Cursor, Windsurf) with a search/scraping tool (Firecrawl or Tavily) and an MCP documentation provider (Context7).

While each tool excels at its specific job (Context7 at hosted text retrieval, Firecrawl at headless scraping, Tavily at web search), **they do not form an integrated documentation intelligence loop**.

The developer still faces:
1. **Version mismatch**: The agent queries Context7 for "Next.js server actions" or "Stripe customer portal", but receives docs from the latest version rather than the version pinned in `package.json`.
2. **Schema imprecision**: Vector search returns paragraphs of explanatory text. The agent still hallucinates optional vs. required parameters, correct HTTP methods, or error response formats.
3. **Token waste**: The agent reads thousands of words of prose just to find a 4-line endpoint signature or config option.
4. **No closed verification loop**: The agent writes code, but neither Context7 nor Firecrawl can verify whether the code uses valid, non-deprecated APIs for that library version.
5. **No upgrade intelligence**: When bumping a library in `package.json`, there is no mechanism to diff the documentation and highlight which repository files break.

DocRouter is not another documentation search engine or web scraper. It is an **Agent Documentation Operating Layer** that governs the full lifecycle from repository detection to code verification.

---

## 2. The Full-Loop Differentiation

The table below contrasts the actual developer and agent workflow across the entire loop:

| Stage in the Loop | Context7 + Firecrawl + Coding Agent | DocRouter |
| :--- | :--- | :--- |
| **1. Documentation Discovery** | Manual configuration or relying on pre-indexed libraries in a cloud database. Scraping requires knowing exact URLs. | **Pluggable multi-provider discovery**: Probes `/llms.txt`, `/llms-full.txt`, OpenAPI, Swagger, Sitemaps, Git repos, and `skill.md` with zero pre-configuration. |
| **2. Project Understanding** | Decoupled. The cloud service does not inspect local project lockfiles (`package.json`, `Cargo.lock`, `go.mod`, `poetry.lock`). | **Local dependency inspection**: Automatically scans workspace manifests, detects installed libraries and exact SemVer constraints. |
| **3. Version Resolution** | The user or agent must manually include the version string in queries, or accept the global default. | **Deterministic version locking**: Generates `docs.lock` pinning documentation snapshots to exact dependency versions. Queries resolve against project reality by default. |
| **4. Source Selection** | Universal text retrieval: returns vector search chunks regardless of intent. | **Purpose-based source ranking**: `rankSources(sources, purpose)`. Directs API queries to OpenAPI schemas, conceptual questions to Markdown/llms.txt, navigation to sitemaps, and examples to GitHub fixtures. |
| **5. Structured API Intelligence** | Schemas are stored and queried as flat text/vector chunks. | **Machine-precise API parsing**: Structured parameter validation (path, query, header, body), required vs. optional fields, schema types, and error codes (`find_api`). |
| **6. Task-Specific Context** | Returns raw documentation fragments. The agent must parse boilerplate and assemble context. | **Synthesized Implementation Context Package**: Packages Goal, Required APIs, Prerequisites, Steps, Verified Snippets, and Pitfalls within a strict token budget (`get_context`). |
| **7. Implementation Guidance** | Prose explanations from docs. | **Structured Recipes & Pitfalls**: High-signal, actionable recipes (`find_recipe`) and explicit failure guards (`get_pitfalls`). |
| **8. Code Verification** | **None**. The agent generates code; the only verification is manual execution or runtime test failure. | **Documentation Verification Engine**: `check_api` validates agent-proposed code against authoritative schemas, catching non-existent methods, wrong parameters, and deprecations *before* running code. |
| **9. Change Impact Analysis** | **None**. Upgrades require manual changelog reading. | **Documentation Diffing & Impact Analysis**: `docrouter diff` compares doc snapshots across versions and flags impacted project files. |

---

## 3. Detailed Competitor Assessment

### 3.1 Context7 (Upstash)
* **Strengths**:
  - Established MCP server with broad developer adoption in Cursor and Claude Code.
  - Supports private Git repositories and enterprise OpenAPI/PDF ingestion on their cloud/on-prem platform.
  - Docs7 provides a clean Mintlify-compatible publishing platform with agent analytics.
* **Real Architectural Limits**:
  - **Interaction Model**: Built primarily as an external vector database for text chunk retrieval.
  - **No Repository State Integration**: Cannot natively sync against a developer's local lockfile (`docs.lock`) to eliminate manual version prompts.
  - **No Verification Engine**: Does not provide static verification tools (`check_api`) to validate generated code against indexed specs.
  - **No Local-First / Zero-Network Core**: Relies on remote server infrastructure for indexing and retrieval.

### 3.2 Firecrawl (Mendable)
* **Strengths**:
  - Premier headless browser crawling for dynamic JavaScript single-page applications.
  - Clean HTML-to-Markdown conversion.
* **Real Architectural Limits**:
  - **Agnostic to Documentation Semantics**: Treats documentation as ordinary web content. It does not parse OpenAPI specs into structured API catalogs, construct dependency graphs, or extract library pitfalls.
  - **Cost & Latency**: Headless browser rendering adds substantial latency (2-10s per page) and external credit costs compared to deterministic machine-readable fetching.

### 3.3 Tavily
* **Strengths**:
  - Fast, broad public web search engine optimized for LLM RAG pipelines.
* **Real Architectural Limits**:
  - **Search Engine, Not Documentation Engine**: Results mix official documentation with third-party blogs, stale StackOverflow answers, and unversioned tutorials.
  - **No Version Control**: Lacks awareness of repository manifests, dependency versions, or API schema validation.

### 3.4 Mintlify
* **Strengths**:
  - Producer-side market leader in developer documentation hosting.
  - First-class support for `llms.txt`, `llms-full.txt`, and direct `.md` endpoints.
* **Real Architectural Limits**:
  - **Producer, Not Consumer**: Mintlify hosts documentation for library authors; it does not organize multi-library documentation for the consumer agent writing code in a heterogeneous application repository.

---

## 4. Concrete Workflow Comparison: A Real-World Scenario

### Scenario: "Implement Stripe Webhook Signature Verification in a Next.js 14 Project"

#### With Context7 + Firecrawl:
1. Agent queries Context7 for "Stripe webhook signature verification".
2. Context7 returns documentation chunks from current Stripe docs (often referencing modern SDK conventions or generic Express/Node.js handlers).
3. If the project runs Next.js 14 App Router, the agent may struggle with raw body consumption (App Router requires `req.text()`, whereas Pages Router used raw body middleware).
4. The agent writes code using `req.body`, which fails at runtime because Next.js App Router does not populate `req.body` as a Node stream.
5. The developer spends 20 minutes debugging raw body handling.

#### With DocRouter:
1. `docrouter init` has already detected `next@14.2.3` and `stripe@14.x` in `package.json`, locked in `docs.lock`.
2. Agent calls `get_context("Stripe webhook verification")`.
3. DocRouter assembles an **Implementation Context Package**:
   - **Prerequisites**: Webhook signing secret (`whsec_...`), raw text extraction.
   - **Targeted Recipe**: "Next.js App Router Stripe Webhook" recipe specifically noting the pitfall: `Do not use req.json(); use await req.text() to preserve HMAC-SHA256 signature`.
   - **Verified API**: `stripe.webhooks.constructEvent(body, sig, secret)`.
   - **Known Pitfalls**: Body tampering by intermediate body-parser middleware.
4. Agent calls `check_api(generatedCode)`:
   - Validates method signature and parameters.
5. Result: Working implementation on the first turn with zero hallucinated methods and minimal token spend.

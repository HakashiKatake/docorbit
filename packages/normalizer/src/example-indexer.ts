import { createHash } from 'node:crypto';
import type {
  NormalizedPage,
  DocumentChunk,
  IndexedExample,
  SourceAuthority,
  Provenance,
} from '../../shared/src/index.ts';

const FRAMEWORK_PATTERNS: Array<{ framework: string; pattern: RegExp }> = [
  { framework: 'next', pattern: /(?:from\s+['"]next(?:\/.*)?['"]|require\(['"]next(?:\/.*)?['"]\)|'use client'|'use server')/i },
  { framework: 'react', pattern: /(?:from\s+['"]react['"]|require\(['"]react['"]\)|useState|useEffect|useMemo|useCallback)/ },
  { framework: 'express', pattern: /(?:from\s+['"]express['"]|require\(['"]express['"]\)|express\(\))/i },
  { framework: 'fastify', pattern: /(?:from\s+['"]fastify['"]|require\(['"]fastify['"]\))/i },
  { framework: 'hono', pattern: /(?:from\s+['"]hono['"]|require\(['"]hono['"]\))/i },
  { framework: 'vue', pattern: /(?:from\s+['"]vue['"]|createApp\(|defineComponent)/i },
  { framework: 'svelte', pattern: /(?:from\s+['"]svelte['"]|<script.*lang=["']ts["']>)/i },
  { framework: 'fastapi', pattern: /(?:from\s+fastapi\s+import|FastAPI\()/i },
  { framework: 'flask', pattern: /(?:from\s+flask\s+import|Flask\(__name__\))/i },
  { framework: 'django', pattern: /(?:from\s+django|django\.)/i },
  { framework: 'spring', pattern: /(?:@SpringBootApplication|@RestController|@GetMapping|@PostMapping)/i },
  { framework: 'gin', pattern: /(?:github\.com\/gin-gonic\/gin|gin\.Default\(\))/i },
];

const API_METHOD_PATH_REGEX = /\b(GET|POST|PUT|DELETE|PATCH)\s+([/\w\-_{}]+)/i;

/**
 * Detects framework from code snippet content.
 */
function detectFramework(code: string): string | undefined {
  for (const { framework, pattern } of FRAMEWORK_PATTERNS) {
    if (pattern.test(code)) {
      return framework;
    }
  }
  return undefined;
}

/**
 * Detects an API endpoint reference from code or task context.
 */
function detectRelatedApi(code: string, context: string): string | undefined {
  // Check context first (e.g. "POST /v1/webhook_endpoints")
  const contextMatch = context.match(API_METHOD_PATH_REGEX);
  if (contextMatch) {
    return `${contextMatch[1].toUpperCase()} ${contextMatch[2]}`;
  }

  // Check code
  const codeMatch = code.match(API_METHOD_PATH_REGEX);
  if (codeMatch) {
    return `${codeMatch[1].toUpperCase()} ${codeMatch[2]}`;
  }

  // Common client library calls (e.g. fetch('/api/v1/foo', { method: 'POST' }))
  const fetchMatch = code.match(/fetch\(\s*['"`]([/\w\-_{}]+)['"`](?:,\s*\{[^}]*method:\s*['"](\w+)['"])?/i);
  if (fetchMatch) {
    const method = (fetchMatch[2] || 'GET').toUpperCase();
    return `${method} ${fetchMatch[1]}`;
  }

  // Framework router calls: app.post('/api/webhook', ...) or router.get('/users', ...) or @app.post('/webhook')
  const routeMatch = code.match(/(?:app|router)\.(get|post|put|delete|patch)\(\s*['"`]([/\w\-_{}]+)['"`]/i);
  if (routeMatch) {
    return `${routeMatch[1].toUpperCase()} ${routeMatch[2]}`;
  }

  // Python decorators: @app.post("/webhook")
  const pyRouteMatch = code.match(/@(?:app|router)\.(get|post|put|delete|patch)\(\s*['"`]([/\w\-_{}]+)['"`]/i);
  if (pyRouteMatch) {
    return `${pyRouteMatch[1].toUpperCase()} ${pyRouteMatch[2]}`;
  }

  return undefined;
}

/**
 * Detects a primary symbol or function call from code.
 */
function detectRelatedSymbol(code: string): string | undefined {
  // Check function declarations
  const funcMatch = code.match(/(?:function\s+([a-zA-Z0-9_$]+)|const\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?\()/);
  if (funcMatch) {
    return funcMatch[1] || funcMatch[2];
  }

  // Check class declarations
  const classMatch = code.match(/class\s+([a-zA-Z0-9_$]+)/);
  if (classMatch) {
    return classMatch[1];
  }

  // Check prominent method invocations, ignoring routing boilerplate like app.post or res.json
  const boilerplateCalls = new Set([
    'app.get', 'app.post', 'app.put', 'app.delete', 'app.use',
    'router.get', 'router.post', 'router.use',
    'express.raw', 'express.json', 'express.urlencoded',
    'res.json', 'res.send', 'res.status', 'console.log', 'console.error',
  ]);
  const allCalls = Array.from(code.matchAll(/([a-zA-Z0-9_$]+(?:\.[a-zA-Z0-9_$]+)+)\s*\(/g));
  for (const match of allCalls) {
    if (!boilerplateCalls.has(match[1])) {
      return match[1];
    }
  }
  if (allCalls.length > 0) {
    return allCalls[0][1];
  }

  return undefined;
}

/**
 * Extracts and indexes first-class code examples from normalized pages and chunks.
 */
export function extractIndexedExamples(
  page: NormalizedPage,
  chunks: DocumentChunk[],
  authority: SourceAuthority,
  docVersion?: string,
  snapshotId?: string
): IndexedExample[] {
  const examples: IndexedExample[] = [];
  const seenCodeHashes = new Set<string>();
  const nowIso = new Date().toISOString();

  // Map each code example in the page to its enclosing chunk
  for (const codeExample of page.codeExamples) {
    const rawCode = codeExample.code.trim();
    if (!rawCode || rawCode.length < 15) continue; // Skip trivial snippets

    const codeHash = createHash('sha256').update(rawCode).digest('hex');
    if (seenCodeHashes.has(codeHash)) continue;
    seenCodeHashes.add(codeHash);

    // Find the chunk that contains this code snippet
    const matchingChunk = chunks.find(c =>
      c.chunkType === 'code' && c.content.includes(rawCode)
    ) || chunks.find(c => c.content.includes(rawCode));

    // Determine task context from breadcrumbs or headings
    let task = '';
    if (matchingChunk && matchingChunk.sectionPath.length > 0) {
      task = matchingChunk.sectionPath.join(' > ');
    } else if (matchingChunk && matchingChunk.title) {
      task = matchingChunk.title;
    } else {
      task = page.title;
    }

    const language = (codeExample.language || (matchingChunk?.language) || 'typescript').toLowerCase();
    const framework = detectFramework(rawCode);
    const relatedApi = detectRelatedApi(rawCode, task);
    const relatedSymbol = detectRelatedSymbol(rawCode);

    const exampleId = createHash('sha256')
      .update(`${page.id}:${codeHash}`)
      .digest('hex')
      .substring(0, 16);

    const provenance: Provenance = {
      sourceUrl: page.url,
      retrievedAt: page.metadata?.extractedAt || nowIso,
      sourceAuthority: authority,
    };

    const effectiveSnapshotId = snapshotId || matchingChunk?.snapshotId || (page as any).snapshotId || 'snap_default';

    examples.push({
      id: exampleId,
      chunkId: matchingChunk?.id,
      pageId: page.id,
      snapshotId: effectiveSnapshotId,
      language,
      framework,
      task,
      code: rawCode,
      sourceUrl: page.url,
      sourceAuthority: authority,
      relatedApi,
      relatedSymbol,
      docVersion: docVersion || page.docVersion,
      provenance,
      createdAt: nowIso,
    });
  }

  // Also check chunks of type 'code' that might not have been caught in page.codeExamples
  for (const chunk of chunks) {
    if (chunk.chunkType !== 'code') continue;
    const rawCode = chunk.content.trim();
    if (!rawCode || rawCode.length < 15) continue;

    const codeHash = createHash('sha256').update(rawCode).digest('hex');
    if (seenCodeHashes.has(codeHash)) continue;
    seenCodeHashes.add(codeHash);

    const task = chunk.sectionPath.length > 0
      ? chunk.sectionPath.join(' > ')
      : (chunk.title || page.title);

    const language = (chunk.language || 'typescript').toLowerCase();
    const framework = detectFramework(rawCode);
    const relatedApi = detectRelatedApi(rawCode, task);
    const relatedSymbol = detectRelatedSymbol(rawCode);

    const exampleId = createHash('sha256')
      .update(`${page.id}:${codeHash}`)
      .digest('hex')
      .substring(0, 16);

    const provenance: Provenance = {
      sourceUrl: page.url,
      retrievedAt: page.metadata?.extractedAt || nowIso,
      sourceAuthority: authority,
    };

    const effectiveSnapshotId = snapshotId || chunk.snapshotId || (page as any).snapshotId || 'snap_default';

    examples.push({
      id: exampleId,
      chunkId: chunk.id,
      pageId: page.id,
      snapshotId: effectiveSnapshotId,
      language,
      framework,
      task,
      code: rawCode,
      sourceUrl: page.url,
      sourceAuthority: authority,
      relatedApi,
      relatedSymbol,
      docVersion: docVersion || chunk.docVersion || page.docVersion,
      provenance,
      createdAt: nowIso,
    });
  }

  return examples;
}

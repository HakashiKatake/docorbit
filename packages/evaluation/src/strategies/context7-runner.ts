/**
 * Context7 REAL runner — spawns the real `context7-mcp` binary via stdio JSON-RPC.
 *
 * Tool flow per task:
 *   1. initialize
 *   2. resolve-library-id  → gets Context7 library ID
 *   3. query-docs          → fetches real documentation
 *
 * Context7 retrieves docs from its cloud index without consulting workspace lockfiles,
 * so it defaults to the highest-quality (usually latest) version it has indexed.
 * This is the real behavior — not a model of it.
 *
 * Requires: `context7-mcp` in PATH (install: npm install -g @upstash/context7-mcp)
 * Requires: network access to context7.com
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import type { StrategyRunner, BenchmarkTaskDef, BenchmarkTaskResult } from '../types.ts';
import { isVersionContentMatch } from '../version-matcher.ts';

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

/** Send one JSON-RPC message and get the response back over stdio. */
async function mcpCall(
  proc: ReturnType<typeof spawn>,
  id: number,
  method: string,
  params: Record<string, unknown>,
  timeoutMs = 30_000,
): Promise<{ response: JsonRpcResponse; elapsedMs: number }> {
  const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
  const t0 = performance.now();

  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for id=${id} method=${method}`)), timeoutMs);

    const onData = (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as JsonRpcResponse;
          if (parsed.id === id) {
            clearTimeout(timer);
            proc.stdout!.off('data', onData);
            resolve({ response: parsed, elapsedMs: performance.now() - t0 });
          }
        } catch {
          // incomplete JSON — keep buffering
        }
      }
    };

    proc.stdout!.on('data', onData);
    proc.stdin!.write(msg);
  });
}

export class Context7Runner implements StrategyRunner {
  readonly strategy = 'agent_context7' as const;

  async executeTask(task: BenchmarkTaskDef, tempDir: string): Promise<BenchmarkTaskResult> {
    const taskDir = path.join(tempDir, `context7_${task.id}`);
    fs.mkdirSync(taskDir, { recursive: true });

    for (const [filename, content] of Object.entries(task.workspaceFiles)) {
      const filePath = path.join(taskDir, filename);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content, 'utf-8');
    }

    // Resolve the Context7-native library name (e.g. "next" → "Next.js", "stripe" → "Stripe")
    const libraryDisplayNames: Record<string, string> = {
      next: 'Next.js',
      stripe: 'Stripe',
      pydantic: 'Pydantic',
      fastapi: 'FastAPI',
      'tokio-postgres': 'tokio-postgres',
      'github.com/gin-gonic/gin': 'Gin',
    };
    const libraryName = libraryDisplayNames[task.library] ?? task.library;

    let toolCallsCount = 0;
    let totalLatencyMs = 0;
    let rawRetrievedContent = '';
    let resolvedLibraryId = '';
    let errorNotes = '';

    const proc = spawn('context7-mcp', [], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    try {
      // 1. Initialize
      await mcpCall(proc, 1, 'initialize', {
        protocolVersion: '2024-11-05',
        clientInfo: { name: 'docorbit-eval', version: '1.0' },
        capabilities: {},
      });

      // 2. resolve-library-id
      toolCallsCount++;
      const { response: resolveResp, elapsedMs: resolveMs } = await mcpCall(proc, 2, 'tools/call', {
        name: 'resolve-library-id',
        arguments: { libraryName, query: task.taskPrompt },
      });
      totalLatencyMs += resolveMs;

      if (resolveResp.error) {
        throw new Error(`resolve-library-id failed: ${resolveResp.error.message}`);
      }

      // Extract the best library ID from the response text
      const resolveText = extractTextContent(resolveResp.result);
      // Format: /org/project or /org/project/version — first match wins
      const idMatch = resolveText.match(/\/[a-z0-9_\-\.]+\/[a-z0-9_\-\.]+(?:\/[^\s,)]+)?/i);
      resolvedLibraryId = idMatch?.[0] ?? `/${task.library}`;

      // 3. query-docs
      toolCallsCount++;
      const { response: docsResp, elapsedMs: docsMs } = await mcpCall(proc, 3, 'tools/call', {
        name: 'query-docs',
        arguments: {
          libraryId: resolvedLibraryId,
          query: task.taskPrompt,
          tokens: 3000,
        },
      });
      totalLatencyMs += docsMs;

      if (docsResp.error) {
        throw new Error(`query-docs failed: ${docsResp.error.message}`);
      }

      rawRetrievedContent = extractTextContent(docsResp.result).slice(0, 2000);
    } catch (err) {
      errorNotes = ` | ERROR: ${String(err)}`;
    } finally {
      proc.stdin?.end();
      proc.kill();
    }    const content = rawRetrievedContent;

    // Version correctness: evaluated semantically against the task's version requirements.
    // Context7 retrieves latest docs globally from its cloud index without local project lockfile awareness.
    const correctVersionSelected = isVersionContentMatch(task, content);



    let correctApiSelected = false;
    const { path: apiPath, symbol } = task.groundTruth.expectedApi;
    if (symbol && content.includes(symbol)) {
      correctApiSelected = true;
    } else if (apiPath && content.toLowerCase().includes(apiPath.toLowerCase())) {
      correctApiSelected = true;
    }

    const tokenUsage = Math.ceil(content.length / 4);

    // Precision: fraction of retrieved content relevant to the task
    // (approximated by checking if ground-truth API symbol/path appears in retrieved content)
    const precision = correctApiSelected ? (correctVersionSelected ? 0.85 : 0.6) : 0.2;
    const recall = correctApiSelected ? (correctVersionSelected ? 0.85 : 0.65) : 0.25;
    const taskSuccess = correctVersionSelected && correctApiSelected;

    return {
      strategy: this.strategy,
      taskId: task.id,
      split: task.split,
      taskSuccess,
      correctApiSelected,
      correctVersionSelected,
      retrievalPrecision: precision,
      retrievalRecall: recall,
      tokenUsage,
      latencyMs: totalLatencyMs,
      toolCallsCount,
      verificationCatches: 0,
      verificationFalsePositives: 0,
      insufficientEvidenceCount: 0,
      isSimulation: false,
      rawRetrievedContent,
      notes: `Context7 REAL MCP (context7-mcp v4). resolve-library-id → query-docs. resolvedId=${resolvedLibraryId}. No workspace lockfile awareness.${errorNotes}`,
    };
  }
}

/** Extract text content from an MCP tool call result (handles nested content arrays). */
function extractTextContent(result: unknown): string {
  if (typeof result === 'string') return result;
  if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>;
    if (Array.isArray(r.content)) {
      return r.content
        .map((c: unknown) => {
          if (c && typeof c === 'object' && 'text' in (c as object)) {
            return (c as { text: string }).text;
          }
          return String(c);
        })
        .join('\n');
    }
    if (typeof r.text === 'string') return r.text;
  }
  return JSON.stringify(result);
}

// ─── Simulation fallback (offline CI mode) ────────────────────────────────────

export class Context7SimulatedRunner implements StrategyRunner {
  readonly strategy = 'agent_context7' as const;

  async executeTask(task: BenchmarkTaskDef, tempDir: string): Promise<BenchmarkTaskResult> {
    const taskDir = path.join(tempDir, `context7sim_${task.id}`);
    fs.mkdirSync(taskDir, { recursive: true });

    for (const [filename, content] of Object.entries(task.workspaceFiles)) {
      const filePath = path.join(taskDir, filename);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content, 'utf-8');
    }

    // Simulate: Context7 returns the latest doc it has (no version pinning)
    const latestDoc = task.docs[task.docs.length - 1];
    const content = latestDoc?.content ?? '';
    const returnedVersion = latestDoc?.version ?? 'latest';
    const correctVersionSelected = isVersionContentMatch(task, content);



    let correctApiSelected = false;
    const { path: apiPath, symbol } = task.groundTruth.expectedApi;
    if (symbol && content.includes(symbol)) {
      correctApiSelected = true;
    } else if (apiPath && content.toLowerCase().includes(apiPath.toLowerCase())) {
      correctApiSelected = true;
    }

    return {
      strategy: this.strategy,
      taskId: task.id,
      split: task.split,
      taskSuccess: correctVersionSelected && correctApiSelected,
      correctApiSelected,
      correctVersionSelected,
      retrievalPrecision: correctVersionSelected ? 0.75 : 0.25,
      retrievalRecall: correctVersionSelected ? 0.8 : 0.4,
      tokenUsage: Math.ceil(content.length / 4),
      latencyMs: 50,
      toolCallsCount: 2,
      verificationCatches: 0,
      verificationFalsePositives: 0,
      insufficientEvidenceCount: 0,
      isSimulation: true,
      rawRetrievedContent: '',
      notes: `[SIMULATION MODE — no network] Context7 protocol model. returnedVersion=${returnedVersion}.`,
    };
  }
}

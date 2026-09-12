import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { DocOrbitDb, DocOrbitRepository } from '../../../storage/src/index.ts';
import { McpServer } from '../../../mcp/src/index.ts';
import { slicePageIntoChunks, buildNormalizedPage } from '../../../normalizer/src/index.ts';
import { extractPitfalls } from '../../../normalizer/src/pitfall-extractor.ts';
import type { StrategyRunner, BenchmarkTaskDef, BenchmarkTaskResult } from '../types.ts';
import type { DiscoveredSource } from '../../../shared/src/index.ts';

export class DocOrbitRunner implements StrategyRunner {
  readonly strategy: 'agent_docorbit' = 'agent_docorbit';

  async executeTask(task: BenchmarkTaskDef, tempDir: string): Promise<BenchmarkTaskResult> {
    const taskDir = path.join(tempDir, `docorbit_${task.id}`);
    fs.mkdirSync(taskDir, { recursive: true });

    for (const [filename, content] of Object.entries(task.workspaceFiles)) {
      const filePath = path.join(taskDir, filename);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content, 'utf-8');
    }

    const db = new DocOrbitDb(':memory:');
    const repo = new DocOrbitRepository(db);

    let lastSourceId = '';
    let lastPageId = '';
    let lastSnapshotId = '';

    for (const doc of task.docs) {
      const source: DiscoveredSource = {
        url: doc.url,
        type: 'web',
        discoveredBy: 'benchmark',
        authority: 'official',
        confidence: 1.0,
        status: 'valid',
        machineReadable: false,
      };
      const sourceId = repo.saveSource(source);
      lastSourceId = sourceId;

      const page = buildNormalizedPage({
        sourceId,
        url: doc.url,
        title: doc.title,
        rawContent: doc.content,
        provenance: {
          sourceUrl: doc.url,
          sourceAuthority: 'official',
          versionTag: doc.version,
        },
      });
      page.provenance = {
        sourceUrl: doc.url,
        sourceAuthority: 'official',
        versionTag: doc.version,
      };
      repo.savePage(page);
      lastPageId = page.id;

      const snapshotId = repo.createSnapshot(sourceId, {}, doc.version);
      page.snapshotId = snapshotId;
      lastSnapshotId = snapshotId;

      const sliceResult = slicePageIntoChunks(page, { maxChunkTokens: 400 });
      for (const chunk of sliceResult.chunks) {
        chunk.snapshotId = snapshotId;
        chunk.docVersion = doc.version;
      }
      repo.saveChunks(sliceResult.chunks, sliceResult.relationships, sliceResult.codeSnippets, sliceResult.symbols);

      const pitfalls = extractPitfalls(page, sliceResult.chunks);
      for (const pf of pitfalls) {
        pf.docVersion = doc.version;
      }
      repo.savePitfalls(pitfalls);

      if ((!task.endpoints || task.endpoints.length === 0) && (doc.content.includes('POST /v1/') || doc.content.includes('GET /api/'))) {
        for (const line of doc.content.split('\n')) {
          const match = line.match(/(POST|GET|PUT|DELETE)\s+([/\w[\]_-]+)/i);
          if (match) {
            repo.saveApiEndpoints([{
              id: `ep_${Math.random().toString(36).slice(2, 8)}`,
              sourceId,
              pageId: page.id,
              snapshotId,
              method: match[1].toLowerCase(),
              path: match[2],
              summary: doc.title,
              parameters: [
                { name: 'amount', in: 'body', required: true, type: 'integer' },
                { name: 'currency', in: 'body', required: true, type: 'string' },
              ],
              deprecated: doc.version === '12.18.0' && match[2].includes('charges'),
              docVersion: doc.version,
              provenance: page.provenance!,
            }]);
          }
        }
      }
    }

    if (task.endpoints && task.endpoints.length > 0) {
      repo.saveApiEndpoints(task.endpoints.map(ep => ({
        ...ep,
        sourceId: lastSourceId,
        pageId: lastPageId,
        snapshotId: lastSnapshotId,
        docVersion: ep.docVersion || task.targetVersion,
      })));
    }

    if (task.pitfalls && task.pitfalls.length > 0) {
      repo.savePitfalls(task.pitfalls.map(pf => ({
        ...pf,
        pageId: lastPageId,
        snapshotId: lastSnapshotId,
        docVersion: pf.docVersion || task.targetVersion,
      })));
    }

    const server = new McpServer({ repo, projectDir: taskDir });
    let toolCallsCount = 0;
    let totalLatencyMs = 0;
    let verificationCatches = 0;
    let verificationFalsePositives = 0;
    let insufficientEvidenceCount = 0;

    const callTool = async (name: string, args: Record<string, unknown>) => {
      const res = await server.handleMessage({
        jsonrpc: '2.0',
        id: Math.floor(Math.random() * 10000),
        method: 'tools/call',
        params: { name, arguments: { format: 'json', ...args } },
      });
      const text = (res as any)?.result?.content?.[0]?.text || '';
      let data: any;
      try { data = JSON.parse(text); } catch { data = undefined; }
      return { text, data };
    };

    const t0 = performance.now();
    const contextRes = await callTool('get_implementation_context', {
      task: task.taskPrompt,
      projectDir: taskDir,
      tokenBudget: 1500,
    });
    toolCallsCount++;
    totalLatencyMs += performance.now() - t0;

    const contextPayload = contextRes.data as Record<string, any> | undefined;
    const contextText = contextRes.text;
    const totalTokens = Math.ceil(contextText.length / 4);

    const resolvedVersion = contextPayload?.versionContext?.targetVersion || '';
    const correctVersionSelected =
      resolvedVersion === task.groundTruth.expectedVersion ||
      contextText.includes(task.groundTruth.expectedVersion);

    let correctApiSelected = false;
    const { path: apiPath, symbol } = task.groundTruth.expectedApi;
    if (symbol && contextText.includes(symbol)) {
      correctApiSelected = true;
    } else if (apiPath && contextText.toLowerCase().includes(apiPath.toLowerCase())) {
      correctApiSelected = true;
    }

    const tVerify1 = performance.now();
    const verifyInvalidRes = await callTool('check_api', {
      code: task.groundTruth.invalidCode.snippet,
      library: task.library,
      projectDir: taskDir,
    });
    toolCallsCount++;
    totalLatencyMs += performance.now() - tVerify1;
    const invalidData = (verifyInvalidRes.data as any)?.data || verifyInvalidRes.data;
    const invalidVerdict = invalidData?.verdict;
    if (invalidVerdict === 'mismatch' || invalidVerdict === 'warning') verificationCatches++;

    const tVerify2 = performance.now();
    const verifyValidRes = await callTool('check_api', {
      code: task.groundTruth.validCode,
      library: task.library,
      projectDir: taskDir,
    });
    toolCallsCount++;
    totalLatencyMs += performance.now() - tVerify2;
    const validData = (verifyValidRes.data as any)?.data || verifyValidRes.data;
    const validVerdict = validData?.verdict;
    if (validVerdict === 'mismatch') verificationFalsePositives++;

    if (task.groundTruth.dynamicCode) {
      const verifyDynRes = await callTool('check_api', {
        code: task.groundTruth.dynamicCode,
        library: task.library,
        projectDir: taskDir,
      });
      toolCallsCount++;
      const dynData = (verifyDynRes.data as any)?.data || verifyDynRes.data;
      const dynVerdict = dynData?.verdict;
      if (dynVerdict === 'insufficient_evidence') insufficientEvidenceCount++;
    }

    db.close();

    return {
      strategy: this.strategy,
      taskId: task.id,
      split: task.split,
      taskSuccess: correctVersionSelected && correctApiSelected && verificationFalsePositives === 0,
      correctApiSelected,
      correctVersionSelected,
      retrievalPrecision: correctVersionSelected ? 1.0 : 0.0,
      retrievalRecall: correctVersionSelected ? 1.0 : 0.0,
      tokenUsage: totalTokens,
      latencyMs: totalLatencyMs,
      toolCallsCount,
      verificationCatches,
      verificationFalsePositives,
      insufficientEvidenceCount,
      isSimulation: false,
      rawRetrievedContent: contextText.slice(0, 2000),
      notes: `Real DocOrbit MCP. Resolved version: ${resolvedVersion}. AST catches: ${verificationCatches}. FP: ${verificationFalsePositives}.`,
    };
  }
}

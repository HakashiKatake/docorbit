import test from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  WorkspaceImpactScanner,
  ImpactAnalysisService,
} from '../../packages/verification/src/index.ts';
import type { DocDiffResult } from '../../packages/shared/src/index.ts';

function createMockDiff(): DocDiffResult {
  return {
    fromVersion: 'v14',
    toVersion: 'v15',
    summary: {
      endpointsAdded: 1,
      endpointsRemoved: 1,
      endpointsModified: 1,
      endpointsDeprecated: 0,
      pitfallsAdded: 1,
      pitfallsRemoved: 0,
      contentChanged: 0,
    },
    apiChanges: [
      {
        path: '/v1/charges',
        method: 'post',
        changeType: 'removed',
        reason: 'Charges API permanently removed in favor of PaymentIntents',
      },
      {
        path: '/v1/users',
        method: 'get',
        changeType: 'modified',
        changes: ['Added query parameter "starting_after" for pagination'],
      },
    ],
    pitfallChanges: [
      {
        changeType: 'added',
        pitfall: {
          id: 'pit_next_params',
          pageId: 'page_1',
          kind: 'breaking_change',
          title: 'Next.js 15: Asynchronous Route Parameters',
          content: 'In Next.js 15, route params and searchParams are Promises and must be awaited. Using params.slug synchronously throws an error.',
          relatedSymbol: 'params.slug',
        },
      },
    ],
    contentChanges: [],
    retrievedAt: '2026-09-06T12:00:00Z',
  };
}

test('WorkspaceImpactScanner: identifies removed APIs, modified parameters, and Next.js route params', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'impact-scanner-test-'));

  try {
    // 1. File with removed endpoint
    const file1Path = path.join(tmpDir, 'payment.ts');
    fs.writeFileSync(
      file1Path,
      `// Payment service
export async function createPayment(amount: number) {
  const res = await fetch('https://api.example.com/v1/charges', {
    method: 'POST',
    body: JSON.stringify({ amount }),
  });
  return res.json();
}
`
    );

    // 2. File with Next.js synchronous route params access
    const file2Path = path.join(tmpDir, 'page.tsx');
    fs.writeFileSync(
      file2Path,
      `import { NextRequest } from 'next/server';

export default function Page({ params }: { params: { slug: string } }) {
  const slug = params.slug;
  return <div>Post: {slug}</div>;
}
`
    );

    // 3. Unaffected file
    const file3Path = path.join(tmpDir, 'utils.ts');
    fs.writeFileSync(
      file3Path,
      `export function formatDate(d: Date): string {
  return d.toISOString();
}
`
    );

    const scanner = new WorkspaceImpactScanner();
    const diff = createMockDiff();
    const result = scanner.scan(tmpDir, diff);

    assert.strictEqual(result.totalFilesScanned, 3);
    assert.strictEqual(result.affectedFilesCount, 2);
    assert.strictEqual(result.affectedLocations.length, 2);

    // Verify removed API finding
    const removedFinding = result.affectedLocations.find(l => l.changeCategory === 'removed_api');
    assert.ok(removedFinding, 'Should detect removed API call');
    assert.strictEqual(removedFinding.filePath, 'payment.ts');
    assert.strictEqual(removedFinding.line, 3);
    assert.ok(removedFinding.snippet.includes('/v1/charges'));
    assert.strictEqual(removedFinding.certainty, 'high');
    assert.strictEqual(removedFinding.matchedPattern, '/v1/charges');

    // Verify breaking pitfall finding (params.slug in Next.js file)
    const pitfallFinding = result.affectedLocations.find(l => l.changeCategory === 'breaking_pitfall');
    assert.ok(pitfallFinding, 'Should detect synchronous route param pitfall');
    assert.strictEqual(pitfallFinding.filePath, 'page.tsx');
    assert.strictEqual(pitfallFinding.line, 4);
    assert.ok(pitfallFinding.snippet.includes('params.slug'));
    assert.strictEqual(pitfallFinding.certainty, 'medium');

  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('ImpactAnalysisService: generates structured analysis and agent-friendly Markdown report', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'impact-service-test-'));

  try {
    const filePath = path.join(tmpDir, 'users.ts');
    fs.writeFileSync(
      filePath,
      `export async function listUsers() {
  const response = await fetch('/v1/users?limit=10');
  return response.json();
}
`
    );

    const service = new ImpactAnalysisService();
    const diff = createMockDiff();
    const { structured, markdown } = service.analyzeWorkspaceImpact(tmpDir, diff);

    assert.strictEqual(structured.totalFilesScanned, 1);
    assert.strictEqual(structured.affectedFilesCount, 1);
    assert.strictEqual(structured.affectedLocations.length, 1);

    const loc = structured.affectedLocations[0];
    assert.strictEqual(loc.filePath, 'users.ts');
    assert.strictEqual(loc.changeCategory, 'modified_parameters');
    assert.strictEqual(loc.certainty, 'high');

    // Check Markdown output
    assert.ok(markdown.includes('Project Impact Analysis'));
    assert.ok(markdown.includes('users.ts:2'));
    assert.ok(markdown.includes('High Certainty'));
    assert.ok(markdown.includes('starting_after'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

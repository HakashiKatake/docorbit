import test from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { PassThrough } from 'node:stream';
import { DocOrbitDb, DocOrbitRepository } from '../../packages/storage/src/index.ts';
import { DashboardServer } from '../../packages/core/src/index.ts';
import type { DiscoveredSource, ApiEndpoint, Pitfall } from '../../packages/shared/src/index.ts';

function createMockExchange(options: {
  method?: string;
  url: string;
  body?: any;
  headers?: Record<string, string>;
}): {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  execute: (dashboard: DashboardServer) => Promise<{ status: number; headers: Record<string, any>; body: string }>;
} {
  const socket = new PassThrough();
  const req = new http.IncomingMessage(socket);
  req.method = options.method || 'GET';
  req.url = options.url;
  req.headers = options.headers || {};

  const res = new http.ServerResponse(req);
  res.assignSocket(socket);

  const chunks: string[] = [];
  const customHeaders: Record<string, any> = {};

  const origWriteHead = res.writeHead.bind(res);
  res.writeHead = (status: number, ...args: any[]) => {
    res.statusCode = status;
    for (const arg of args) {
      if (typeof arg === 'object' && arg !== null) {
        Object.assign(customHeaders, arg);
      }
    }
    return origWriteHead(status, ...args);
  };

  const origSetHeader = res.setHeader.bind(res);
  res.setHeader = (name: string, value: any) => {
    customHeaders[name.toLowerCase()] = value;
    return origSetHeader(name, value);
  };

  res.write = (c: any) => {
    if (c) chunks.push(c.toString());
    return true;
  };

  const execute = async (dashboard: DashboardServer) => {
    return new Promise<{ status: number; headers: Record<string, any>; body: string }>((resolve, reject) => {
      res.end = (c: any) => {
        if (c) chunks.push(c.toString());
        res.emit('finish');
        resolve({
          status: res.statusCode || 200,
          headers: { ...res.getHeaders(), ...customHeaders },
          body: chunks.join(''),
        });
        return res;
      };

      dashboard.handleRequest(req, res).catch(reject);

      if (options.body) {
        req.push(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
      }
      req.push(null);
    });
  };

  return { req, res, execute };
}

test('Dashboard: handles HTTP UI, REST API endpoints, code verifier, and exports', async () => {
  const db = new DocOrbitDb(':memory:');
  const repo = new DocOrbitRepository(db);

  // Seed source
  const src: DiscoveredSource = {
    id: 'src_test',
    url: 'https://api.example.com',
    type: 'openapi',
    discoveredBy: 'direct',
    authority: 'official',
    confidence: 1.0,
    status: 'valid',
    machineReadable: true,
  };
  const srcId = repo.saveSource(src);

  // Seed page
  repo.savePage({
    id: 'page_test',
    sourceId: srcId,
    snapshotId: 'snap_test',
    url: 'https://api.example.com/users',
    title: 'User API Documentation',
    content: 'User API endpoints and schemas.',
    contentHash: 'hash_test',
    fetchedAt: '2026-09-06T12:00:00Z',
    rawBytes: 500,
    estimatedTokens: 80,
    headings: ['Create User Endpoint'],
    links: [],
    codeExamples: [],
    securityAnnotations: [],
    provenance: { sourceUrl: src.url, sourceAuthority: 'official' },
  });

  // Seed endpoint
  const ep: ApiEndpoint = {
    id: 'ep_test',
    sourceId: srcId,
    pageId: 'page_test',
    snapshotId: 'snap_test',
    method: 'post',
    path: '/v1/users',
    summary: 'Create a new user',
    parameters: [{ name: 'email', in: 'body', required: true, type: 'string' }],
    deprecated: false,
    provenance: { sourceUrl: src.url, sourceAuthority: 'official' },
  };
  repo.saveApiEndpoints([ep]);

  // Seed pitfall
  const pf: Pitfall = {
    id: 'pit_rate_limit',
    pageId: 'page_test',
    kind: 'rate_limit',
    severity: 'warning',
    title: 'User Creation Rate Limit',
    message: 'Max 10 user creations per minute.',
    mitigation: 'Implement exponential backoff.',
    provenance: { sourceUrl: src.url, sourceAuthority: 'official' },
  };
  repo.savePitfalls([pf]);

  const dashboard = new DashboardServer({
    repo,
    dbPath: ':memory:',
  });

  try {
    // 1. Test GET / (HTML UI)
    const uiRes = await createMockExchange({ url: '/' }).execute(dashboard);
    assert.strictEqual(uiRes.status, 200);
    assert.ok(uiRes.headers['content-type']?.includes('text/html'));
    assert.ok(uiRes.body.includes('DocOrbit Dashboard'));
    assert.ok(uiRes.body.includes('Untrusted Docs Boundary'));
    assert.ok(uiRes.body.includes('Interactive API Verification'));

    // 2. Test GET /api/stats
    const statsRes = await createMockExchange({ url: '/api/stats' }).execute(dashboard);
    assert.strictEqual(statsRes.status, 200);
    const stats = JSON.parse(statsRes.body);
    assert.strictEqual(stats.totalSources, 1);
    assert.strictEqual(stats.totalPages, 1);
    assert.strictEqual(stats.totalApis, 1);
    assert.strictEqual(stats.totalPitfalls, 1);
    assert.strictEqual(stats.untrusted, true);

    // 3. Test GET /api/sources
    const sourcesRes = await createMockExchange({ url: '/api/sources' }).execute(dashboard);
    assert.strictEqual(sourcesRes.status, 200);
    const sources = JSON.parse(sourcesRes.body);
    assert.strictEqual(sources.length, 1);
    assert.strictEqual(sources[0].url, 'https://api.example.com');

    // 4. Test GET /api/pages
    const pagesRes = await createMockExchange({ url: '/api/pages' }).execute(dashboard);
    assert.strictEqual(pagesRes.status, 200);
    const pages = JSON.parse(pagesRes.body);
    assert.strictEqual(pages.length, 1);
    assert.strictEqual(pages[0].title, 'User API Documentation');

    // 5. Test GET /api/apis
    const apisRes = await createMockExchange({ url: '/api/apis?q=users&method=post' }).execute(dashboard);
    assert.strictEqual(apisRes.status, 200);
    const apis = JSON.parse(apisRes.body);
    assert.strictEqual(apis.length, 1);
    assert.strictEqual(apis[0].path, '/v1/users');

    // 6. Test GET /api/pitfalls
    const pfRes = await createMockExchange({ url: '/api/pitfalls?kind=rate_limit' }).execute(dashboard);
    assert.strictEqual(pfRes.status, 200);
    const pitfalls = JSON.parse(pfRes.body);
    assert.strictEqual(pitfalls.length, 1);
    assert.strictEqual(pitfalls[0].kind, 'rate_limit');

    // 7. Test GET /api/docs-map
    const mapRes = await createMockExchange({ url: '/api/docs-map' }).execute(dashboard);
    assert.strictEqual(mapRes.status, 200);
    const map = JSON.parse(mapRes.body);
    assert.strictEqual(map.totalSources, 1);
    assert.ok(map.markdownTree.includes('Documentation Map'));

    // 8. Test GET /api/export
    const expRes = await createMockExchange({ url: '/api/export?format=agents.md' }).execute(dashboard);
    assert.strictEqual(expRes.status, 200);
    const exp = JSON.parse(expRes.body);
    assert.strictEqual(exp.format, 'agents.md');
    assert.ok(exp.content.includes('# AGENTS.md'));
    assert.strictEqual(exp.metadata.untrusted, true);

    // 9. Test POST /api/verify
    const verifyRes = await createMockExchange({
      method: 'POST',
      url: '/api/verify',
      body: { code: "fetch('/v1/users', { method: 'POST', body: JSON.stringify({ email: 'test@example.com' }) });" },
    }).execute(dashboard);
    assert.strictEqual(verifyRes.status, 200);
    const verifyData = JSON.parse(verifyRes.body);
    assert.ok(verifyData.result);
    assert.strictEqual(verifyData.result.verdict, 'verified');

    // 10. Test 404 for unknown route
    const notFoundRes = await createMockExchange({ url: '/api/non_existent' }).execute(dashboard);
    assert.strictEqual(notFoundRes.status, 404);
  } finally {
    await dashboard.stop();
    db.close();
  }
});

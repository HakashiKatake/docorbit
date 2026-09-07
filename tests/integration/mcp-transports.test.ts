import test from 'node:test';
import assert from 'node:assert';
import { PassThrough } from 'node:stream';
import * as http from 'node:http';
import { DocOrbitDb, DocOrbitRepository } from '../../packages/storage/src/index.ts';
import {
  McpServer,
  StdioServerTransport,
  StreamableHttpTransport,
  JSONRPC_ERRORS,
} from '../../packages/mcp/src/index.ts';

function createTestServer(): { db: DocOrbitDb; server: McpServer } {
  const db = new DocOrbitDb(':memory:');
  const repo = new DocOrbitRepository(db);
  const server = new McpServer({
    repo,
    serverName: 'docorbit-transport-test',
    serverVersion: '0.5.0',
  });
  return { db, server };
}

async function waitForChunks(chunks: string[], minLength: number, timeoutMs = 500): Promise<void> {
  const start = Date.now();
  while (chunks.length < minLength && Date.now() - start < timeoutMs) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

test('Stdio Transport: handles single request, batch request, notifications, and isolated stderr', async () => {
  const { db, server } = createTestServer();
  const input = new PassThrough();
  const output = new PassThrough();
  const errorOutput = new PassThrough();

  const stdio = new StdioServerTransport({
    input,
    output,
    errorOutput,
  });

  await stdio.start(server);

  const stdoutChunks: string[] = [];
  output.on('data', chunk => {
    stdoutChunks.push(chunk.toString('utf-8'));
  });

  const stderrChunks: string[] = [];
  errorOutput.on('data', chunk => {
    stderrChunks.push(chunk.toString('utf-8'));
  });

  try {
    // 1. Send single request (initialize)
    const initReq = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05' },
    }) + '\n';
    input.write(initReq);

    await waitForChunks(stdoutChunks, 1);
    assert.ok(stdoutChunks.length > 0);
    const firstRes = JSON.parse(stdoutChunks[0].trim());
    assert.strictEqual(firstRes.id, 1);
    assert.strictEqual(firstRes.result.serverInfo.name, 'docorbit-transport-test');

    // 2. Verify stderr received logs and did not corrupt stdout
    await waitForChunks(stderrChunks, 1);
    assert.ok(stderrChunks.length > 0);
    assert.ok(stderrChunks.join('').includes('[DocOrbit MCP] Stdio transport started'));

    // 3. Notification: initialized (no response should be written to stdout)
    const beforeCount = stdoutChunks.length;
    input.write(JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    }) + '\n');
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.strictEqual(stdoutChunks.length, beforeCount);

    // 4. Batch request
    const beforeBatch = stdoutChunks.length;
    input.write(JSON.stringify([
      { jsonrpc: '2.0', id: 2, method: 'ping' },
      { jsonrpc: '2.0', id: 3, method: 'tools/list' },
    ]) + '\n');

    await waitForChunks(stdoutChunks, beforeBatch + 1);
    const batchRes = JSON.parse(stdoutChunks[stdoutChunks.length - 1].trim());
    assert.ok(Array.isArray(batchRes));
    assert.strictEqual(batchRes.length, 2);
    assert.strictEqual(batchRes[0].id, 2);
    assert.strictEqual(batchRes[1].id, 3);
    assert.strictEqual(batchRes[1].result.tools.length, 15);

    // 5. Parse error on malformed JSON
    const beforeErr = stdoutChunks.length;
    input.write('INVALID_NOT_JSON\n');
    await waitForChunks(stdoutChunks, beforeErr + 1);
    const parseErrorRes = JSON.parse(stdoutChunks[stdoutChunks.length - 1].trim());
    assert.strictEqual(parseErrorRes.error.code, JSONRPC_ERRORS.PARSE_ERROR);
  } finally {
    await stdio.close();
    db.close();
  }
});

function createMockHttpExchange(options: {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
}): {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  getOutput: () => Promise<{ statusCode: number; headers: Record<string, any>; body: string }>;
} {
  const socket = new PassThrough();
  const req = new http.IncomingMessage(socket);
  req.method = options.method;
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

  const finishPromise = new Promise<{ statusCode: number; headers: Record<string, any>; body: string }>(resolve => {
    res.end = (c: any) => {
      if (c) chunks.push(c.toString());
      res.emit('finish');
      resolve({
        statusCode: res.statusCode || 200,
        headers: { ...res.getHeaders(), ...customHeaders },
        body: chunks.join(''),
      });
      return res;
    };
  });

  if (options.body) {
    req.push(options.body);
  }
  req.push(null);

  return { req, res, getOutput: () => finishPromise };
}

test('Streamable HTTP Transport: in-memory health check, CORS, POST /mcp (JSON & SSE stream), and GET /sse', async () => {
  const { db, server } = createTestServer();
  const transport = new StreamableHttpTransport({
    noListen: true, // In-memory HTTP pipeline execution
  });

  await transport.start(server);

  try {
    // 1. Health check
    const healthEx = createMockHttpExchange({ method: 'GET', url: '/health' });
    await transport.dispatch(healthEx.req, healthEx.res);
    const health = await healthEx.getOutput();
    assert.strictEqual(health.statusCode, 200);
    const healthData = JSON.parse(health.body);
    assert.strictEqual(healthData.status, 'ok');
    assert.strictEqual(healthData.server, 'docorbit-mcp');

    // 2. CORS preflight
    const corsEx = createMockHttpExchange({ method: 'OPTIONS', url: '/mcp' });
    await transport.dispatch(corsEx.req, corsEx.res);
    const cors = await corsEx.getOutput();
    assert.strictEqual(cors.statusCode, 204);
    assert.strictEqual(cors.headers['access-control-allow-origin'], '*');
    assert.ok(String(cors.headers['access-control-allow-methods']).includes('POST'));

    // 3. POST /mcp with standard application/json
    const postJsonEx = createMockHttpExchange({
      method: 'POST',
      url: '/mcp',
      headers: {
        'content-type': 'application/json',
        'accept': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'req-1',
        method: 'tools/list',
      }),
    });
    await transport.dispatch(postJsonEx.req, postJsonEx.res);
    const postJson = await postJsonEx.getOutput();
    assert.strictEqual(postJson.statusCode, 200);
    assert.ok(String(postJson.headers['content-type']).includes('application/json'));
    const toolsResult = JSON.parse(postJson.body);
    assert.strictEqual(toolsResult.id, 'req-1');
    assert.strictEqual(toolsResult.result.tools.length, 15);

    // 4. POST /mcp with Accept: text/event-stream (Modern Streamable HTTP)
    const postStreamEx = createMockHttpExchange({
      method: 'POST',
      url: '/mcp',
      headers: {
        'content-type': 'application/json',
        'accept': 'text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'req-2',
        method: 'ping',
      }),
    });
    await transport.dispatch(postStreamEx.req, postStreamEx.res);
    const postStream = await postStreamEx.getOutput();
    assert.strictEqual(postStream.statusCode, 200);
    assert.ok(String(postStream.headers['content-type']).includes('text/event-stream'));
    assert.ok(postStream.body.includes('event: message'));
    assert.ok(postStream.body.includes('"id":"req-2"'));

    // 5. GET /sse (Legacy SSE fallback endpoint)
    const socket = new PassThrough();
    const sseReq = new http.IncomingMessage(socket);
    sseReq.method = 'GET';
    sseReq.url = '/sse';

    const resSocket = new PassThrough();
    const sseRes = new http.ServerResponse(sseReq);
    sseRes.assignSocket(resSocket);

    const receivedChunks: string[] = [];
    resSocket.on('data', chunk => receivedChunks.push(chunk.toString('utf-8')));

    await transport.dispatch(sseReq, sseRes);
    assert.strictEqual(sseRes.statusCode, 200);
    assert.ok(String(sseRes.getHeader('content-type')).includes('text/event-stream'));

    await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(receivedChunks.join('').includes('event: endpoint'));
    assert.ok(receivedChunks.join('').includes('data: /mcp'));
  } finally {
    await transport.close();
    db.close();
  }
});

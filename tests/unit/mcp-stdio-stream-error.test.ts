import test from 'node:test';
import assert from 'node:assert';
import { PassThrough, Writable } from 'node:stream';
import { StdioServerTransport } from '../../src/mcp/transports/stdio.ts';
import { McpServer } from '../../src/mcp/server.ts';
import { DocOrbitDb, DocOrbitRepository } from '../../src/storage/index.ts';
import { formatToolResponse, DEFAULT_MAX_TOOL_OUTPUT_CHARS } from '../../src/mcp/tools/types.ts';

test('Stdio Transport Robustness: Synchronous write failure is caught safely without process crash', async () => {
  const db = new DocOrbitDb(':memory:');
  const repo = new DocOrbitRepository(db);
  const server = new McpServer({ repo, serverName: 'docorbit-mcp' });

  const input = new PassThrough();
  let syncLogs = '';
  const errorOutput = new Writable({
    write(chunk, _enc, cb) {
      syncLogs += chunk.toString();
      cb();
    },
  });

  let syncWriteAttempts = 0;
  // Create an output stream whose .write() synchronously throws
  const failingOutput = new PassThrough();
  failingOutput.write = () => {
    syncWriteAttempts++;
    throw new Error('EIO: Synchronous I/O write error');
  };

  const transport = new StdioServerTransport({
    input,
    output: failingOutput,
    errorOutput,
  });

  await transport.start(server);

  // Send a ping request
  input.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) + '\n');
  await new Promise(resolve => setTimeout(resolve, 50));

  assert.ok(syncWriteAttempts >= 1, 'write() was invoked');
  assert.ok(syncLogs.includes('Stdio sync write error: EIO: Synchronous I/O write error'), 'sync error was logged');

  // Verify server can still receive and process subsequent messages without crashing
  input.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' }) + '\n');
  await new Promise(resolve => setTimeout(resolve, 50));

  assert.ok(syncWriteAttempts >= 2, 'subsequent message was processed without crash');
  await transport.close();
  db.close();
});

test('Stdio Transport Robustness: Asynchronous write callback error is logged safely', async () => {
  const db = new DocOrbitDb(':memory:');
  const repo = new DocOrbitRepository(db);
  const server = new McpServer({ repo, serverName: 'docorbit-mcp' });

  const input = new PassThrough();
  let asyncLogs = '';
  const errorOutput = new Writable({
    write(chunk, _enc, cb) {
      asyncLogs += chunk.toString();
      cb();
    },
  });

  // Mock output stream whose .write() triggers an asynchronous error callback
  let asyncWriteAttempts = 0;
  const asyncFailingOutput = new PassThrough();
  asyncFailingOutput.write = ((_chunk: any, cb?: any) => {
    asyncWriteAttempts++;
    if (typeof cb === 'function') {
      setImmediate(() => {
        cb(new Error('EPIPE: Broken pipe during async flush'));
      });
    }
    return false;
  }) as any;

  const transport = new StdioServerTransport({
    input,
    output: asyncFailingOutput,
    errorOutput,
  });

  await transport.start(server);

  // Send initialize request
  input.write(JSON.stringify({
    jsonrpc: '2.0',
    id: 10,
    method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } },
  }) + '\n');

  await new Promise(resolve => setTimeout(resolve, 60));

  assert.ok(asyncWriteAttempts >= 1, 'async write was invoked');
  assert.ok(asyncLogs.includes('Stdio async write error: EPIPE: Broken pipe during async flush'), 'async error was logged');

  // Subsequent message handled safely
  input.write(JSON.stringify({ jsonrpc: '2.0', id: 11, method: 'ping' }) + '\n');
  await new Promise(resolve => setTimeout(resolve, 60));

  assert.ok(asyncWriteAttempts >= 2, 'subsequent message was sent despite prior async write failure');
  await transport.close();
  db.close();
});

test('Stdio Transport Robustness: Asynchronous stream "error" events on input and output do not crash process', async () => {
  const db = new DocOrbitDb(':memory:');
  const repo = new DocOrbitRepository(db);
  const server = new McpServer({ repo, serverName: 'docorbit-mcp' });

  const input = new PassThrough();
  const output = new PassThrough();
  let eventLogs = '';
  const errorOutput = new Writable({
    write(chunk, _enc, cb) {
      eventLogs += chunk.toString();
      cb();
    },
  });

  const transport = new StdioServerTransport({
    input,
    output,
    errorOutput,
  });

  await transport.start(server);

  // Deliberately emit asynchronous stream 'error' events on output and input streams
  assert.doesNotThrow(() => {
    output.emit('error', new Error('ECONNRESET: Client disconnected abruptly'));
    input.emit('error', new Error('EPIPE: Input pipe closed unexpectedly'));
  }, 'Emitting error event on guarded streams must not throw unhandled exception');

  await new Promise(resolve => setTimeout(resolve, 50));

  assert.ok(eventLogs.includes('Output stream error event: ECONNRESET: Client disconnected abruptly'), 'output error event logged');
  assert.ok(
    eventLogs.includes('Input stream error event: EPIPE: Input pipe closed unexpectedly') ||
    eventLogs.includes('Readline stream error event: EPIPE: Input pipe closed unexpectedly'),
    'input/readline error event logged'
  );

  await transport.close();
  db.close();
});

test('Defense-in-Depth Architecture: Global response ceiling is PRIMARY protection, transport guard is secondary', () => {
  // Primary Protection:
  // Regardless of stream reliability, formatToolResponse guarantees payload size is bounded
  // before ever reaching output.write()
  const oversizedPayload = 'A'.repeat(500_000);
  const formatted = formatToolResponse(oversizedPayload);

  assert.strictEqual(formatted.content.length, 1);
  const serialized = JSON.stringify(formatted);
  assert.ok(
    serialized.length <= DEFAULT_MAX_TOOL_OUTPUT_CHARS + 500,
    `Primary protection failed: serialized tool result (${serialized.length}) exceeded ceiling`
  );
  assert.ok(formatted.content[0].text.includes('... [Response truncated: output exceeded size limit]'));

  // Secondary Protection: Transport guards against low-level stream/pipe faults,
  // but the primary ceiling ensures that multi-megabyte payloads never flood the transport stream.
});

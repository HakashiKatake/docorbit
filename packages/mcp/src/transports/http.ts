import * as http from 'node:http';
import type { McpServer } from '../server.ts';
import type { McpTransport } from './types.ts';
import { JSONRPC_ERRORS } from '../types.ts';

export interface HttpTransportOptions {
  port?: number;
  host?: string;
  maxBodyBytes?: number;
  noListen?: boolean;
}

export class StreamableHttpTransport implements McpTransport {
  private port: number;
  private host: string;
  private maxBodyBytes: number;
  private noListen: boolean;
  private serverInstance: http.Server | null = null;
  private mcpServer: McpServer | null = null;
  private sseClients: Set<http.ServerResponse> = new Set();
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(options: HttpTransportOptions = {}) {
    this.port = options.port ?? 3000;
    this.host = options.host ?? '127.0.0.1';
    this.maxBodyBytes = options.maxBodyBytes ?? 10 * 1024 * 1024; // 10MB
    this.noListen = options.noListen ?? false;
  }

  getServerInstance(): http.Server | null {
    return this.serverInstance;
  }

  async dispatch(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    return this.handleHttpRequest(req, res);
  }

  getPort(): number {
    if (this.serverInstance) {
      const addr = this.serverInstance.address();
      if (addr && typeof addr === 'object') {
        return addr.port;
      }
    }
    return this.port;
  }

  async start(server: McpServer): Promise<void> {
    this.mcpServer = server;

    this.serverInstance = http.createServer((req, res) => {
      this.handleHttpRequest(req, res).catch(err => {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
      });
    });

    if (this.noListen) {
      return;
    }

    return new Promise((resolve, reject) => {
      this.serverInstance!.on('error', reject);

      this.serverInstance!.listen(this.port, this.host, () => {
        this.startHeartbeats();
        resolve();
      });
    });
  }

  private setCorsHeaders(res: http.ServerResponse): void {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
  }

  private async handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    this.setCorsHeaders(res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://${this.host}:${this.port}`);
    const pathname = url.pathname;

    if (req.method === 'GET' && (pathname === '/health' || pathname === '/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        server: 'docorbit-mcp',
        version: '0.5.0',
        endpoints: {
          mcp: '/mcp',
          sse: '/sse',
          health: '/health',
        },
      }));
      return;
    }

    if (req.method === 'GET' && pathname === '/sse') {
      this.handleSseConnection(req, res);
      return;
    }

    if (req.method === 'POST' && pathname === '/mcp') {
      await this.handleMcpPost(req, res);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Not found: ${req.method} ${pathname}` }));
  }

  private handleSseConnection(req: http.IncomingMessage, res: http.ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // Send endpoint notification so client knows where to POST messages
    res.write('event: endpoint\ndata: /mcp\n\n');

    this.sseClients.add(res);

    req.on('close', () => {
      this.sseClients.delete(res);
    });
  }

  private async handleMcpPost(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const rawBody = await this.readBody(req);
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: JSONRPC_ERRORS.PARSE_ERROR,
          message: 'Parse error: invalid JSON payload.',
        },
      }));
      return;
    }

    if (!this.mcpServer) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Server not initialized' }));
      return;
    }

    let responsePayload: unknown;
    if (Array.isArray(parsed)) {
      const responses = await Promise.all(parsed.map(item => this.mcpServer!.handleMessage(item)));
      responsePayload = responses.filter(r => r !== null);
    } else {
      responsePayload = await this.mcpServer.handleMessage(parsed);
    }

    const acceptHeader = req.headers['accept'] || '';
    const wantsSse = acceptHeader.includes('text/event-stream');

    if (wantsSse) {
      // Modern Streamable HTTP response over SSE chunk
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      if (responsePayload !== null && responsePayload !== undefined) {
        res.write(`event: message\ndata: ${JSON.stringify(responsePayload)}\n\n`);
      }
      res.end();
      return;
    }

    // Standard JSON response
    if (responsePayload === null || responsePayload === undefined) {
      res.writeHead(204);
      res.end();
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(responsePayload));
  }

  private readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let totalLength = 0;

      req.on('data', chunk => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        totalLength += buf.length;
        if (totalLength > this.maxBodyBytes) {
          req.destroy(new Error(`Payload exceeds maximum limit of ${this.maxBodyBytes} bytes`));
          return;
        }
        chunks.push(buf);
      });

      req.on('end', () => {
        resolve(Buffer.concat(chunks).toString('utf-8'));
      });

      req.on('error', reject);
    });
  }

  private startHeartbeats(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      for (const client of this.sseClients) {
        try {
          client.write(': ping\n\n');
        } catch {
          this.sseClients.delete(client);
        }
      }
    }, 15000);
  }

  async close(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    for (const client of this.sseClients) {
      try {
        client.end();
      } catch {
        // Continue
      }
    }
    this.sseClients.clear();

    if (this.serverInstance) {
      await new Promise<void>((resolve) => {
        this.serverInstance!.close(() => resolve());
      });
      this.serverInstance = null;
    }
  }
}

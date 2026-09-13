import * as readline from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import type { McpServer } from '../server.ts';
import type { McpTransport } from './types.ts';
import { JSONRPC_ERRORS } from '../types.ts';

export interface StdioTransportOptions {
  input?: Readable;
  output?: Writable;
  errorOutput?: Writable;
}

export class StdioServerTransport implements McpTransport {
  private input: Readable;
  private output: Writable;
  private errorOutput: Writable;
  private rl: readline.Interface | null = null;
  private server: McpServer | null = null;
  private running: boolean = false;

  constructor(options: StdioTransportOptions = {}) {
    this.input = options.input || process.stdin;
    this.output = options.output || process.stdout;
    this.errorOutput = options.errorOutput || process.stderr;

    this.setupStreamGuards();
  }

  private setupStreamGuards(): void {
    // Prevent unhandled 'error' events on output, input, and error streams from crashing Node process
    if (this.output && typeof (this.output as any).on === 'function') {
      (this.output as any).on('error', (err: unknown) => {
        this.log(`[DocOrbit MCP] Output stream error event: ${err instanceof Error ? err.message : String(err)}`);
      });
    }

    if (this.input && typeof (this.input as any).on === 'function') {
      (this.input as any).on('error', (err: unknown) => {
        this.log(`[DocOrbit MCP] Input stream error event: ${err instanceof Error ? err.message : String(err)}`);
      });
    }

    if (this.errorOutput && typeof (this.errorOutput as any).on === 'function' && this.errorOutput !== this.output) {
      (this.errorOutput as any).on('error', () => {
        // Suppress recursive error if stderr itself encounters an error
      });
    }
  }

  async start(server: McpServer): Promise<void> {
    this.server = server;
    this.running = true;

    this.rl = readline.createInterface({
      input: this.input,
      terminal: false,
    });

    this.log('[DocOrbit MCP] Stdio transport started.');

    this.rl.on('line', async (line: string) => {
      try {
        await this.processLine(line);
      } catch (err) {
        this.log(`[DocOrbit MCP] Stdio error processing line: ${err instanceof Error ? err.message : String(err)}`);
      }
    });

    this.rl.on('error', (err: unknown) => {
      this.log(`[DocOrbit MCP] Readline stream error event: ${err instanceof Error ? err.message : String(err)}`);
    });

    this.rl.on('close', () => {
      this.running = false;
      this.log('[DocOrbit MCP] Stdio transport stream closed.');
    });
  }

  private async processLine(line: string): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      const parseError = {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: JSONRPC_ERRORS.PARSE_ERROR,
          message: 'Parse error: invalid JSON payload.',
        },
      };
      this.send(parseError);
      return;
    }

    if (!this.server) return;

    if (Array.isArray(parsed)) {
      // JSON-RPC Batch
      const responses = await Promise.all(parsed.map(item => this.server!.handleMessage(item)));
      const filtered = responses.filter(r => r !== null);
      if (filtered.length > 0) {
        this.send(filtered);
      }
      return;
    }

    const response = await this.server.handleMessage(parsed);
    if (response !== null) {
      this.send(response);
    }
  }

  private send(payload: unknown): void {
    if (!this.running) return;
    try {
      const serialized = JSON.stringify(payload) + '\n';
      this.output.write(serialized, (err) => {
        if (err) {
          this.log(`[DocOrbit MCP] Stdio async write error: ${err.message || String(err)}`);
        }
      });
    } catch (err) {
      this.log(`[DocOrbit MCP] Stdio sync write error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private log(message: string): void {
    try {
      // Isolated to stderr with empty callback to never throw or corrupt stdout JSON-RPC stream
      this.errorOutput.write(`${message}\n`, () => {});
    } catch {
      // Intentionally safe if stderr is closed or broken
    }
  }

  async close(): Promise<void> {
    this.running = false;
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
  }
}

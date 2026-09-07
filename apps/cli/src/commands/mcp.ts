import { DocOrbitDb, DocOrbitRepository, resolveDefaultDbPath } from '../../../../packages/storage/src/index.ts';
import { WorkspaceResolver } from '../../../../packages/workspace/src/index.ts';
import {
  McpServer,
  StdioServerTransport,
  StreamableHttpTransport,
} from '../../../../packages/mcp/src/index.ts';

export interface McpCommandOptions {
  stdio?: boolean;
  port?: number;
  host?: string;
  dbPath?: string;
  projectDir?: string;
  global?: boolean;
  project?: boolean;
}

export async function runMcpCommand(options: McpCommandOptions = {}): Promise<void> {
  const projectDir = options.projectDir || process.cwd();
  const dbPath = resolveDefaultDbPath(options.dbPath, projectDir, options.global);

  const db = new DocOrbitDb(dbPath);
  const repo = new DocOrbitRepository(db);
  const resolver = new WorkspaceResolver(repo);

  const server = new McpServer({
    repo,
    resolver,
    projectDir,
    serverName: 'docorbit-mcp',
    serverVersion: '0.5.0',
  });

  const isHttp = typeof options.port === 'number' && options.port > 0;

  if (isHttp) {
    const port = options.port!;
    const host = options.host || '127.0.0.1';
    const transport = new StreamableHttpTransport({ port, host });

    await transport.start(server);
    const activePort = transport.getPort();
    process.stderr.write(
      `[DocOrbit MCP] Streamable HTTP server listening on http://${host}:${activePort}\n` +
      `  - MCP endpoint: POST http://${host}:${activePort}/mcp\n` +
      `  - SSE fallback: GET http://${host}:${activePort}/sse\n` +
      `  - Health check: GET http://${host}:${activePort}/health\n`
    );

    const shutdown = async () => {
      process.stderr.write('[DocOrbit MCP] Shutting down HTTP server...\n');
      await transport.close();
      db.close();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } else {
    // Default to Stdio transport
    const transport = new StdioServerTransport();
    await transport.start(server);

    const shutdown = async () => {
      await transport.close();
      db.close();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }
}

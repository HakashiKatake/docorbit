import type { McpServer } from '../server.ts';

export interface McpTransport {
  start(server: McpServer): Promise<void>;
  close(): Promise<void>;
}

import type { DocOrbitRepository } from '../../storage/src/index.ts';
import type { WorkspaceResolver } from '../../workspace/src/index.ts';
import { ImplementationContextService } from '../../core/src/index.ts';
import {
  VerificationService,
  DiffService,
  ImpactAnalysisService,
} from '../../verification/src/index.ts';
import { ExportService } from '../../export/src/index.ts';
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  McpTool,
  InitializeResult,
} from './types.ts';
import { JSONRPC_ERRORS } from './types.ts';
import type { McpContext, McpToolHandler } from './tools/types.ts';
import { createDefaultTools } from './tools/index.ts';
import { McpResourceManager } from './resources/index.ts';

export interface McpServerOptions {
  repo: DocOrbitRepository;
  resolver?: WorkspaceResolver;
  projectDir?: string;
  serverName?: string;
  serverVersion?: string;
  tools?: Map<string, McpToolHandler>;
  maxResourceBytes?: number;
}

export class McpServer {
  private repo: DocOrbitRepository;
  private resolver?: WorkspaceResolver;
  private projectDir?: string;
  private serverName: string;
  private serverVersion: string;
  private tools: Map<string, McpToolHandler>;
  private resourceManager: McpResourceManager;
  private context: McpContext;
  private initialized: boolean = false;

  constructor(options: McpServerOptions) {
    this.repo = options.repo;
    this.resolver = options.resolver;
    this.projectDir = options.projectDir;
    this.serverName = options.serverName || 'docorbit-mcp';
    this.serverVersion = options.serverVersion || '0.5.0';

    this.tools = options.tools || createDefaultTools();
    this.resourceManager = new McpResourceManager(this.repo, {
      maxResourceBytes: options.maxResourceBytes,
    });

    const implService = new ImplementationContextService(this.repo, this.resolver);
    const verificationService = new VerificationService(this.repo);
    const diffService = new DiffService(this.repo);
    const impactService = new ImpactAnalysisService(this.repo);
    const exportService = new ExportService(this.repo);

    this.context = {
      repo: this.repo,
      resolver: this.resolver,
      projectDir: this.projectDir,
      workspaceRoot: this.projectDir,
      implService,
      implementationService: implService,
      verificationService,
      diffService,
      impactService,
      exportService,
    };
  }

  getContext(): McpContext {
    return this.context;
  }

  getResourceManager(): McpResourceManager {
    return this.resourceManager;
  }

  getTools(): McpTool[] {
    return Array.from(this.tools.values()).map(h => h.definition);
  }

  async handleMessage(raw: unknown): Promise<JsonRpcResponse | null> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: JSONRPC_ERRORS.INVALID_REQUEST,
          message: 'Invalid JSON-RPC request: payload must be an object.',
        },
      };
    }

    const msg = raw as Record<string, unknown>;
    const id = (msg.id !== undefined ? (msg.id as string | number | null) : undefined);
    const isNotification = id === undefined;

    if (msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      if (isNotification) return null;
      return {
        jsonrpc: '2.0',
        id: id ?? null,
        error: {
          code: JSONRPC_ERRORS.INVALID_REQUEST,
          message: 'Invalid JSON-RPC 2.0 request structure: missing "jsonrpc: 2.0" or "method".',
        },
      };
    }

    const method = msg.method;
    const params = (msg.params && typeof msg.params === 'object' && !Array.isArray(msg.params))
      ? (msg.params as Record<string, unknown>)
      : {};

    try {
      switch (method) {
        case 'initialize': {
          this.initialized = true;
          const result: InitializeResult = {
            protocolVersion: '2024-11-05',
            serverInfo: {
              name: this.serverName,
              version: this.serverVersion,
            },
            capabilities: {
              tools: {
                listChanged: false,
              },
              resources: {
                subscribe: false,
                listChanged: false,
              },
              logging: {},
            },
          };
          return { jsonrpc: '2.0', id: id ?? null, result };
        }

        case 'notifications/initialized': {
          this.initialized = true;
          return null; // Notifications have no response
        }

        case 'ping': {
          if (isNotification) return null;
          return { jsonrpc: '2.0', id: id ?? null, result: {} };
        }

        case 'tools/list': {
          if (isNotification) return null;
          return {
            jsonrpc: '2.0',
            id: id ?? null,
            result: {
              tools: this.getTools(),
            },
          };
        }

        case 'tools/call': {
          if (isNotification) return null;
          const toolName = typeof params.name === 'string' ? params.name : '';
          const toolArgs = (params.arguments && typeof params.arguments === 'object' && !Array.isArray(params.arguments))
            ? (params.arguments as Record<string, unknown>)
            : {};

          const handler = this.tools.get(toolName);
          if (!handler) {
            return {
              jsonrpc: '2.0',
              id: id ?? null,
              error: {
                code: JSONRPC_ERRORS.METHOD_NOT_FOUND,
                message: `Tool not found: "${toolName}". Available tools: ${Array.from(this.tools.keys()).join(', ')}`,
              },
            };
          }

          try {
            const toolResult = await handler.execute(toolArgs, this.context);
            return {
              jsonrpc: '2.0',
              id: id ?? null,
              result: toolResult,
            };
          } catch (toolErr) {
            const message = toolErr instanceof Error ? toolErr.message : String(toolErr);
            return {
              jsonrpc: '2.0',
              id: id ?? null,
              result: {
                isError: true,
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({ error: message, failure: true }),
                  },
                ],
              },
            };
          }
        }

        case 'resources/list': {
          if (isNotification) return null;
          return {
            jsonrpc: '2.0',
            id: id ?? null,
            result: {
              resources: this.resourceManager.listResources(),
            },
          };
        }

        case 'resources/read': {
          if (isNotification) return null;
          const uri = typeof params.uri === 'string' ? params.uri : '';
          if (!uri) {
            return {
              jsonrpc: '2.0',
              id: id ?? null,
              error: {
                code: JSONRPC_ERRORS.INVALID_PARAMS,
                message: 'Missing or empty "uri" parameter for resources/read.',
              },
            };
          }

          try {
            const readResult = this.resourceManager.readResource(uri);
            return {
              jsonrpc: '2.0',
              id: id ?? null,
              result: readResult,
            };
          } catch (resErr) {
            const message = resErr instanceof Error ? resErr.message : String(resErr);
            return {
              jsonrpc: '2.0',
              id: id ?? null,
              error: {
                code: JSONRPC_ERRORS.INVALID_PARAMS,
                message,
              },
            };
          }
        }

        default: {
          if (isNotification) return null;
          return {
            jsonrpc: '2.0',
            id: id ?? null,
            error: {
              code: JSONRPC_ERRORS.METHOD_NOT_FOUND,
              message: `Unknown or unhandled method: "${method}".`,
            },
          };
        }
      }
    } catch (err) {
      if (isNotification) return null;
      const message = err instanceof Error ? err.message : String(err);
      return {
        jsonrpc: '2.0',
        id: id ?? null,
        error: {
          code: JSONRPC_ERRORS.INTERNAL_ERROR,
          message: `Internal server error: ${message}`,
        },
      };
    }
  }
}

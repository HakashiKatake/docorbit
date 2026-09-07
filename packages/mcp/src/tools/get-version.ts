import {
  detectWorkspaceDependencies,
  WorkspaceResolver,
} from '../../../workspace/src/index.ts';
import type { CallToolResult, McpTool } from '../types.ts';
import type { McpContext, McpToolHandler } from './types.ts';

export class GetVersionTool implements McpToolHandler {
  readonly definition: McpTool = {
    name: 'get_version',
    description: 'Inspect workspace dependencies and resolve the exact compatible documentation version using the SemVer confidence ladder.',
    inputSchema: {
      type: 'object',
      properties: {
        library: {
          type: 'string',
          description: 'Package or library name to check (e.g. "next", "stripe", "fastapi").',
        },
        projectPath: {
          type: 'string',
          description: 'Workspace root directory containing package manifests (default: current directory).',
        },
      },
      required: ['library'],
    },
  };

  async execute(args: Record<string, unknown>, ctx: McpContext): Promise<CallToolResult> {
    const library = (
      typeof args.library === 'string' ? args.library :
      typeof args.package === 'string' ? args.package :
      typeof args.packageName === 'string' ? args.packageName :
      typeof args.name === 'string' ? args.name : ''
    ).trim();

    const projectPath = typeof args.projectPath === 'string'
      ? args.projectPath
      : (typeof args.project === 'string' ? args.project : (ctx.projectDir || ctx.workspaceRoot || '.'));

    let scan;
    try {
      scan = detectWorkspaceDependencies(projectPath);
    } catch (err: unknown) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: `Failed to inspect workspace manifests at ${projectPath}: ${err instanceof Error ? err.message : String(err)}` }),
          },
        ],
      };
    }

    // If no specific library is requested, return version intelligence for all workspace dependencies
    if (!library) {
      const resolver = new WorkspaceResolver(ctx.repo);
      const resolution = resolver.resolveWorkspace(scan);
      const lines: string[] = [
        `### Workspace Version Intelligence (${scan.dependencies.length} dependencies detected)`,
        `**Ecosystems**: ${scan.ecosystems.length > 0 ? scan.ecosystems.join(', ') : 'none detected'}\n`,
      ];

      if (scan.dependencies.length === 0) {
        lines.push('No dependencies were detected in workspace manifests.');
      } else {
        lines.push('| Dependency | Requested | Resolved | Doc Version | Confidence |');
        lines.push('|---|---|---|---|---|');
        for (const dep of scan.dependencies) {
          const match = resolution.matches.find(m => m.dependency.name.toLowerCase() === dep.name.toLowerCase());
          const conf = match ? `${Math.round(match.confidence * 100)}%` : '-';
          lines.push(`| \`${dep.name}\` | \`${dep.requestedVersion}\` | \`${dep.resolvedVersion || '-'}\` | \`${match?.targetVersion || 'unresolved'}\` | ${conf} |`);
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              markdown: lines.join('\n'),
              data: {
                ecosystems: scan.ecosystems,
                dependenciesCount: scan.dependencies.length,
                dependencies: scan.dependencies,
                resolutionMatches: resolution.matches,
              },
            }, null, 2),
          },
        ],
      };
    }

    const libLower = library.toLowerCase();
    const matchedDep = scan.dependencies.find(d => d.name.toLowerCase() === libLower);

    if (!matchedDep) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              markdown: `### Version Resolution for "${library}"\n\nNo installed dependency named \`${library}\` was found in workspace manifests.`,
              data: {
                library,
                foundInWorkspace: false,
                ecosystemsScanned: scan.ecosystems,
              },
            }, null, 2),
          },
        ],
      };
    }

    const resolver = new WorkspaceResolver(ctx.repo);
    const resolution = resolver.resolveWorkspace(scan);
    const match = resolution.matches.find(m => m.dependency.name.toLowerCase() === libLower);

    const data = {
      library: matchedDep.name,
      ecosystem: matchedDep.ecosystem,
      requestedVersion: matchedDep.requestedVersion,
      resolvedVersion: matchedDep.resolvedVersion,
      sourceFile: matchedDep.sourceFile,
      docVersionMatch: match ? {
        targetVersion: match.targetVersion,
        confidence: match.confidence,
        snapshotId: match.snapshotId,
        matchedBy: match.matchedBy,
      } : {
        targetVersion: 'unresolved',
        confidence: 'unresolved',
      },
    };

    const lines: string[] = [
      `### Version Intelligence: \`${matchedDep.name}\``,
      `- **Ecosystem**: \`${matchedDep.ecosystem}\``,
      `- **Requested in Manifest**: \`${matchedDep.requestedVersion}\` (${matchedDep.sourceFile})`,
      matchedDep.resolvedVersion ? `- **Resolved in Lockfile**: \`${matchedDep.resolvedVersion}\`` : '',
      match?.targetVersion
        ? `- **Recommended Doc Version**: \`${match.targetVersion}\` (Confidence: \`${match.confidence}\`, Matched via: \`${match.matchedBy}\`)`
        : `- **Recommended Doc Version**: \`unresolved\` (No compatible indexed documentation found)`,
    ].filter(Boolean);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            markdown: lines.join('\n'),
            data,
          }, null, 2),
        },
      ],
    };
  }
}

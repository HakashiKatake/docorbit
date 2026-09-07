import type { DocOrbitRepository } from '../../../storage/src/index.ts';
import type { McpResource, ReadResourceResult, ResourceContent } from '../types.ts';

export interface ResourceManagerOptions {
  maxResourceBytes?: number;
}

export class McpResourceManager {
  private repo: DocOrbitRepository;
  private maxChars: number;

  constructor(repo: DocOrbitRepository, options: ResourceManagerOptions = {}) {
    this.repo = repo;
    // Default 64KB bounded limit
    this.maxChars = options.maxResourceBytes || 64 * 1024;
  }

  listResources(): McpResource[] {
    const resources: McpResource[] = [
      {
        uri: 'docorbit://sources',
        name: 'Indexed Documentation Sources',
        description: 'Collection of all indexed documentation sources, version status, and snapshots.',
        mimeType: 'application/json',
      },
    ];

    try {
      const sources = this.repo.listSources();
      for (const source of sources) {
        resources.push({
          uri: `docorbit://sources/${source.id}`,
          name: `Source: ${source.url}`,
          description: `Indexed documentation source (${source.type}, authority: ${source.authority})`,
          mimeType: 'application/json',
        });
      }
    } catch {
      // Continue if database is empty or error occurs
    }

    try {
      const pages = this.repo.listPages(100);
      for (const page of pages) {
        resources.push({
          uri: `docorbit://pages/${page.id}`,
          name: `Page: ${page.title || page.url}`,
          description: `Documentation page at ${page.url} (~${page.estimatedTokens} tokens)`,
          mimeType: 'text/markdown',
        });
      }
    } catch {
      // Continue
    }

    return resources;
  }

  readResource(uri: string): ReadResourceResult {
    if (uri === 'docorbit://sources') {
      const sources = this.repo.listSources();
      const snapshots = this.repo.listSnapshots();
      const payload = sources.map(s => ({
        id: s.id,
        url: s.url,
        type: s.type,
        authority: s.authority,
        confidence: s.confidence,
        status: s.status,
        machineReadable: s.machineReadable,
        snapshots: snapshots.filter(sn => sn.sourceId === s.id).map(sn => ({
          id: sn.id,
          pageCount: sn.pageCount,
          docVersion: sn.docVersion,
          capturedAt: sn.capturedAt,
        })),
      }));

      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(payload, null, 2),
          },
        ],
      };
    }

    if (uri.startsWith('docorbit://sources/')) {
      const sourceId = uri.slice('docorbit://sources/'.length);
      const source = this.repo.getSource(sourceId);
      if (!source) {
        throw new Error(`Resource not found: ${uri}`);
      }

      const snapshots = this.repo.listSnapshots().filter(sn => sn.sourceId === source.id);
      const pageCount = this.repo.countPages(source.id);

      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify({
              source,
              pageCount,
              snapshots,
              untrusted: true,
            }, null, 2),
          },
        ],
      };
    }

    if (uri.startsWith('docorbit://pages/')) {
      const pageId = uri.slice('docorbit://pages/'.length);
      const page = this.repo.getPage(pageId);
      if (!page) {
        throw new Error(`Resource not found: ${uri}`);
      }

      let content = page.content;
      let truncated = false;
      if (content.length > this.maxChars) {
        content = content.slice(0, this.maxChars) + '\n\n[Content truncated at 64KB bounded resource limit...]';
        truncated = true;
      }

      const header = [
        `# ${page.title}`,
        `**URL**: ${page.url}`,
        `**Tokens**: ~${page.estimatedTokens} | **Content Hash**: \`${page.contentHash.slice(0, 8)}\``,
        page.securityAnnotations.length > 0
          ? `> [!WARNING] Security alerts: ${page.securityAnnotations.map(a => a.patternName).join(', ')}`
          : `> [!NOTE] External content is untrusted.`,
        truncated ? `> [!IMPORTANT] Output was truncated to meet resource limits.` : '',
        '---\n',
      ].filter(Boolean).join('\n');

      return {
        contents: [
          {
            uri,
            mimeType: 'text/markdown',
            text: `${header}\n${content}`,
          },
        ],
      };
    }

    if (uri.startsWith('docorbit://chunks/')) {
      const chunkId = uri.slice('docorbit://chunks/'.length);
      const chunk = this.repo.getChunk(chunkId);
      if (!chunk) {
        throw new Error(`Resource not found: ${uri}`);
      }

      let content = chunk.content;
      let truncated = false;
      if (content.length > this.maxChars) {
        content = content.slice(0, this.maxChars) + '\n\n[Content truncated at bounded limit...]';
        truncated = true;
      }

      const breadcrumb = chunk.sectionPath.length > 0 ? chunk.sectionPath.join(' > ') : (chunk.title || 'General');
      const header = [
        `### Chunk: ${breadcrumb}`,
        `**ID**: \`${chunk.id}\` | **Type**: \`${chunk.chunkType}\` | **Est. Tokens**: ~${chunk.tokenEstimate}`,
        chunk.docVersion ? `**Doc Version**: \`${chunk.docVersion}\`` : '',
        `> [!NOTE] External content is untrusted.\n`,
        truncated ? `> [!IMPORTANT] Output was truncated to meet resource limits.\n` : '',
        '---\n',
      ].filter(Boolean).join('\n');

      return {
        contents: [
          {
            uri,
            mimeType: 'text/markdown',
            text: `${header}\n${content}`,
          },
        ],
      };
    }

    throw new Error(`Unsupported resource URI: ${uri}`);
  }
}

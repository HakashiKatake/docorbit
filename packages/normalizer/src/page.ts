import {
  computeContentHash,
  estimateTokenCount,
} from '../../shared/src/index.ts';
import type {
  NormalizedPage,
  Heading,
  Link,
  CodeExample,
  Provenance,
} from '../../shared/src/index.ts';
import { detectSecurityAnnotations } from '../../security/src/index.ts';
import { normalizeHtmlToMarkdown } from './html.ts';
import { parseLlmsTxt, isValidLlmsTxt } from './llms.ts';
import { detectOpenApiSpec } from './openapi.ts';

function extractMarkdownHeadings(content: string): Heading[] {
  const headings: Heading[] = [];
  const lines = content.split('\n');
  for (const line of lines) {
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      const level = match[1].length;
      const text = match[2].trim();
      const anchor = text.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
      headings.push({ level, text, anchor });
    }
  }
  return headings;
}

function extractMarkdownCodeBlocks(content: string): CodeExample[] {
  const examples: CodeExample[] = [];
  const regex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  let idx = 1;
  while ((match = regex.exec(content)) !== null) {
    const lang = match[1].trim() || 'text';
    const code = match[2].trim();
    if (code) {
      examples.push({
        id: `code_${idx++}`,
        language: lang,
        code,
      });
    }
  }
  return examples;
}

function extractMarkdownLinks(content: string, baseUrl: string): Link[] {
  const links: Link[] = [];
  const regex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const text = match[1].trim();
    const href = match[2].trim();
    if (href.startsWith('#') || href.startsWith('javascript:')) continue;

    let absoluteUrl = href;
    let isExternal = false;
    try {
      const resolved = new URL(href, baseUrl);
      absoluteUrl = resolved.href;
      const baseHost = new URL(baseUrl).hostname;
      isExternal = resolved.hostname !== baseHost;
    } catch {
      // Keep raw href
    }

    links.push({ text, url: absoluteUrl, isExternal });
  }
  return links;
}

export interface BuildNormalizedPageInput {
  sourceId: string;
  url: string;
  rawContent: string;
  contentType?: string;
  sourceUrl?: string;
  targetUrl?: string;
  discoveredBy?: string;
  fetchedAt?: string;
  snapshotId?: string;
}

export function buildNormalizedPage(input: BuildNormalizedPageInput): NormalizedPage {
  const { sourceId, url, rawContent, contentType = '' } = input;
  const rawBytes = Buffer.byteLength(rawContent, 'utf-8');

  let title = 'Documentation';
  let cleanMarkdown = '';
  let headings: Heading[] = [];
  let links: Link[] = [];
  let codeExamples: CodeExample[] = [];

  const isHtml = contentType.includes('text/html') || /^\s*<(!DOCTYPE|html)/i.test(rawContent);
  const isOpenApi = contentType.includes('application/json') || url.endsWith('.json') || url.endsWith('.yaml');

  if (isOpenApi) {
    const apiSummary = detectOpenApiSpec(rawContent, url);
    if (apiSummary) {
      title = `${apiSummary.title} (OpenAPI ${apiSummary.specVersion})`;
      cleanMarkdown = `# ${title}\n\n${apiSummary.description || ''}\n\n` +
        `**Servers**: ${apiSummary.servers.join(', ') || 'None specified'}\n\n` +
        `**Endpoints Count**: ${apiSummary.pathCount}\n\n` +
        `\`\`\`json\n${JSON.stringify(apiSummary.rawJson, null, 2)}\n\`\`\``;
      headings = [
        { level: 1, text: title, anchor: 'title' },
        { level: 2, text: 'API Overview', anchor: 'api-overview' },
      ];
      codeExamples = [
        {
          id: 'spec_1',
          language: 'json',
          code: JSON.stringify(apiSummary.rawJson, null, 2),
          caption: 'OpenAPI Specification',
        },
      ];
    }
  }

  if (!cleanMarkdown && isHtml) {
    const extracted = normalizeHtmlToMarkdown(rawContent, url);
    title = extracted.title;
    cleanMarkdown = extracted.markdown;
    headings = extracted.headings;
    links = extracted.links;
    codeExamples = extracted.codeExamples;
  }

  if (!cleanMarkdown) {
    if (isValidLlmsTxt(rawContent)) {
      const llmsDoc = parseLlmsTxt(rawContent, url);
      title = llmsDoc.title || 'llms.txt Index';
      cleanMarkdown = rawContent;
      headings = extractMarkdownHeadings(rawContent);
      links = extractMarkdownLinks(rawContent, url);
      codeExamples = extractMarkdownCodeBlocks(rawContent);
    } else {
      cleanMarkdown = rawContent.trim();
      headings = extractMarkdownHeadings(cleanMarkdown);
      links = extractMarkdownLinks(cleanMarkdown, url);
      codeExamples = extractMarkdownCodeBlocks(cleanMarkdown);
      if (headings.length > 0 && headings[0].level === 1) {
        title = headings[0].text;
      }
    }
  }

  const contentHash = computeContentHash(cleanMarkdown);
  const estimatedTokens = estimateTokenCount(cleanMarkdown);
  const securityAnnotations = detectSecurityAnnotations(cleanMarkdown);

  const id = `page_${computeContentHash(`${sourceId}:${url}`).slice(0, 16)}`;
  const fetchedAt = input.fetchedAt || new Date().toISOString();

  const provenance: Provenance = {
    sourceUrl: input.sourceUrl || url,
    targetUrl: input.targetUrl || url,
    fetchedAt,
    discoveredBy: input.discoveredBy || 'direct',
    contentHash,
    snapshotId: input.snapshotId,
  };

  return {
    id,
    sourceId,
    title,
    url,
    content: cleanMarkdown,
    headings,
    links,
    codeExamples,
    contentHash,
    fetchedAt,
    rawBytes,
    estimatedTokens,
    securityAnnotations,
    provenance,
  };
}

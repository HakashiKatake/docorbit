import {
  computeSha256,
  computeContentHash,
  estimateTokenCount,
} from '../../shared/src/index.ts';
import type {
  NormalizedPage,
  DocumentChunk,
  ChunkType,
  ChunkCode,
  SymbolReference,
  ChunkRelationship,
  ChunkingConfig,
  Provenance,
} from '../../shared/src/index.ts';

export const DEFAULT_CHUNKING_CONFIG: ChunkingConfig = {
  targetTokens: 500,
  maxTokens: 1000,
  overlapTokens: 50,
};

export interface SlicingResult {
  chunks: DocumentChunk[];
  relationships: ChunkRelationship[];
  codeSnippets: ChunkCode[];
  symbols: SymbolReference[];
}

interface RawBlock {
  type: 'heading' | 'code' | 'warning' | 'prose';
  headingLevel?: number;
  headingText?: string;
  language?: string;
  content: string;
}

interface Section {
  headingLevel: number;
  headingText: string;
  sectionPath: string[];
  blocks: RawBlock[];
}

/**
 * Parses markdown into atomic blocks: headings, code fences, warnings/admonitions, and prose.
 * Guarantees code fences and warnings are kept as atomic units that are never fractured.
 */
function parseAtomicBlocks(markdown: string): RawBlock[] {
  const lines = markdown.split('\n');
  const blocks: RawBlock[] = [];
  let currentProseLines: string[] = [];

  const flushProse = () => {
    if (currentProseLines.length > 0) {
      const text = currentProseLines.join('\n').trim();
      if (text) {
        blocks.push({ type: 'prose', content: text });
      }
      currentProseLines = [];
    }
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Check for code fence start
    const codeMatch = line.match(/^```([a-zA-Z0-9_-]*)/);
    if (codeMatch) {
      flushProse();
      const lang = codeMatch[1].trim() || 'text';
      const codeLines: string[] = [line];
      i++;
      while (i < lines.length) {
        codeLines.push(lines[i]);
        if (lines[i].trim().startsWith('```')) {
          i++;
          break;
        }
        i++;
      }
      blocks.push({
        type: 'code',
        language: lang,
        content: codeLines.join('\n'),
      });
      continue;
    }

    // Check for heading outside code fence
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flushProse();
      const level = headingMatch[1].length;
      const text = headingMatch[2].trim();
      blocks.push({
        type: 'heading',
        headingLevel: level,
        headingText: text,
        content: line,
      });
      i++;
      continue;
    }

    // Check for admonition / warning blockquote (> [!NOTE], > [!WARNING], > Note:, > Warning:)
    if (/^>\s*(\[!?(NOTE|WARNING|IMPORTANT|CAUTION|TIP)\]|Note:|Warning:|Caution:|Important:)/i.test(line)) {
      flushProse();
      const warningLines: string[] = [line];
      i++;
      while (i < lines.length && (lines[i].startsWith('>') || lines[i].trim() === '')) {
        warningLines.push(lines[i]);
        i++;
      }
      blocks.push({
        type: 'warning',
        content: warningLines.join('\n').trim(),
      });
      continue;
    }

    // Empty line separates paragraphs
    if (line.trim() === '') {
      flushProse();
      i++;
      continue;
    }

    // Regular prose line within paragraph
    currentProseLines.push(line);
    i++;
  }

  flushProse();
  return blocks;
}


/**
 * Groups atomic blocks into hierarchical sections tracking heading breadcrumbs.
 */
function groupIntoSections(blocks: RawBlock[], defaultTitle: string): Section[] {
  const sections: Section[] = [];
  const headingStack: Array<{ level: number; text: string }> = [];

  let currentSection: Section = {
    headingLevel: 1,
    headingText: defaultTitle,
    sectionPath: [defaultTitle],
    blocks: [],
  };

  for (const block of blocks) {
    if (block.type === 'heading') {
      if (currentSection.blocks.length > 0) {
        sections.push(currentSection);
      }

      const level = block.headingLevel || 1;
      const text = block.headingText || defaultTitle;

      while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
        headingStack.pop();
      }
      headingStack.push({ level, text });

      currentSection = {
        headingLevel: level,
        headingText: text,
        sectionPath: headingStack.map(h => h.text),
        blocks: [],
      };
    } else {
      currentSection.blocks.push(block);
    }
  }

  if (currentSection.blocks.length > 0 || sections.length === 0) {
    sections.push(currentSection);
  }

  return sections;
}

/**
 * Shallow, deterministic symbol extractor using lightweight regex patterns.
 * No external AST parsers or language runtimes.
 */
export function extractSymbols(content: string, chunkId: string): SymbolReference[] {
  const symbols: SymbolReference[] = [];
  const seen = new Set<string>();

  const addSymbol = (name: string, kind: SymbolReference['kind']) => {
    const clean = name.trim();
    if (clean && !seen.has(clean) && clean.length > 1 && clean.length < 80) {
      seen.add(clean);
      symbols.push({
        id: `sym_${chunkId}_${symbols.length + 1}`,
        chunkId,
        name: clean,
        kind,
      });
    }
  };

  // 1. REST API endpoints: (GET|POST|PUT|DELETE|PATCH) /path
  const endpointRegex = /\b(GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)\s+([/][a-zA-Z0-9_{}/:.-]+)/g;
  let match: RegExpExecArray | null;
  while ((match = endpointRegex.exec(content)) !== null) {
    addSymbol(`${match[1]} ${match[2]}`, 'endpoint');
  }

  // 2. Functions: function foo(...), def foo(...), fn foo(...), func foo(...)
  const funcRegex = /\b(?:function|def|func|fn)\s+([a-zA-Z0-9_$]+)\s*\(/g;
  while ((match = funcRegex.exec(content)) !== null) {
    addSymbol(match[1], 'function');
  }

  // 3. Arrow function assignments: const foo = (...) => or const foo = async (...) =>
  const arrowRegex = /\b(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g;
  while ((match = arrowRegex.exec(content)) !== null) {
    addSymbol(match[1], 'function');
  }

  // 4. Classes and interfaces: class Foo, interface Bar, struct Baz, type Qux =
  const classRegex = /\b(?:class|interface|struct|enum)\s+([a-zA-Z0-9_$]+)/g;
  while ((match = classRegex.exec(content)) !== null) {
    addSymbol(match[1], match[0].startsWith('class') ? 'class' : 'interface');
  }

  const typeRegex = /\btype\s+([A-Z][a-zA-Z0-9_$]*)\s*=/g;
  while ((match = typeRegex.exec(content)) !== null) {
    addSymbol(match[1], 'type');
  }

  // 5. Common config keys (YAML/JSON): key: value or "key":
  const configRegex = /^[ \t]*([a-zA-Z0-9_.-]{3,30})\s*:\s*[^\s]/gm;
  while ((match = configRegex.exec(content)) !== null) {
    if (!['http', 'https', 'note', 'warning', 'tip', 'important', 'version'].includes(match[1].toLowerCase())) {
      addSymbol(match[1], 'config');
    }
  }

  return symbols;
}

/**
 * Detects chunk type based on block composition and content.
 */
export function detectChunkType(blocks: RawBlock[], content: string): ChunkType {
  const hasWarning = blocks.some(b => b.type === 'warning') || />\s*\[!(WARNING|CAUTION|IMPORTANT)\]/i.test(content);
  const codeBlocks = blocks.filter(b => b.type === 'code');
  const hasEndpoint = /\b(GET|POST|PUT|DELETE|PATCH)\s+[/]/.test(content);

  if (hasEndpoint) {
    return 'api';
  }

  if (hasWarning && blocks.length <= 2) {
    return 'warning';
  }

  if (codeBlocks.length > 0 && blocks.every(b => b.type === 'code' || b.type === 'heading')) {
    return 'code';
  }

  if (codeBlocks.length > 0 && content.toLowerCase().includes('example')) {
    return 'example';
  }

  if (codeBlocks.length > 0) {
    return 'mixed';
  }

  return 'prose';
}

/**
 * Slices a NormalizedPage into standalone, context-preserving DocumentChunks,
 * maintaining section breadcrumbs, relationship links, code snippets, and symbols.
 */
export function slicePageIntoChunks(
  page: NormalizedPage,
  snapshotId: string,
  config: ChunkingConfig = DEFAULT_CHUNKING_CONFIG
): SlicingResult {
  const atomicBlocks = parseAtomicBlocks(page.content);
  const sections = groupIntoSections(atomicBlocks, page.title);

  const chunks: DocumentChunk[] = [];
  const relationships: ChunkRelationship[] = [];
  const codeSnippets: ChunkCode[] = [];
  const symbols: SymbolReference[] = [];

  const provenance: Provenance = page.provenance || {
    sourceUrl: page.url,
    targetUrl: page.url,
    fetchedAt: page.fetchedAt,
    discoveredBy: 'direct',
    contentHash: page.contentHash,
    snapshotId,
  };

  let globalOrdinal = 0;
  const sectionRootChunkIds = new Map<string, string>();

  for (const section of sections) {
    const sectionTitle = section.headingText;
    const sectionPathKey = section.sectionPath.join(' > ');

    if (section.blocks.length === 0) continue;

    const fullSectionText = section.blocks.map(b => b.content).join('\n\n');
    const estimatedTokens = estimateTokenCount(fullSectionText);

    let chunkBlockGroups: RawBlock[][] = [];

    if (estimatedTokens <= config.maxTokens) {
      chunkBlockGroups.push(section.blocks);
    } else {
      // Secondary splitting: split on atomic block boundaries
      let currentGroup: RawBlock[] = [];
      let currentTokens = 0;

      for (let i = 0; i < section.blocks.length; i++) {
        const block = section.blocks[i];
        const blockTokens = estimateTokenCount(block.content);
        const isWarning = block.type === 'warning';

        if (currentGroup.length > 0 && (currentTokens + blockTokens > config.targetTokens) && !isWarning) {
          chunkBlockGroups.push(currentGroup);
          currentGroup = [block];
          currentTokens = blockTokens;
        } else {
          currentGroup.push(block);
          currentTokens += blockTokens;
        }
      }

      if (currentGroup.length > 0) {
        chunkBlockGroups.push(currentGroup);
      }
    }

    let parentChunkId: string | undefined;

    for (let gIdx = 0; gIdx < chunkBlockGroups.length; gIdx++) {
      const group = chunkBlockGroups[gIdx];
      const chunkContent = group.map(b => b.content).join('\n\n');
      const chunkType = detectChunkType(group, chunkContent);
      const codeBlock = group.find(b => b.type === 'code');
      const dominantLanguage = codeBlock?.language;

      const chunkHash = computeContentHash(chunkContent);
      const chunkId = `chk_${computeSha256(`${page.id}:${globalOrdinal}:${chunkHash}`).slice(0, 16)}`;
      const tokenEst = estimateTokenCount(chunkContent);

      const chunk: DocumentChunk = {
        id: chunkId,
        pageId: page.id,
        snapshotId,
        title: sectionTitle,
        sectionPath: [...section.sectionPath],
        content: chunkContent,
        chunkType,
        language: dominantLanguage,
        tokenEstimate: tokenEst,
        ordinal: globalOrdinal,
        contentHash: chunkHash,
        provenance,
      };

      chunks.push(chunk);

      if (gIdx === 0) {
        parentChunkId = chunkId;
        sectionRootChunkIds.set(sectionPathKey, chunkId);

        if (section.sectionPath.length > 1) {
          const parentPathKey = section.sectionPath.slice(0, -1).join(' > ');
          const ancestorId = sectionRootChunkIds.get(parentPathKey);
          if (ancestorId && ancestorId !== chunkId) {
            relationships.push({
              sourceChunkId: chunkId,
              targetChunkId: ancestorId,
              type: 'parent_section',
            });
          }
        }
      } else if (parentChunkId) {
        relationships.push({
          sourceChunkId: chunkId,
          targetChunkId: parentChunkId,
          type: 'parent_section',
        });
      }

      if (globalOrdinal > 0) {
        const prevChunk = chunks[chunks.length - 2];
        relationships.push({
          sourceChunkId: prevChunk.id,
          targetChunkId: chunkId,
          type: 'next_chunk',
        });
        relationships.push({
          sourceChunkId: chunkId,
          targetChunkId: prevChunk.id,
          type: 'previous_chunk',
        });

        if (prevChunk.chunkType === 'prose' && (chunkType === 'code' || chunkType === 'example')) {
          relationships.push({
            sourceChunkId: prevChunk.id,
            targetChunkId: chunkId,
            type: 'explains_code',
          });
        }
      }

      // Extract code snippets
      for (const b of group) {
        if (b.type === 'code') {
          const codeSnippetId = `code_${chunkId}_${codeSnippets.length + 1}`;
          codeSnippets.push({
            id: codeSnippetId,
            chunkId,
            language: b.language,
            code: b.content.replace(/^```[a-zA-Z0-9_-]*\n/, '').replace(/\n```$/, ''),
          });
          relationships.push({
            sourceChunkId: chunkId,
            targetChunkId: codeSnippetId,
            type: 'contains_code',
          });
        }
      }

      // Extract symbols
      const chunkSymbols = extractSymbols(chunkContent, chunkId);
      for (const sym of chunkSymbols) {
        symbols.push(sym);
      }

      globalOrdinal++;
    }
  }

  return {
    chunks,
    relationships,
    codeSnippets,
    symbols,
  };
}

import { createHash } from 'node:crypto';
import type {
  NormalizedPage,
  DocumentChunk,
  Pitfall,
  PitfallKind,
  Provenance,
} from '../../shared/src/index.ts';

interface PitfallPattern {
  kind: PitfallKind;
  pattern: RegExp;
  titlePrefix: string;
}

const PITFALL_PATTERNS: PitfallPattern[] = [
  {
    kind: 'removed',
    pattern: /(?:has been removed in|was removed in|removed in version|no longer supported in)\s+([^\n.]+)/i,
    titlePrefix: 'Removed in',
  },
  {
    kind: 'deprecated',
    pattern: /(?:@deprecated|deprecated since|deprecated in|this (?:method|function|endpoint|parameter|feature) is deprecated|is deprecated; use|deprecated:\s+use)\s+([^\n.]+)/i,
    titlePrefix: 'Deprecated',
  },
  {
    kind: 'breaking_change',
    pattern: /(?:breaking change:?|breaking in v?\d+|migrating to v?\d+ requires|incompatible with previous)\s*([^\n.]*)/i,
    titlePrefix: 'Breaking Change',
  },
  {
    kind: 'server_only',
    pattern: /(?:can only be called (?:on|from) the server|server-only|server components? only|cannot be imported (?:on|into) the client|never expose.*in client(?:-side)? code)/i,
    titlePrefix: 'Server-Only Restriction',
  },
  {
    kind: 'client_only',
    pattern: /(?:client-only|can only be called in the browser|client components? only|requires a browser environment|window is not defined)/i,
    titlePrefix: 'Client-Only Restriction',
  },
  {
    kind: 'rate_limit',
    pattern: /(?:rate limit(?:ed)?|429 too many requests|requests per (?:minute|second|hour)|burst limit|quota exceeded)/i,
    titlePrefix: 'Rate Limit Warning',
  },
  {
    kind: 'security',
    pattern: /(?:security warning|vulnerability|signature verification failure|never commit (?:your|the) secret|timing attacks?|replay attacks?)/i,
    titlePrefix: 'Security Requirement',
  },
  {
    kind: 'permission',
    pattern: /(?:requires permission|requires scope|insufficient privileges|403 forbidden|unauthorized access|must have admin)/i,
    titlePrefix: 'Permission Requirement',
  },
  {
    kind: 'required_config',
    pattern: /(?:must be configured before|environment variable.*is required|missing required config|prerequisite:\s+set)\s+([^\n.]+)/i,
    titlePrefix: 'Required Configuration',
  },
  {
    kind: 'runtime_restriction',
    pattern: /(?:not supported in (?:the )?edge runtime|node(?:\.js)? runtime only|requires webcrypto|unsupported platform)/i,
    titlePrefix: 'Runtime Restriction',
  },
];

const ADMONITION_REGEX = /(?:^|\n)(?:>|:::\s*)\[!(WARNING|CAUTION|DANGER|IMPORTANT|NOTE)\](?:\s+([^\n]+))?\n([\s\S]*?)(?=\n(?:>|:::|\s*$|$))/gi;

/**
 * Extracts explicit, non-inferential pitfalls, deprecations, breaking changes,
 * and security requirements from documentation pages and chunks.
 */
export function extractPitfalls(
  page: NormalizedPage,
  chunks: DocumentChunk[],
  docVersion?: string,
  snapshotId?: string
): Pitfall[] {
  const pitfalls: Pitfall[] = [];
  const seenKeys = new Set<string>();
  const nowIso = new Date().toISOString();

  // Helper to add pitfall with deduplication
  const addPitfall = (
    kind: PitfallKind,
    title: string,
    content: string,
    chunk?: DocumentChunk
  ) => {
    const trimmedContent = content.trim();
    if (!trimmedContent || trimmedContent.length < 15) return;

    const dedupeKey = `${kind}:${title.toLowerCase()}:${trimmedContent.substring(0, 80).toLowerCase()}`;
    if (seenKeys.has(dedupeKey)) return;
    seenKeys.add(dedupeKey);

    const id = createHash('sha256')
      .update(`${page.id}:${kind}:${title}:${trimmedContent.substring(0, 100)}`)
      .digest('hex')
      .substring(0, 16);

    // Extract related API or symbol from chunk if available
    let relatedApi: string | undefined = undefined;
    let relatedSymbol: string | undefined = undefined;

    if (chunk) {
      // Check section path or title for API
      const apiMatch = (chunk.title || chunk.sectionPath.join(' ')).match(/\b(GET|POST|PUT|DELETE|PATCH)\s+([/\w\-_{}]+)/i);
      if (apiMatch) {
        relatedApi = `${apiMatch[1].toUpperCase()} ${apiMatch[2]}`;
      }
    }

    const provenance: Provenance = {
      sourceUrl: page.url,
      retrievedAt: page.metadata?.extractedAt || nowIso,
      sourceAuthority: 'official',
    };

    const effectiveSnapshotId = snapshotId || chunk?.snapshotId || (page as any).snapshotId || 'snap_default';

    pitfalls.push({
      id,
      chunkId: chunk?.id,
      pageId: page.id,
      snapshotId: effectiveSnapshotId,
      kind,
      title: title.trim(),
      content: trimmedContent,
      relatedApi,
      relatedSymbol,
      docVersion: docVersion || chunk?.docVersion || page.docVersion,
      provenance,
      createdAt: nowIso,
    });
  };

  // 1. Process chunks for admonitions (> [!WARNING], > [!CAUTION], etc.)
  for (const chunk of chunks) {
    const content = chunk.content;

    // Match admonitions
    let admMatch: RegExpExecArray | null;
    const admRegex = new RegExp(ADMONITION_REGEX.source, 'gi');
    while ((admMatch = admRegex.exec(content)) !== null) {
      const calloutType = admMatch[1].toUpperCase();
      const customTitle = admMatch[2]?.trim();
      const calloutBody = admMatch[3].replace(/^>\s?/gm, '').trim();

      let kind: PitfallKind = 'security';
      if (calloutType === 'WARNING' || calloutType === 'DANGER') {
        kind = 'breaking_change';
      } else if (calloutType === 'CAUTION') {
        kind = 'security';
      } else if (calloutType === 'IMPORTANT') {
        kind = 'required_config';
      }

      // Check if body specifically matches any pitfall pattern
      for (const p of PITFALL_PATTERNS) {
        if (p.pattern.test(calloutBody)) {
          kind = p.kind;
          break;
        }
      }

      const defaultTitle = customTitle || `${kind.replace(/_/g, ' ').toUpperCase()} Warning: ${chunk.title || page.title}`;
      addPitfall(kind, defaultTitle, calloutBody, chunk);
    }

    // 2. Scan chunk text for explicit pattern matches
    for (const { kind, pattern, titlePrefix } of PITFALL_PATTERNS) {
      const match = content.match(pattern);
      if (match) {
        // Extract paragraph containing the match
        const paragraphs = content.split(/\n\s*\n/);
        const matchingParagraph = paragraphs.find(p => pattern.test(p));
        if (matchingParagraph) {
          const detail = match[1]?.trim() ? `: ${match[1].trim()}` : '';
          const title = `${titlePrefix}${detail}`;
          addPitfall(kind, title, matchingParagraph, chunk);
        }
      }
    }
  }

  return pitfalls;
}

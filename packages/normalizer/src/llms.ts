import type { LlmsDocument, LlmsSection, LlmsLink } from '../../shared/src/index.ts';

export function parseLlmsTxt(content: string, baseUrl: string): LlmsDocument {
  const lines = content.split('\n');
  let title: string | undefined;
  let summary: string | undefined;
  const sections: LlmsSection[] = [];
  let currentSection: LlmsSection = { name: 'Overview', links: [] };

  const summaryLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trim();

    if (!line) continue;

    if (line.startsWith('# ') && !title) {
      title = line.slice(2).trim();
      continue;
    }

    if (line.startsWith('>')) {
      const text = line.replace(/^>\s*/, '').trim();
      if (text) summaryLines.push(text);
      continue;
    }

    if (line.startsWith('## ')) {
      if (currentSection.links.length > 0 || currentSection.name !== 'Overview') {
        sections.push(currentSection);
      }
      currentSection = {
        name: line.slice(3).trim(),
        links: [],
      };
      continue;
    }

    const linkMatch = line.match(/^[-*]\s+\[([^\]]+)\]\(([^)]+)\)(?::\s*(.*))?$/);
    if (linkMatch) {
      const linkTitle = linkMatch[1].trim();
      let rawHref = linkMatch[2].trim();
      const description = linkMatch[3] ? linkMatch[3].trim() : undefined;

      try {
        rawHref = new URL(rawHref, baseUrl).href;
      } catch {
        // Keep raw
      }

      const linkItem: LlmsLink = {
        title: linkTitle,
        url: rawHref,
        ...(description ? { description } : {}),
      };

      currentSection.links.push(linkItem);
    }
  }

  if (currentSection.links.length > 0 || sections.length === 0) {
    sections.push(currentSection);
  }

  if (summaryLines.length > 0) {
    summary = summaryLines.join(' ');
  }

  return {
    title,
    summary,
    sections,
    rawContent: content,
  };
}

export function isValidLlmsTxt(content: string): boolean {
  if (!content || typeof content !== 'string') return false;
  const hasH1 = /^#\s+.+/m.test(content);
  const hasLink = /^[-*]\s+\[.+\]\(.+\)/m.test(content);
  return hasH1 && hasLink;
}
